import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteBackendPrefab,
  fetchBackendPrefabPayload,
  listBackendPrefabs,
  PrefabApiError,
  savePrefabToBackend,
} from '../../api/prefabClient.ts';
import {
  ASSET_SETS,
  AssetLibraryLoader,
  EMPTY_ASSET_ID,
  type LoadedAssetTile,
} from '../../engine/prefab/assetRegistry.ts';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  clampFreePixelPosition,
  commitFloatingTilesToLayerStack,
  createLayerStack,
  eraseCellFromLayerStack,
  type FreePlacedTile,
  getCellStack,
  type LayerGrid,
  resizeLayerStack,
  setCellInLayerStack,
  stampPrefabOntoLayerStack,
  trimAndEncodeLayerStack,
  updateCellTileZIndex,
} from '../../engine/prefab/builderGrid.ts';
import {
  StackedPrefabCodec,
  type StackedPrefabData,
} from '../../engine/prefab/PrefabCodec.ts';
import { useAuthStore } from '../../store/authStore.ts';
import {
  type BackendPrefabSummary,
  type SavedPrefabEntry,
  usePrefabStore,
} from '../../store/prefabStore.ts';
import {
  AssetPaletteSidebar,
  type DragPayload,
} from './building-editor/AssetPaletteSidebar.tsx';
import {
  EditorGridCanvas,
  type EditorTool,
} from './building-editor/EditorGridCanvas.tsx';
import {
  AnchorIcon,
  ClearIcon,
  CloseIcon,
  CloudUploadIcon,
  EraseIcon,
  LayersIcon,
  PaintIcon,
  PickIcon,
  PlaceIcon,
  RedoIcon,
  SaveIcon,
  SnapIcon,
  UndoIcon,
} from './building-editor/icons.tsx';
import { SavedBuildingsSidebar } from './building-editor/SavedBuildingsSidebar.tsx';
import {
  accentButtonStyle,
  activeButtonStyle,
  baseButtonStyle,
  keycapStyle,
  primaryButtonStyle,
  TOKENS,
} from './building-editor/theme.ts';

interface BuildingEditorModalProps {
  assetLibrary: AssetLibraryLoader | null;
  onClose: () => void;
}

interface EditorSnapshot {
  gridW: number;
  gridH: number;
  layers: LayerGrid[];
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  floatingTiles: FreePlacedTile[];
}

const GRID_PRESETS = [8, 16, 24, 32] as const;
const ZOOM_OPTIONS = [24, 32, 40] as const;
const MAX_HISTORY = 50;

function cloneLayers(layers: ReadonlyArray<LayerGrid>): LayerGrid[] {
  return layers.map((layer) => ({
    zIndex: layer.zIndex,
    grid: new Uint32Array(layer.grid),
  }));
}

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return {
    gridW: snapshot.gridW,
    gridH: snapshot.gridH,
    layers: cloneLayers(snapshot.layers),
    anchorX: snapshot.anchorX,
    anchorY: snapshot.anchorY,
    anchorZ: snapshot.anchorZ,
    floatingTiles: snapshot.floatingTiles.map((tile) => ({ ...tile })),
  };
}

function clampZ(value: number): number {
  const truncated = Math.trunc(Number.isFinite(value) ? value : 0);
  return Math.max(-32768, Math.min(32767, truncated));
}

