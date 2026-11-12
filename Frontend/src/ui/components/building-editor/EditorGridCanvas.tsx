import {
  type DragEvent,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EMPTY_ASSET_ID } from '../../../engine/prefab/assetRegistry.ts';
import type { StackedPrefabData } from '../../../engine/prefab/PrefabCodec.ts';
import {
  clampFreePixelPosition,
  computeStackedStampPreviewCells,
  type FreePlacedTile,
  type LayerGrid,
} from '../../../engine/prefab/builderGrid.ts';
import type { DragPayload } from './AssetPaletteSidebar.tsx';
import { AnchorIcon } from './icons.tsx';
import { keycapStyle, TOKENS } from './theme.ts';

export type EditorTool = 'paint' | 'erase' | 'anchor' | 'pick';

interface EditorGridCanvasProps {
  gridW: number;
  gridH: number;
  cellSize: number;
  layers: ReadonlyArray<LayerGrid>;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  activeZIndex: number;
  stackOnTop: boolean;
  inspectedCell: { col: number; row: number } | null;
  tool: EditorTool;
  snapEnabled: boolean;
  selectedAssetId: number;
  floatingTiles: readonly FreePlacedTile[];
  activeDragPayload: DragPayload | null;
  resolveDraggedPrefab: (id: string) => StackedPrefabData | null;
  getPreviewUrl: (assetId: number) => string | undefined;
  onSelectCell: (col: number, row: number) => void;
  onBeginStroke: () => void;
  onPaintCell: (col: number, row: number) => void;
  onEraseCell: (col: number, row: number) => void;
  onSetAnchor: (col: number, row: number) => void;
  onPickAsset: (assetId: number) => void;
  onAddFreeTile: (assetId: number, pixelX: number, pixelY: number) => string;
  onMoveFreeTile: (id: string, pixelX: number, pixelY: number) => void;
  onRemoveFreeTile: (id: string) => void;
  onDropTile: (
    assetId: number,
    col: number,
    row: number,
    pixelX: number,
    pixelY: number
  ) => void;
  onDropPrefab: (prefabId: string, col: number, row: number) => void;
}

interface StrokeState {
  mode: 'paint' | 'erase';
  lastCellKey: string;
}

interface DraggingFloatingState {
  id: string;
  offsetX: number;
  offsetY: number;
}