function formatBackendError(err: unknown): string {
  if (err instanceof PrefabApiError) {
    if (err.status === 401 || err.code === 'UNAUTHORIZED') {
      return 'Sign in required to sync with backend (401)';
    }
    if (err.code === 'NETWORK' || err.status === 0) {
      return 'Backend offline — local intermediate saves still work';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function BuildingEditorModal({
  assetLibrary,
  onClose,
}: BuildingEditorModalProps): JSX.Element {
  const intermediatePrefabs = usePrefabStore((s) => s.intermediatePrefabs);
  const backendPrefabs = usePrefabStore((s) => s.backendPrefabs);
  const saveIntermediatePrefab = usePrefabStore((s) => s.saveIntermediatePrefab);
  const deleteIntermediatePrefab = usePrefabStore((s) => s.deleteIntermediatePrefab);
  const setBackendPrefabs = usePrefabStore((s) => s.setBackendPrefabs);
  const upsertBackendPrefab = usePrefabStore((s) => s.upsertBackendPrefab);
  const removeBackendPrefab = usePrefabStore((s) => s.removeBackendPrefab);
  const startWorldPlacement = usePrefabStore((s) => s.startWorldPlacement);
  const accessToken = useAuthStore((s) => s.accessToken);

  const hasPreloadedLibrary = Boolean(assetLibrary && assetLibrary.hasLoaded());
  const [fallbackLibrary, setFallbackLibrary] = useState<AssetLibraryLoader | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const fallbackLibraryRef = useRef<AssetLibraryLoader | null>(null);

  const resolvedLibrary = hasPreloadedLibrary ? assetLibrary : fallbackLibrary;
  const isLibraryLoading = !resolvedLibrary && !libraryError;

  // Editor state
  const [buildName, setBuildName] = useState<string>('Workshop Build');
  const [gridW, setGridW] = useState<number>(16);
  const [gridH, setGridH] = useState<number>(16);
  const [layers, setLayers] = useState<LayerGrid[]>(() => createLayerStack(16, 16));
  const [anchorX, setAnchorX] = useState<number>(8);
  const [anchorY, setAnchorY] = useState<number>(15);
  const [anchorZ, setAnchorZ] = useState<number>(0);
  const [floatingTiles, setFloatingTiles] = useState<FreePlacedTile[]>([]);

  const [tool, setTool] = useState<EditorTool>('paint');
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [stackOnTop, setStackOnTop] = useState<boolean>(true);
  const [activeZIndex, setActiveZIndex] = useState<number>(-1);
  const [inspectedCell, setInspectedCell] = useState<{ col: number; row: number } | null>({
    col: 8,
    row: 15,
  });
  const [cellSize, setCellSize] = useState<number>(32);
  const [activeSheetId, setActiveSheetId] = useState<number>(ASSET_SETS[0].sheetId);
  const [selectedAssetId, setSelectedAssetId] = useState<number>(EMPTY_ASSET_ID);

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);

  const [activeDragPayload, setActiveDragPayload] = useState<DragPayload | null>(null);

  const [toolbarMessage, setToolbarMessage] = useState<{
    tone: 'neutral' | 'positive' | 'negative';
    text: string;
  } | null>(null);
  const [backendStatus, setBackendStatus] = useState<{
    tone: 'neutral' | 'positive' | 'negative';
    text: string;
  } | null>(null);
  const [isSavingBackend, setIsSavingBackend] = useState<boolean>(false);
  const [isSyncingBackend, setIsSyncingBackend] = useState<boolean>(false);
  const [busyBackendId, setBusyBackendId] = useState<number | null>(null);

  const stateRef = useRef<EditorSnapshot>({
    gridW,
    gridH,
    layers,
    anchorX,
    anchorY,
    anchorZ,
    floatingTiles,
  });

  useEffect(() => {
    stateRef.current = { gridW, gridH, layers, anchorX, anchorY, anchorZ, floatingTiles };
  }, [gridW, gridH, layers, anchorX, anchorY, anchorZ, floatingTiles]);

  const freeTileCounterRef = useRef<number>(1);

  useEffect(() => {
    if (hasPreloadedLibrary) {
      return;
    }

    let cancelled = false;
    const target = assetLibrary ?? new AssetLibraryLoader();
    if (!assetLibrary) {
      fallbackLibraryRef.current = target;
    }

    target
      .load()
      .then(() => {
        if (cancelled) return;
        setFallbackLibrary(target);
        setLibraryError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLibraryError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      if (fallbackLibraryRef.current) {
        fallbackLibraryRef.current.destroy();
        fallbackLibraryRef.current = null;
      }
    };
  }, [assetLibrary, hasPreloadedLibrary]);

  const activeSheetTiles = useMemo<readonly LoadedAssetTile[]>(() => {
    if (!resolvedLibrary) return [];
    return resolvedLibrary.getTilesForSet(activeSheetId);
  }, [resolvedLibrary, activeSheetId]);

  const defaultAssetId = useMemo(() => {
    if (!resolvedLibrary) return EMPTY_ASSET_ID;
    for (const set of ASSET_SETS) {
      const tiles = resolvedLibrary.getTilesForSet(set.sheetId);
      if (tiles.length > 0) {
        return tiles[0].assetId;
      }
    }
    return EMPTY_ASSET_ID;
  }, [resolvedLibrary]);

  const effectiveSelectedAssetId =
    selectedAssetId !== EMPTY_ASSET_ID ? selectedAssetId : defaultAssetId;

  const getPreviewUrl = useCallback(
    (assetId: number): string | undefined => {
      return resolvedLibrary?.getPreviewUrl(assetId);
    },
    [resolvedLibrary]
  );

  // History management
  const pushUndoSnapshot = useCallback((): void => {
    const current = cloneSnapshot(stateRef.current);
    setUndoStack((prev) => [...prev.slice(-(MAX_HISTORY - 1)), current]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback((): void => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1];
      const current = cloneSnapshot(stateRef.current);
      setRedoStack((r) => [...r.slice(-(MAX_HISTORY - 1)), current]);
      setGridW(target.gridW);
      setGridH(target.gridH);
      setLayers(cloneLayers(target.layers));
      setAnchorX(target.anchorX);
      setAnchorY(target.anchorY);
      setAnchorZ(target.anchorZ);
      setFloatingTiles(target.floatingTiles.map((t) => ({ ...t })));
      return prev.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback((): void => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1];
      const current = cloneSnapshot(stateRef.current);
      setUndoStack((u) => [...u.slice(-(MAX_HISTORY - 1)), current]);
      setGridW(target.gridW);
      setGridH(target.gridH);
      setLayers(cloneLayers(target.layers));
      setAnchorX(target.anchorX);
      setAnchorY(target.anchorY);
      setAnchorZ(target.anchorZ);
      setFloatingTiles(target.floatingTiles.map((t) => ({ ...t })));
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      const target = e.target as HTMLElement | null;
      const inInput =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');
      if (inInput) return;

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, handleUndo, handleRedo]);

  const handleRefreshBackend = useCallback(async (): Promise<void> => {
    setIsSyncingBackend(true);
    setBackendStatus(null);
    try {
      const items = await listBackendPrefabs({ accessToken });
      setBackendPrefabs(items);
      setBackendStatus({
        tone: 'positive',
        text: `Synced ${items.length} ${items.length === 1 ? 'prefab' : 'prefabs'}`,
      });
    } catch (err: unknown) {
      setBackendStatus({
        tone: 'negative',
        text: formatBackendError(err),
      });
    } finally {
      setIsSyncingBackend(false);
    }
  }, [accessToken, setBackendPrefabs]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    const loadInitialPrefabs = async (): Promise<void> => {
      try {
        const items = await listBackendPrefabs({ accessToken });
        if (cancelled) return;
        setBackendPrefabs(items);
        setBackendStatus({
          tone: 'positive',
          text: `Synced ${items.length} ${items.length === 1 ? 'prefab' : 'prefabs'}`,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setBackendStatus({
          tone: 'negative',
          text: formatBackendError(err),
        });
      }
    };

    void loadInitialPrefabs();
    return () => {
      cancelled = true;
    };
  }, [accessToken, setBackendPrefabs]);

  const effectiveLayers = useMemo(() => {
    if (floatingTiles.length === 0) {
      return layers;
    }
    return commitFloatingTilesToLayerStack(
      layers,
      gridW,
      gridH,
      cellSize,
      floatingTiles,
      stackOnTop
    );
  }, [layers, gridW, gridH, cellSize, floatingTiles, stackOnTop]);

  const telemetry = useMemo(
    () =>
      trimAndEncodeLayerStack(
        gridW,
        gridH,
        anchorX,
        anchorY,
        effectiveLayers,
        EMPTY_ASSET_ID,
        anchorZ
      ),
    [gridW, gridH, anchorX, anchorY, effectiveLayers, anchorZ]
  );

  const savedPercent = useMemo(() => {
    if (telemetry.rawByteLength <= 0 || telemetry.stacked.width === 0) return 0;
    return Math.max(
      0,
      Math.round((1 - telemetry.compressedByteLength / telemetry.rawByteLength) * 100)
    );
  }, [telemetry]);

  const inspectedCellStack = useMemo(() => {
    if (!inspectedCell) return [];
    return getCellStack(layers, gridW, inspectedCell.col, inspectedCell.row, EMPTY_ASSET_ID);
  }, [inspectedCell, layers, gridW]);

  // Grid & tool actions
  const handleSelectPreset = (nextSize: number): void => {
    if (nextSize === gridW && nextSize === gridH) return;
    pushUndoSnapshot();
    const resized = resizeLayerStack(layers, gridW, gridH, nextSize, nextSize);
    setGridW(nextSize);
    setGridH(nextSize);
    setLayers(resized);
    setAnchorX((prev) => Math.max(0, Math.min(nextSize - 1, prev)));
    setAnchorY((prev) => Math.max(0, Math.min(nextSize - 1, prev)));
    setInspectedCell((prev) =>
      prev
        ? {
            col: Math.max(0, Math.min(nextSize - 1, prev.col)),
            row: Math.max(0, Math.min(nextSize - 1, prev.row)),
          }
        : null
    );
    setFloatingTiles((prev) =>
      prev.map((tile) => {
        const clamped = clampFreePixelPosition(
          tile.pixelX,
          tile.pixelY,
          nextSize,
          nextSize,
          cellSize
        );
        return { ...tile, pixelX: clamped.pixelX, pixelY: clamped.pixelY };
      })
    );
  };

  const handleZoomChange = (nextCellSize: number): void => {
    if (nextCellSize === cellSize) return;
    const ratio = nextCellSize / cellSize;
    setFloatingTiles((prev) =>
      prev.map((tile) => {
        const clamped = clampFreePixelPosition(
          tile.pixelX * ratio,
          tile.pixelY * ratio,
          gridW,
          gridH,
          nextCellSize
        );
        return { ...tile, pixelX: clamped.pixelX, pixelY: clamped.pixelY };
      })
    );
    setCellSize(nextCellSize);
  };

  const handleToggleSnap = (): void => {
    if (!snapEnabled) {
      if (floatingTiles.length > 0) {
        pushUndoSnapshot();
        const committed = commitFloatingTilesToLayerStack(
          layers,
          gridW,
          gridH,
          cellSize,
          floatingTiles,
          stackOnTop
        );
        setLayers(committed);
        setFloatingTiles([]);
        setToolbarMessage({
          tone: 'positive',
          text: `Snapped ${floatingTiles.length} floating ${floatingTiles.length === 1 ? 'tile' : 'tiles'} to grid`,
        });
      }
      setSnapEnabled(true);
    } else {
      setSnapEnabled(false);
    }
  };

  const handleClear = (): void => {
    pushUndoSnapshot();
    setLayers(createLayerStack(gridW, gridH));
    setFloatingTiles([]);
    setToolbarMessage(null);
  };

  const handlePaintCell = useCallback(
    (col: number, row: number): void => {
      if (effectiveSelectedAssetId === EMPTY_ASSET_ID) return;
      setLayers(
        (prev) =>
          setCellInLayerStack(
            prev,
            gridW,
            gridH,
            col,
            row,
            effectiveSelectedAssetId,
            activeZIndex,
            stackOnTop,
            EMPTY_ASSET_ID
          ).layers
      );
    },
    [gridW, gridH, effectiveSelectedAssetId, activeZIndex, stackOnTop]
  );

  const handleEraseCell = useCallback(
    (col: number, row: number): void => {
      setLayers((prev) =>
        eraseCellFromLayerStack(prev, gridW, col, row, undefined, EMPTY_ASSET_ID)
      );
    },
    [gridW]
  );

  const handleSetAnchor = useCallback(
    (col: number, row: number): void => {
      pushUndoSnapshot();
      setAnchorX(col);
      setAnchorY(row);
    },
    [pushUndoSnapshot]
  );

  const handlePickAsset = useCallback((assetId: number): void => {
    if (assetId === EMPTY_ASSET_ID) return;
    setSelectedAssetId(assetId);
    setTool('paint');
  }, []);

  const handleAddFreeTile = useCallback(
    (assetId: number, pixelX: number, pixelY: number): string => {
      const id = `free-${freeTileCounterRef.current++}`;
      setFloatingTiles((prev) => [
        ...prev,
        { id, assetId, pixelX, pixelY, zIndex: activeZIndex },
      ]);
      return id;
    },
    [activeZIndex]
  );

  const handleMoveFreeTile = useCallback(
    (id: string, pixelX: number, pixelY: number): void => {
      setFloatingTiles((prev) =>
        prev.map((tile) => (tile.id === id ? { ...tile, pixelX, pixelY } : tile))
      );
    },
    []
  );

  const handleRemoveFreeTile = useCallback((id: string): void => {
    setFloatingTiles((prev) => prev.filter((tile) => tile.id !== id));
  }, []);

  const handleDropTile = useCallback(
    (
      assetId: number,
      col: number,
      row: number,
      pixelX: number,
      pixelY: number
    ): void => {
      setSelectedAssetId(assetId);
      pushUndoSnapshot();
      if (snapEnabled) {
        setLayers(
          (prev) =>
            setCellInLayerStack(
              prev,
              gridW,
              gridH,
              col,
              row,
              assetId,
              activeZIndex,
              stackOnTop,
              EMPTY_ASSET_ID
            ).layers
        );
      } else {
        handleAddFreeTile(assetId, pixelX, pixelY);
      }
    },
    [snapEnabled, gridW, gridH, activeZIndex, stackOnTop, pushUndoSnapshot, handleAddFreeTile]
  );

  const resolveDraggedPrefab = useCallback(
    (id: string): StackedPrefabData | null => {
      const entry = intermediatePrefabs.find((item) => item.id === id);
      if (!entry) return null;
      try {
        return StackedPrefabCodec.decodeAny(base64ToArrayBuffer(entry.payloadBase64));
      } catch {
        return null;
      }
    },
    [intermediatePrefabs]
  );

  const handleDropPrefab = useCallback(
    (prefabId: string, col: number, row: number): void => {
      const stacked = resolveDraggedPrefab(prefabId);
      if (!stacked) return;
      pushUndoSnapshot();
      setLayers((prev) =>
        stampPrefabOntoLayerStack(
          prev,
          gridW,
          gridH,
          stacked,
          col,
          row,
          activeZIndex,
          EMPTY_ASSET_ID
        )
      );
    },
    [resolveDraggedPrefab, pushUndoSnapshot, gridW, gridH, activeZIndex]
  );

  const handleChangeCellTileZIndex = useCallback(
    (col: number, row: number, fromZ: number, toZ: number): void => {
      const clampedTo = clampZ(toZ);
      if (fromZ === clampedTo) return;
      pushUndoSnapshot();
      setLayers((prev) =>
        updateCellTileZIndex(prev, gridW, gridH, col, row, fromZ, clampedTo, EMPTY_ASSET_ID)
      );
    },
    [pushUndoSnapshot, gridW, gridH]
  );

  const handleRemoveCellTile = useCallback(
    (col: number, row: number, zIndex: number): void => {
      pushUndoSnapshot();
      setLayers((prev) =>
        eraseCellFromLayerStack(prev, gridW, col, row, zIndex, EMPTY_ASSET_ID)
      );
    },
    [pushUndoSnapshot, gridW]
  );

  const normalizedName = buildName.trim() || 'Untitled Building';

  const handleSaveIntermediate = (): void => {
    if (telemetry.stacked.width === 0 || telemetry.stacked.height === 0) {
      setToolbarMessage({
        tone: 'negative',
        text: 'Place at least one tile before saving',
      });
      return;
    }

    const payloadBase64 = arrayBufferToBase64(telemetry.buffer);
    saveIntermediatePrefab({
      name: normalizedName,
      width: telemetry.stacked.width,
      height: telemetry.stacked.height,
      anchorX: telemetry.stacked.anchorX,
      anchorY: telemetry.stacked.anchorY,
      anchorZ: telemetry.stacked.anchorZ,
      payloadBase64,
      byteLength: telemetry.compressedByteLength,
    });
    setToolbarMessage({
      tone: 'positive',
      text: `Saved "${normalizedName}" locally (${telemetry.layerCount}L · ${telemetry.compressedByteLength} B)`,
    });
  };

  const handleSaveToBackend = async (): Promise<void> => {
    if (telemetry.stacked.width === 0 || telemetry.stacked.height === 0) {
      setToolbarMessage({
        tone: 'negative',
        text: 'Place at least one tile before uploading',
      });
      return;
    }

    setIsSavingBackend(true);
    setBackendStatus(null);
    try {
      const summary = await savePrefabToBackend(normalizedName, telemetry.buffer, {
        accessToken,
      });
      upsertBackendPrefab(summary);
      setBackendStatus({
        tone: 'positive',
        text: `Saved "${summary.name}" (#${summary.id}) to PostgreSQL`,
      });
      setToolbarMessage({
        tone: 'positive',
        text: `Uploaded "${summary.name}" (${summary.byte_length} B)`,
      });
    } catch (err: unknown) {
      const msg = formatBackendError(err);
      setBackendStatus({ tone: 'negative', text: msg });
      setToolbarMessage({ tone: 'negative', text: msg });
    } finally {
      setIsSavingBackend(false);
    }
  };

  const handlePlaceCurrentInWorld = (): void => {
    if (telemetry.stacked.width === 0 || telemetry.stacked.height === 0) {
      setToolbarMessage({
        tone: 'negative',
        text: 'Place at least one tile before placing in world',
      });
      return;
    }

    startWorldPlacement({
      prefabId: `editor-${Date.now()}`,
      name: normalizedName,
      width: telemetry.stacked.width,
      height: telemetry.stacked.height,
      anchorX: telemetry.stacked.anchorX,
      anchorY: telemetry.stacked.anchorY,
      anchorZ: telemetry.stacked.anchorZ,
      payloadBase64: arrayBufferToBase64(telemetry.buffer),
    });
    onClose();
  };

  const loadDecodedPrefabIntoCanvas = (name: string, stacked: StackedPrefabData): void => {
    pushUndoSnapshot();
    const maxDim = Math.max(stacked.width, stacked.height);
    const nextSize =
      GRID_PRESETS.find((preset) => preset >= Math.max(maxDim, gridW)) ??
      Math.max(32, maxDim);
    const emptyStack = createLayerStack(nextSize, nextSize);
    const offsetX = Math.floor((nextSize - stacked.width) / 2);
    const offsetY = Math.floor((nextSize - stacked.height) / 2);
    const dropX = offsetX + stacked.anchorX;
    const dropY = offsetY + stacked.anchorY;
    const nextLayers = stampPrefabOntoLayerStack(
      emptyStack,
      nextSize,
      nextSize,
      { ...stacked, anchorZ: 0 },
      dropX,
      dropY,
      0,
      EMPTY_ASSET_ID
    );

    setBuildName(name);
    setGridW(nextSize);
    setGridH(nextSize);
    setLayers(nextLayers);
    setAnchorX(Math.max(0, Math.min(nextSize - 1, dropX)));
    setAnchorY(Math.max(0, Math.min(nextSize - 1, dropY)));
    setAnchorZ(stacked.anchorZ);
    setInspectedCell({
      col: Math.max(0, Math.min(nextSize - 1, dropX)),
      row: Math.max(0, Math.min(nextSize - 1, dropY)),
    });
    setFloatingTiles([]);
    setToolbarMessage({
      tone: 'neutral',
      text: `Loaded "${name}" (${stacked.width}×${stacked.height} · ${stacked.layers.length}L)`,
    });
  };

  const handleLoadIntermediate = (entry: SavedPrefabEntry): void => {
    try {
      const stacked = StackedPrefabCodec.decodeAny(base64ToArrayBuffer(entry.payloadBase64));
      loadDecodedPrefabIntoCanvas(entry.name, stacked);
    } catch (err: unknown) {
      setToolbarMessage({
        tone: 'negative',
        text: err instanceof Error ? err.message : 'Failed to decode local prefab',
      });
    }
  };

  const handlePlaceIntermediate = (entry: SavedPrefabEntry): void => {
    let decodedAnchorZ = entry.anchorZ ?? 0;
    try {
      decodedAnchorZ = StackedPrefabCodec.decodeAny(base64ToArrayBuffer(entry.payloadBase64)).anchorZ;
    } catch {
      // Keep fallback anchorZ
    }
    startWorldPlacement({
      prefabId: entry.id,
      name: entry.name,
      width: entry.width,
      height: entry.height,
      anchorX: entry.anchorX,
      anchorY: entry.anchorY,
      anchorZ: decodedAnchorZ,
      payloadBase64: entry.payloadBase64,
    });
    onClose();
  };

  const handleLoadBackend = async (summary: BackendPrefabSummary): Promise<void> => {
    setBusyBackendId(summary.id);
    setBackendStatus(null);
    try {
      const buffer = await fetchBackendPrefabPayload(summary.id, { accessToken });
      const stacked = StackedPrefabCodec.decodeAny(buffer);
      loadDecodedPrefabIntoCanvas(summary.name, stacked);
    } catch (err: unknown) {
      setBackendStatus({ tone: 'negative', text: formatBackendError(err) });
    } finally {
      setBusyBackendId(null);
    }
  };

  const handlePlaceBackend = async (summary: BackendPrefabSummary): Promise<void> => {
    setBusyBackendId(summary.id);
    setBackendStatus(null);
    try {
      const buffer = await fetchBackendPrefabPayload(summary.id, { accessToken });
      const stacked = StackedPrefabCodec.decodeAny(buffer);
      startWorldPlacement({
        prefabId: `backend:${summary.id}`,
        name: summary.name,
        width: stacked.width,
        height: stacked.height,
        anchorX: stacked.anchorX,
        anchorY: stacked.anchorY,
        anchorZ: stacked.anchorZ,
        payloadBase64: arrayBufferToBase64(buffer),
      });
      onClose();
    } catch (err: unknown) {
      setBackendStatus({ tone: 'negative', text: formatBackendError(err) });
    } finally {
      setBusyBackendId(null);
    }
  };

  const handleDeleteBackend = async (id: number): Promise<void> => {
    setBusyBackendId(id);
    setBackendStatus(null);
    try {
      await deleteBackendPrefab(id, { accessToken });
      removeBackendPrefab(id);
      setBackendStatus({ tone: 'neutral', text: `Deleted backend prefab #${id}` });
    } catch (err: unknown) {
      setBackendStatus({ tone: 'negative', text: formatBackendError(err) });
    } finally {
      setBusyBackendId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Building Editor"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        backgroundColor: TOKENS.bgDeepest,
        color: TOKENS.textPrimary,
        fontFamily: TOKENS.fontSans,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Toolbar */}
      <header
        style={{
          minHeight: 56,
          flexShrink: 0,
          padding: '8px 16px',
          backgroundColor: TOKENS.bgPanel,
          borderBottom: `1px solid ${TOKENS.hairline}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {/* Left: Name, Grid Preset, Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: TOKENS.textPrimary, marginRight: 4 }}>
            Building Editor
          </span>

          <input
            type="text"
            value={buildName}
            onChange={(e) => setBuildName(e.target.value)}
            placeholder="Building name"
            maxLength={100}
            aria-label="Building name"
            style={{
              height: 32,
              width: 164,
              padding: '0 10px',
              borderRadius: 6,
              border: `1px solid ${TOKENS.hairlineStrong}`,
              backgroundColor: TOKENS.bgRaised,
              color: TOKENS.textPrimary,
              fontFamily: TOKENS.fontSans,
              fontSize: 13,
              outline: 'none',
            }}
          />

          <div role="group" aria-label="Grid preset" style={{ display: 'inline-flex', gap: 4 }}>
            {GRID_PRESETS.map((size) => {
              const active = gridW === size && gridH === size;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => handleSelectPreset(size)}
                  style={{
                    ...(active ? activeButtonStyle : baseButtonStyle),
                    padding: '0 8px',
                    fontFamily: TOKENS.fontMono,
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {size}×{size}
                </button>
              );
            })}
          </div>

          <div
            role="group"
            aria-label="Cell zoom"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              paddingLeft: 8,
              borderLeft: `1px solid ${TOKENS.hairline}`,
            }}
          >
            {ZOOM_OPTIONS.map((zoom) => {
              const active = cellSize === zoom;
              return (
                <button
                  key={zoom}
                  type="button"
                  onClick={() => handleZoomChange(zoom)}
                  style={{
                    ...(active ? activeButtonStyle : baseButtonStyle),
                    padding: '0 8px',
                    fontFamily: TOKENS.fontMono,
                    fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {zoom}px
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: Tools + Snap + Stack + Z-Index + Undo/Redo/Clear */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setTool('paint')}
            style={tool === 'paint' ? activeButtonStyle : baseButtonStyle}
          >
            <PaintIcon size={15} />
            <span>Paint</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('erase')}
            style={tool === 'erase' ? activeButtonStyle : baseButtonStyle}
          >
            <EraseIcon size={15} />
            <span>Erase</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('anchor')}
            style={tool === 'anchor' ? activeButtonStyle : baseButtonStyle}
          >
            <AnchorIcon size={15} />
            <span>Anchor</span>
          </button>
          <button
            type="button"
            onClick={() => setTool('pick')}
            style={tool === 'pick' ? activeButtonStyle : baseButtonStyle}
          >
            <PickIcon size={15} />
            <span>Pick</span>
          </button>

          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: TOKENS.hairline,
              margin: '0 2px',
            }}
          />

          <button
            type="button"
            onClick={handleToggleSnap}
            title={
              snapEnabled
                ? 'Snap ON: tiles snap to grid cells. Click to switch to free placement.'
                : 'Snap OFF: free pixel drag. Click to commit floating tiles to grid.'
            }
            style={{
              ...(snapEnabled ? activeButtonStyle : baseButtonStyle),
              borderColor: snapEnabled ? TOKENS.accentHairline : TOKENS.warning,
              color: snapEnabled ? TOKENS.textPrimary : TOKENS.warning,
            }}
          >
            <SnapIcon size={15} />
            <span>{snapEnabled ? 'Snap: On' : 'Snap: Off'}</span>
          </button>

          <button
            type="button"
            onClick={() => setStackOnTop((prev) => !prev)}
            title={
              stackOnTop
                ? 'Stack ON: dropping on an occupied cell automatically places the tile on top (e.g. tree on grass).'
                : 'Stack OFF: replaces only the tile at the selected Z-Index.'
            }
            style={stackOnTop ? activeButtonStyle : baseButtonStyle}
          >
            <LayersIcon size={15} />
            <span>{stackOnTop ? 'Stack: On' : 'Stack: Off'}</span>
          </button>

          <div
            role="group"
            aria-label="Anchor Z-Index"
            title="Reference Anchor Z-Index (character is z=0; shifts the whole prefab above or below the player)"
            style={{
              height: 32,
              padding: '0 6px',
              borderRadius: 6,
              border: `1px solid ${TOKENS.warning}`,
              backgroundColor: TOKENS.bgRaised,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                fontFamily: TOKENS.fontMono,
                fontSize: 11,
                color: TOKENS.warning,
                paddingLeft: 2,
              }}
            >
              AnchorZ
            </span>
            <button
              type="button"
              onClick={() => {
                pushUndoSnapshot();
                setAnchorZ((z) => clampZ(z - 1));
              }}
              aria-label="Decrease Anchor Z"
              style={{
                width: 20,
                height: 22,
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgPanel,
                color: TOKENS.textPrimary,
                cursor: 'pointer',
                fontFamily: TOKENS.fontMono,
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              -
            </button>
            <input
              type="number"
              min={-32768}
              max={32767}
              value={anchorZ}
              aria-label="Anchor Z-Index value"
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(parsed)) {
                  pushUndoSnapshot();
                  setAnchorZ(clampZ(parsed));
                }
              }}
              style={{
                width: 42,
                height: 22,
                padding: '0 4px',
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                backgroundColor: TOKENS.bgDeepest,
                color: TOKENS.warning,
                fontFamily: TOKENS.fontMono,
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'center',
              }}
            />
            <button
              type="button"
              onClick={() => {
                pushUndoSnapshot();
                setAnchorZ((z) => clampZ(z + 1));
              }}
              aria-label="Increase Anchor Z"
              style={{
                width: 20,
                height: 22,
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgPanel,
                color: TOKENS.textPrimary,
                cursor: 'pointer',
                fontFamily: TOKENS.fontMono,
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>

          <div
            role="group"
            aria-label="Relative Block Z-Index"
            title={`Block Z relative to AnchorZ (${anchorZ}). World Z = ${anchorZ + activeZIndex} (${anchorZ + activeZIndex > 0 ? 'Over Player' : 'Under Player'})`}
            style={{
              height: 32,
              padding: '0 6px',
              borderRadius: 6,
              border: `1px solid ${TOKENS.hairline}`,
              backgroundColor: TOKENS.bgRaised,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                fontFamily: TOKENS.fontMono,
                fontSize: 11,
                color: TOKENS.textSecondary,
                paddingLeft: 2,
              }}
            >
              RelZ
            </span>
            <button
              type="button"
              onClick={() => setActiveZIndex((z) => clampZ(z - 1))}
              aria-label="Decrease Relative Z-Index"
              style={{
                width: 20,
                height: 22,
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgPanel,
                color: TOKENS.textPrimary,
                cursor: 'pointer',
                fontFamily: TOKENS.fontMono,
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              -
            </button>
            <input
              type="number"
              min={-32768}
              max={32767}
              value={activeZIndex}
              aria-label="Relative Z-Index value"
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(parsed)) {
                  setActiveZIndex(clampZ(parsed));
                }
              }}
              style={{
                width: 42,
                height: 22,
                padding: '0 4px',
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                backgroundColor: TOKENS.bgDeepest,
                color: TOKENS.textPrimary,
                fontFamily: TOKENS.fontMono,
                fontSize: 12,
                fontVariantNumeric: 'tabular-nums',
                textAlign: 'center',
              }}
            />
            <button
              type="button"
              onClick={() => setActiveZIndex((z) => clampZ(z + 1))}
              aria-label="Increase Relative Z-Index"
              style={{
                width: 20,
                height: 22,
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgPanel,
                color: TOKENS.textPrimary,
                cursor: 'pointer',
                fontFamily: TOKENS.fontMono,
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Undo (Ctrl+Z)"
            style={{
              ...baseButtonStyle,
              padding: '0 8px',
              opacity: undoStack.length === 0 ? 0.45 : 1,
            }}
          >
            <UndoIcon size={15} />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Redo (Ctrl+Y)"
            style={{
              ...baseButtonStyle,
              padding: '0 8px',
              opacity: redoStack.length === 0 ? 0.45 : 1,
            }}
          >
            <RedoIcon size={15} />
          </button>
          <button
            type="button"
            onClick={handleClear}
            title="Clear canvas"
            style={{ ...baseButtonStyle, padding: '0 8px' }}
          >
            <ClearIcon size={15} />
            <span>Clear</span>
          </button>
        </div>

        {/* Right: Telemetry + Save/Place/Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            title="Live PrefabCodec RLE + Palette compression telemetry"
            style={{
              height: 32,
              padding: '0 10px',
              borderRadius: 6,
              border: `1px solid ${TOKENS.hairline}`,
              backgroundColor: TOKENS.bgDeepest,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: TOKENS.fontMono,
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              color: TOKENS.textSecondary,
            }}
          >
            {telemetry.stacked.width === 0 ? (
              <span>0×0 · 9 B</span>
            ) : (
              <>
                <span style={{ color: TOKENS.textPrimary }}>
                  {telemetry.stacked.width}×{telemetry.stacked.height}
                  {telemetry.layerCount > 1 ? ` · ${telemetry.layerCount}L` : ''}
                </span>
                <span style={{ color: TOKENS.textMuted }}>
                  {telemetry.rawByteLength} → {telemetry.compressedByteLength} B
                </span>
                <span style={{ color: TOKENS.positive }}>{savedPercent}% saved</span>
              </>
            )}
          </div>

          <button type="button" onClick={handleSaveIntermediate} style={baseButtonStyle}>
            <SaveIcon size={15} />
            <span>Save Intermediate</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSaveToBackend()}
            disabled={isSavingBackend}
            style={{
              ...primaryButtonStyle,
              opacity: isSavingBackend ? 0.65 : 1,
            }}
          >
            <CloudUploadIcon size={15} />
            <span>{isSavingBackend ? 'Saving...' : 'Save to Backend'}</span>
          </button>

          <button
            type="button"
            onClick={handlePlaceCurrentInWorld}
            style={accentButtonStyle}
          >
            <PlaceIcon size={15} />
            <span>Place in World</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{ ...baseButtonStyle, padding: '0 10px' }}
          >
            <CloseIcon size={15} />
            <kbd style={keycapStyle}>Esc</kbd>
          </button>
        </div>
      </header>

      {toolbarMessage && (
        <div
          style={{
            padding: '6px 16px',
            borderBottom: `1px solid ${TOKENS.hairline}`,
            backgroundColor:
              toolbarMessage.tone === 'positive'
                ? TOKENS.positiveSurface
                : toolbarMessage.tone === 'negative'
                  ? TOKENS.negativeSurface
                  : TOKENS.bgRaised,
            color:
              toolbarMessage.tone === 'positive'
                ? TOKENS.positive
                : toolbarMessage.tone === 'negative'
                  ? TOKENS.negative
                  : TOKENS.textSecondary,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{toolbarMessage.text}</span>
          <button
            type="button"
            onClick={() => setToolbarMessage(null)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 4px',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main 3-Column Workshop Body */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <AssetPaletteSidebar
          activeSheetId={activeSheetId}
          onSelectSheet={setActiveSheetId}
          tiles={activeSheetTiles}
          selectedAssetId={effectiveSelectedAssetId}
          isLoading={isLibraryLoading}
          loadError={libraryError}
          onSelectTile={(assetId) => {
            setSelectedAssetId(assetId);
            setTool('paint');
          }}
          onDragStartPayload={(payload) => setActiveDragPayload(payload)}
          onDragEndPayload={() => setActiveDragPayload(null)}
        />

        <EditorGridCanvas
          gridW={gridW}
          gridH={gridH}
          cellSize={cellSize}
          layers={layers}
          anchorX={anchorX}
          anchorY={anchorY}
          anchorZ={anchorZ}
          activeZIndex={activeZIndex}
          stackOnTop={stackOnTop}
          inspectedCell={inspectedCell}
          tool={tool}
          snapEnabled={snapEnabled}
          selectedAssetId={effectiveSelectedAssetId}
          floatingTiles={floatingTiles}
          activeDragPayload={activeDragPayload}
          resolveDraggedPrefab={resolveDraggedPrefab}
          getPreviewUrl={getPreviewUrl}
          onSelectCell={(col, row) => setInspectedCell({ col, row })}
          onBeginStroke={pushUndoSnapshot}
          onPaintCell={handlePaintCell}
          onEraseCell={handleEraseCell}
          onSetAnchor={handleSetAnchor}
          onPickAsset={handlePickAsset}
          onAddFreeTile={handleAddFreeTile}
          onMoveFreeTile={handleMoveFreeTile}
          onRemoveFreeTile={handleRemoveFreeTile}
          onDropTile={handleDropTile}
          onDropPrefab={handleDropPrefab}
        />

        <SavedBuildingsSidebar
          inspectedCell={inspectedCell}
          inspectedCellStack={inspectedCellStack}
          anchorZ={anchorZ}
          activeZIndex={activeZIndex}
          onSelectActiveZIndex={(z) => setActiveZIndex(clampZ(z))}
          onChangeCellTileZIndex={handleChangeCellTileZIndex}
          onRemoveCellTile={handleRemoveCellTile}
          intermediatePrefabs={intermediatePrefabs}
          backendPrefabs={backendPrefabs}
          backendStatus={backendStatus}
          isSyncingBackend={isSyncingBackend}
          busyBackendId={busyBackendId}
          getPreviewUrl={getPreviewUrl}
          onDragStartPayload={(payload) => setActiveDragPayload(payload)}
          onDragEndPayload={() => setActiveDragPayload(null)}
          onLoadIntermediate={handleLoadIntermediate}
          onPlaceIntermediate={handlePlaceIntermediate}
          onDeleteIntermediate={deleteIntermediatePrefab}
          onRefreshBackend={() => void handleRefreshBackend()}
          onLoadBackend={(summary) => void handleLoadBackend(summary)}
          onPlaceBackend={(summary) => void handlePlaceBackend(summary)}
          onDeleteBackend={(id) => void handleDeleteBackend(id)}
        />
      </div>
    </div>
  );
}