export function EditorGridCanvas({
  gridW,
  gridH,
  cellSize,
  layers,
  anchorX,
  anchorY,
  anchorZ,
  activeZIndex,
  stackOnTop,
  inspectedCell,
  tool,
  snapEnabled,
  selectedAssetId,
  floatingTiles,
  activeDragPayload,
  resolveDraggedPrefab,
  getPreviewUrl,
  onSelectCell,
  onBeginStroke,
  onPaintCell,
  onEraseCell,
  onSetAnchor,
  onPickAsset,
  onAddFreeTile,
  onMoveFreeTile,
  onRemoveFreeTile,
  onDropTile,
  onDropPrefab,
}: EditorGridCanvasProps): JSX.Element {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const strokeRef = useRef<StrokeState | null>(null);
  const [draggingFloating, setDraggingFloating] = useState<DraggingFloatingState | null>(null);
  const [hoverCell, setHoverCell] = useState<{ col: number; row: number } | null>(null);
  const [dragHoverCell, setDragHoverCell] = useState<{ col: number; row: number } | null>(null);
  const [dragFreePixel, setDragFreePixel] = useState<{ pixelX: number; pixelY: number } | null>(
    null
  );

  const canvasWidth = gridW * cellSize;
  const canvasHeight = gridH * cellSize;

  const sortedLayers = useMemo(
    () => [...layers].sort((a, b) => a.zIndex - b.zIndex),
    [layers]
  );

  const sortedFloatingTiles = useMemo(
    () => [...floatingTiles].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)),
    [floatingTiles]
  );

  const getLocalCoords = useCallback(
    (
      clientX: number,
      clientY: number
    ): { col: number; row: number; localX: number; localY: number } | null => {
      const el = gridRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const col = Math.max(0, Math.min(gridW - 1, Math.floor(localX / cellSize)));
      const row = Math.max(0, Math.min(gridH - 1, Math.floor(localY / cellSize)));
      return { col, row, localX, localY };
    },
    [gridW, gridH, cellSize]
  );

  // Global pointer tracking for painting strokes and smooth free-tile dragging
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent): void => {
      if (draggingFloating) {
        const el = gridRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const rawX = e.clientX - rect.left - draggingFloating.offsetX;
        const rawY = e.clientY - rect.top - draggingFloating.offsetY;
        const clamped = clampFreePixelPosition(rawX, rawY, gridW, gridH, cellSize);
        onMoveFreeTile(draggingFloating.id, clamped.pixelX, clamped.pixelY);
        return;
      }

      if (strokeRef.current) {
        const coords = getLocalCoords(e.clientX, e.clientY);
        if (!coords) return;
        setHoverCell({ col: coords.col, row: coords.row });
        const cellKey = `${coords.col},${coords.row}`;
        if (cellKey !== strokeRef.current.lastCellKey) {
          strokeRef.current.lastCellKey = cellKey;
          onSelectCell(coords.col, coords.row);
          if (strokeRef.current.mode === 'paint') {
            onPaintCell(coords.col, coords.row);
          } else {
            onEraseCell(coords.col, coords.row);
          }
        }
      }
    };

    const handlePointerUp = (): void => {
      strokeRef.current = null;
      setDraggingFloating(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [
    draggingFloating,
    gridW,
    gridH,
    cellSize,
    getLocalCoords,
    onMoveFreeTile,
    onPaintCell,
    onEraseCell,
    onSelectCell,
  ]);

  const handleGridPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const coords = getLocalCoords(e.clientX, e.clientY);
    if (!coords) return;

    onSelectCell(coords.col, coords.row);

    // Right-click always erases topmost tile at cell
    if (e.button === 2) {
      e.preventDefault();
      onBeginStroke();
      strokeRef.current = { mode: 'erase', lastCellKey: `${coords.col},${coords.row}` };
      onEraseCell(coords.col, coords.row);
      return;
    }

    if (e.button !== 0) return;

    if (tool === 'anchor') {
      onSetAnchor(coords.col, coords.row);
      return;
    }

    if (tool === 'pick') {
      const idx = coords.row * gridW + coords.col;
      for (let i = sortedLayers.length - 1; i >= 0; i--) {
        const picked = sortedLayers[i].grid[idx];
        if (picked !== EMPTY_ASSET_ID) {
          onPickAsset(picked);
          break;
        }
      }
      return;
    }

    if (tool === 'erase') {
      onBeginStroke();
      strokeRef.current = { mode: 'erase', lastCellKey: `${coords.col},${coords.row}` };
      onEraseCell(coords.col, coords.row);
      return;
    }

    // tool === 'paint'
    if (selectedAssetId === EMPTY_ASSET_ID) return;

    if (!snapEnabled) {
      const clamped = clampFreePixelPosition(
        coords.localX - cellSize / 2,
        coords.localY - cellSize / 2,
        gridW,
        gridH,
        cellSize
      );
      onBeginStroke();
      const createdId = onAddFreeTile(selectedAssetId, clamped.pixelX, clamped.pixelY);
      setDraggingFloating({
        id: createdId,
        offsetX: cellSize / 2,
        offsetY: cellSize / 2,
      });
      return;
    }

    onBeginStroke();
    strokeRef.current = { mode: 'paint', lastCellKey: `${coords.col},${coords.row}` };
    onPaintCell(coords.col, coords.row);
  };

  const handleFloatingPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    tile: FreePlacedTile
  ): void => {
    e.stopPropagation();

    if (e.button === 2 || tool === 'erase') {
      e.preventDefault();
      onBeginStroke();
      onRemoveFreeTile(tile.id);
      return;
    }

    if (tool === 'pick') {
      onPickAsset(tile.assetId);
      return;
    }

    if (tool === 'anchor') {
      const coords = getLocalCoords(e.clientX, e.clientY);
      if (coords) {
        onSetAnchor(coords.col, coords.row);
      }
      return;
    }

    if (e.button !== 0) return;
    const el = gridRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onBeginStroke();
    setDraggingFloating({
      id: tile.id,
      offsetX: e.clientX - rect.left - tile.pixelX,
      offsetY: e.clientY - rect.top - tile.pixelY,
    });
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const coords = getLocalCoords(e.clientX, e.clientY);
    if (!coords) return;

    setDragHoverCell({ col: coords.col, row: coords.row });
    if (!snapEnabled && activeDragPayload?.kind === 'tile') {
      setDragFreePixel(
        clampFreePixelPosition(
          coords.localX - cellSize / 2,
          coords.localY - cellSize / 2,
          gridW,
          gridH,
          cellSize
        )
      );
    } else {
      setDragFreePixel(null);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    const related = e.relatedTarget as Node | null;
    if (related && gridRef.current?.contains(related)) {
      return;
    }
    setDragHoverCell(null);
    setDragFreePixel(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const coords = getLocalCoords(e.clientX, e.clientY);
    setDragHoverCell(null);
    setDragFreePixel(null);
    if (!coords) return;

    let payload: DragPayload | null = activeDragPayload;
    const rawJson =
      e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson) as Partial<DragPayload>;
        if (parsed.kind === 'tile' && typeof parsed.assetId === 'number') {
          payload = { kind: 'tile', assetId: parsed.assetId };
        } else if (parsed.kind === 'prefab' && typeof parsed.id === 'string') {
          payload = { kind: 'prefab', id: parsed.id };
        }
      } catch {
        // Fallback to activeDragPayload
      }
    }

    if (!payload) return;
    onSelectCell(coords.col, coords.row);

    if (payload.kind === 'tile') {
      const clamped = clampFreePixelPosition(
        coords.localX - cellSize / 2,
        coords.localY - cellSize / 2,
        gridW,
        gridH,
        cellSize
      );
      onDropTile(payload.assetId, coords.col, coords.row, clamped.pixelX, clamped.pixelY);
    } else if (payload.kind === 'prefab') {
      onDropPrefab(payload.id, coords.col, coords.row);
    }
  };

  // Live ghost footprint preview via computeStackedStampPreviewCells
  const dragPreviewCells = useMemo(() => {
    if (!dragHoverCell || !activeDragPayload) return [];
    if (activeDragPayload.kind === 'prefab') {
      const stacked = resolveDraggedPrefab(activeDragPayload.id);
      if (!stacked) return [];
      return computeStackedStampPreviewCells(
        gridW,
        gridH,
        stacked,
        dragHoverCell.col,
        dragHoverCell.row,
        activeZIndex,
        EMPTY_ASSET_ID
      );
    }
    if (snapEnabled && activeDragPayload.kind === 'tile') {
      return [
        {
          x: dragHoverCell.col,
          y: dragHoverCell.row,
          zIndex: activeZIndex,
          assetId: activeDragPayload.assetId,
        },
      ];
    }
    return [];
  }, [
    dragHoverCell,
    activeDragPayload,
    resolveDraggedPrefab,
    gridW,
    gridH,
    snapEnabled,
    activeZIndex,
  ]);

  const cellIndices = useMemo(() => {
    const total = gridW * gridH;
    return Array.from({ length: total }, (_, idx) => idx);
  }, [gridW, gridH]);

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
  };

  const hoveredStackCount = useMemo(() => {
    if (!hoverCell) return 0;
    const idx = hoverCell.row * gridW + hoverCell.col;
    let count = 0;
    for (const layer of sortedLayers) {
      if (layer.grid[idx] !== EMPTY_ASSET_ID) count++;
    }
    return count;
  }, [hoverCell, gridW, sortedLayers]);

  return (
    <main
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        backgroundColor: TOKENS.bgCanvas,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Scrollable drafting area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          ref={gridRef}
          onPointerDown={handleGridPointerDown}
          onPointerMove={(e) => {
            const coords = getLocalCoords(e.clientX, e.clientY);
            if (coords) setHoverCell({ col: coords.col, row: coords.row });
          }}
          onPointerLeave={() => setHoverCell(null)}
          onContextMenu={handleContextMenu}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            position: 'relative',
            width: canvasWidth,
            height: canvasHeight,
            flexShrink: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${gridW}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${gridH}, ${cellSize}px)`,
            border: `1px solid ${TOKENS.hairlineStrong}`,
            backgroundColor: TOKENS.bgDeepest,
            userSelect: 'none',
            cursor:
              tool === 'erase'
                ? 'crosshair'
                : tool === 'anchor'
                  ? 'cell'
                  : tool === 'pick'
                    ? 'copy'
                    : 'crosshair',
          }}
        >
          {cellIndices.map((idx) => {
            const col = idx % gridW;
            const row = Math.floor(idx / gridW);
            const isCheckerAlt = (col + row) % 2 === 1;
            const isHovered = hoverCell?.col === col && hoverCell?.row === row;
            const isInspected = inspectedCell?.col === col && inspectedCell?.row === row;
            const isAnchor = col === anchorX && row === anchorY;

            const cellStack: Array<{ zIndex: number; assetId: number; url: string | undefined }> = [];
            for (const layer of sortedLayers) {
              const assetId = layer.grid[idx];
              if (assetId !== EMPTY_ASSET_ID) {
                cellStack.push({
                  zIndex: layer.zIndex,
                  assetId,
                  url: getPreviewUrl(assetId),
                });
              }
            }

            return (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  width: cellSize,
                  height: cellSize,
                  boxSizing: 'border-box',
                  backgroundColor: isCheckerAlt ? '#121622' : '#0f131d',
                  borderRight:
                    col < gridW - 1 ? `1px solid rgba(238, 240, 245, 0.05)` : 'none',
                  borderBottom:
                    row < gridH - 1 ? `1px solid rgba(238, 240, 245, 0.05)` : 'none',
                }}
              >
                {cellStack.map((entry, stackIdx) =>
                  entry.url ? (
                    <img
                      key={`${entry.zIndex}-${entry.assetId}`}
                      src={entry.url}
                      alt=""
                      draggable={false}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        display: 'block',
                        imageRendering: 'pixelated',
                        pointerEvents: 'none',
                        zIndex: stackIdx + 1,
                      }}
                    />
                  ) : null
                )}

                {cellStack.length > 1 ? (
                  <span
                    title={`${cellStack.length} stacked layers`}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      zIndex: cellStack.length + 2,
                      minWidth: 14,
                      height: 14,
                      padding: '0 3px',
                      borderRadius: 3,
                      backgroundColor: 'rgba(9, 11, 16, 0.85)',
                      border: `1px solid ${TOKENS.hairlineStrong}`,
                      color: TOKENS.textPrimary,
                      fontFamily: TOKENS.fontMono,
                      fontSize: 9,
                      lineHeight: '12px',
                      textAlign: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    {cellStack.length}
                  </span>
                ) : null}

                {isInspected ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      border: `1px solid ${TOKENS.accent}`,
                      pointerEvents: 'none',
                      zIndex: cellStack.length + 3,
                    }}
                  />
                ) : isHovered && !dragHoverCell ? (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      border: `1px solid ${TOKENS.hairlineStrong}`,
                      pointerEvents: 'none',
                      zIndex: cellStack.length + 3,
                    }}
                  />
                ) : null}

                {isAnchor ? (
                  <div
                    title={`Anchor (${anchorX}, ${anchorY})`}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      border: `2px solid ${TOKENS.warning}`,
                      backgroundColor: 'rgba(229, 169, 60, 0.14)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: TOKENS.warning,
                      pointerEvents: 'none',
                      zIndex: cellStack.length + 4,
                    }}
                  >
                    <AnchorIcon size={Math.max(12, Math.floor(cellSize * 0.45))} />
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Multi-tile / multi-layer HTML5 Drag-Over Ghost Footprint */}
          {dragPreviewCells.map((cell, previewIdx) => {
            const url = getPreviewUrl(cell.assetId);
            return (
              <div
                key={`ghost-${cell.x}-${cell.y}-${cell.zIndex}-${previewIdx}`}
                style={{
                  position: 'absolute',
                  left: cell.x * cellSize,
                  top: cell.y * cellSize,
                  width: cellSize,
                  height: cellSize,
                  border: `1px solid ${TOKENS.accent}`,
                  backgroundColor: TOKENS.accentSurface,
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  zIndex: 20 + previewIdx,
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      imageRendering: 'pixelated',
                      opacity: 0.6,
                    }}
                  />
                ) : null}
              </div>
            );
          })}

          {/* Free-drag HTML5 tile drop ghost when Snap is OFF */}
          {dragFreePixel && activeDragPayload?.kind === 'tile' ? (
            <div
              style={{
                position: 'absolute',
                left: dragFreePixel.pixelX,
                top: dragFreePixel.pixelY,
                width: cellSize,
                height: cellSize,
                border: `1px dashed ${TOKENS.accent}`,
                backgroundColor: TOKENS.accentSurface,
                boxSizing: 'border-box',
                pointerEvents: 'none',
                zIndex: 40,
              }}
            >
              {getPreviewUrl(activeDragPayload.assetId) ? (
                <img
                  src={getPreviewUrl(activeDragPayload.assetId)}
                  alt=""
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    imageRendering: 'pixelated',
                    opacity: 0.65,
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {/* Floating FreePlacedTile items (Snap OFF) */}
          {sortedFloatingTiles.map((tile, floatIdx) => {
            const url = getPreviewUrl(tile.assetId);
            const isDragging = draggingFloating?.id === tile.id;
            const tileZ = tile.zIndex ?? 0;
            return (
              <div
                key={tile.id}
                onPointerDown={(e) => handleFloatingPointerDown(e, tile)}
                onContextMenu={handleContextMenu}
                title={`z=${tileZ} · Drag freely or toggle Snap On to commit`}
                style={{
                  position: 'absolute',
                  left: tile.pixelX,
                  top: tile.pixelY,
                  width: cellSize,
                  height: cellSize,
                  boxSizing: 'border-box',
                  border: `1px solid ${TOKENS.accent}`,
                  backgroundColor: 'rgba(56, 189, 248, 0.08)',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  zIndex: isDragging ? 90 : 50 + floatIdx,
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      imageRendering: 'pixelated',
                      pointerEvents: 'none',
                    }}
                  />
                ) : null}
                <span
                  style={{
                    position: 'absolute',
                    bottom: 1,
                    right: 1,
                    padding: '0 3px',
                    borderRadius: 2,
                    backgroundColor: 'rgba(9, 11, 16, 0.86)',
                    color: TOKENS.accent,
                    fontFamily: TOKENS.fontMono,
                    fontSize: 9,
                    lineHeight: '12px',
                    pointerEvents: 'none',
                  }}
                >
                  z{tileZ}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Drafting Status Bar */}
      <div
        style={{
          height: 36,
          flexShrink: 0,
          padding: '0 16px',
          backgroundColor: TOKENS.bgPanel,
          borderTop: `1px solid ${TOKENS.hairline}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          fontSize: 12,
          color: TOKENS.textSecondary,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontFamily: TOKENS.fontMono,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span>
            Cell: {hoverCell ? `${hoverCell.col}, ${hoverCell.row}` : '--'}
            {hoverCell && hoveredStackCount > 0 ? ` (${hoveredStackCount}L)` : ''}
          </span>
          <span>
            RelZ: {activeZIndex} · WorldZ: {anchorZ + activeZIndex} (
            {anchorZ + activeZIndex > 0 ? 'Over Player' : 'Under Player'}) ·{' '}
            {stackOnTop ? 'Stack' : 'Replace'}
          </span>
          <span style={{ color: TOKENS.warning }}>
            Anchor: ({anchorX}, {anchorY}, z={anchorZ})
          </span>
          {floatingTiles.length > 0 ? (
            <span style={{ color: TOKENS.accent }}>
              {floatingTiles.length} floating {floatingTiles.length === 1 ? 'tile' : 'tiles'} · Toggle Snap On to commit
            </span>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: TOKENS.textMuted }}>
          <span>Right-click Erase Top</span>
          <span>
            <kbd style={keycapStyle}>Ctrl+Z</kbd> Undo
          </span>
          <span>
            <kbd style={keycapStyle}>Ctrl+Y</kbd> Redo
          </span>
        </div>
      </div>
    </main>
  );
}
