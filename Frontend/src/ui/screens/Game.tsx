import {
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AssetLibraryLoader,
  GameLoop,
  NOISE_PALETTE,
  StackedPrefabCodec,
  type World,
} from '../../engine/index.ts';
import { base64ToArrayBuffer } from '../../engine/prefab/builderGrid.ts';
import { useGameStore } from '../../store/gameStore.ts';
import { usePrefabStore } from '../../store/prefabStore.ts';
import { BuildingEditorModal } from '../components/BuildingEditorModal.tsx';
import { CloseIcon, DiceIcon, PlaceIcon } from '../components/building-editor/icons.tsx';
import { TOKENS } from '../components/building-editor/theme.ts';

const kbdStyle: CSSProperties = {
  color: '#eef0f5',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  padding: '2px 6px',
  borderRadius: 4,
  fontFamily: TOKENS.fontMono,
  fontSize: 11,
};

export default function Game(): JSX.Element {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<World | null>(null);
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryLoader | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);

  // Zustand world & culling subscriptions
  const worldSeed = useGameStore((state) => state.worldSeed);
  const bufferMargin = useGameStore((state) => state.bufferMargin);
  const playerCoords = useGameStore((state) => state.playerCoords);
  const tileCoords = useGameStore((state) => state.tileCoords);
  const chunkCoords = useGameStore((state) => state.chunkCoords);
  const cullingTelemetry = useGameStore((state) => state.cullingTelemetry);
  const showDebugOverlay = useGameStore((state) => state.showDebugOverlay);
  const inspectInsetCulling = useGameStore((state) => state.inspectInsetCulling);
  const showNoiseVisualizer = useGameStore((state) => state.showNoiseVisualizer);
  const zoomLevel = useGameStore((state) => state.zoomLevel);
  const activeTileNoise = useGameStore((state) => state.activeTileNoise);

  const toggleDebugOverlay = useGameStore((state) => state.toggleDebugOverlay);
  const toggleInspectInsetCulling = useGameStore((state) => state.toggleInspectInsetCulling);
  const toggleNoiseVisualizer = useGameStore((state) => state.toggleNoiseVisualizer);
  const cycleZoomLevel = useGameStore((state) => state.cycleZoomLevel);
  const setZoomLevel = useGameStore((state) => state.setZoomLevel);
  const setBufferMargin = useGameStore((state) => state.setBufferMargin);
  const setWorldSeed = useGameStore((state) => state.setWorldSeed);

  // Building Editor & Prefab placement subscriptions
  const isEditorOpen = usePrefabStore((state) => state.isEditorOpen);
  const activePlacement = usePrefabStore((state) => state.activePlacement);
  const openEditor = usePrefabStore((state) => state.openEditor);
  const closeEditor = usePrefabStore((state) => state.closeEditor);
  const setActivePlacementAnchorZ = usePrefabStore((state) => state.setActivePlacementAnchorZ);
  const cancelWorldPlacement = usePrefabStore((state) => state.cancelWorldPlacement);
  const recordPlacedWorldPrefab = usePrefabStore((state) => state.recordPlacedWorldPrefab);

  const placementAnchorZ = activePlacement?.anchorZ ?? 0;

  const decodedActivePlacement = useMemo(() => {
    if (!activePlacement) return null;
    try {
      const buffer = base64ToArrayBuffer(activePlacement.payloadBase64);
      const prefab = StackedPrefabCodec.decodeAny(buffer);
      return { buffer, prefab };
    } catch (err: unknown) {
      console.error('Failed to decode active placement prefab:', err);
      return null;
    }
  }, [activePlacement]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    let disposed = false;

    // Create a fresh canvas per effect lifecycle so React StrictMode remounts
    // never inherit a WebGL context destroyed by PixiJS loseContext().
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.replaceChildren(canvas);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const gameLoop = new GameLoop(canvas, {
      rendererConfig: { width, height },
    });
    const world = gameLoop.getWorld();
    worldRef.current = world;
    world.setEditorOpen(usePrefabStore.getState().isEditorOpen);

    gameLoop
      .start()
      .then(() => {
        if (disposed) return;
        setAssetLibrary(world.getAssetLibrary());
        const placed = usePrefabStore.getState().placedWorldPrefabs;
        for (const entry of placed) {
          if (!entry.payloadBase64) continue;
          try {
            const buffer = base64ToArrayBuffer(entry.payloadBase64);
            world.stampPrefabInWorld(buffer, entry.worldX, entry.worldY, entry.anchorZ);
          } catch (err: unknown) {
            console.warn('Skipping invalid persisted placed prefab:', entry.id, err);
          }
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        console.error('Failed to initialize Pixi game engine:', err);
        setInitError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      worldRef.current = null;
      gameLoop.destroy();
      canvas.remove();
    };
  }, []);

  // Keep World movement pause synchronized with editor modal state
  useEffect(() => {
    worldRef.current?.setEditorOpen(isEditorOpen);
    if (isEditorOpen) {
      worldRef.current?.updatePlacementPreview(null, 0, 0);
    }
  }, [isEditorOpen]);

  // Clear preview whenever activePlacement clears
  useEffect(() => {
    if (!activePlacement) {
      worldRef.current?.updatePlacementPreview(null, 0, 0);
    }
  }, [activePlacement]);

  // Global [B] shortcut to open Building Editor and [Esc] to cancel active world placement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inTextInput =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT');

      if (!isEditorOpen && !inTextInput && e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openEditor();
        return;
      }

      if (!isEditorOpen && !inTextInput && e.code === 'KeyV' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleNoiseVisualizer();
        return;
      }

      if (!isEditorOpen && !inTextInput && e.code === 'KeyZ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        cycleZoomLevel();
        return;
      }

      if (!isEditorOpen && !inTextInput && e.code === 'KeyL' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowLegend((prev) => !prev);
        return;
      }

      if (!isEditorOpen && activePlacement && e.key === 'Escape') {
        e.preventDefault();
        cancelWorldPlacement();
        return;
      }

      if (!isEditorOpen && !inTextInput && activePlacement && e.key === '[') {
        e.preventDefault();
        setActivePlacementAnchorZ(placementAnchorZ - 1);
        return;
      }

      if (!isEditorOpen && !inTextInput && activePlacement && e.key === ']') {
        e.preventDefault();
        setActivePlacementAnchorZ(placementAnchorZ + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isEditorOpen,
    activePlacement,
    placementAnchorZ,
    openEditor,
    cancelWorldPlacement,
    setActivePlacementAnchorZ,
    toggleNoiseVisualizer,
    cycleZoomLevel,
  ]);

  const handleCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (isEditorOpen || !decodedActivePlacement || !worldRef.current || !canvasContainerRef.current) {
      return;
    }
    const rect = canvasContainerRef.current.getBoundingClientRect();
    const snapped = worldRef.current.screenToSnappedTileWorld(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    worldRef.current.updatePlacementPreview(
      decodedActivePlacement.prefab,
      snapped.worldX,
      snapped.worldY,
      placementAnchorZ
    );
  };

  const handleCanvasPointerLeave = (): void => {
    if (!activePlacement) return;
    worldRef.current?.updatePlacementPreview(null, 0, 0);
  };

  const handleCanvasClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (
      e.button !== 0 ||
      isEditorOpen ||
      !activePlacement ||
      !decodedActivePlacement ||
      !worldRef.current ||
      !canvasContainerRef.current
    ) {
      return;
    }

    const rect = canvasContainerRef.current.getBoundingClientRect();
    const snapped = worldRef.current.screenToSnappedTileWorld(
      e.clientX - rect.left,
      e.clientY - rect.top
    );
    worldRef.current.stampPrefabInWorld(
      decodedActivePlacement.buffer,
      snapped.worldX,
      snapped.worldY,
      placementAnchorZ
    );
    recordPlacedWorldPrefab({
      prefabId: activePlacement.prefabId,
      name: activePlacement.name,
      worldX: snapped.worldX,
      worldY: snapped.worldY,
      anchorZ: placementAnchorZ,
      payloadBase64: activePlacement.payloadBase64,
    });
  };

  const handleCanvasContextMenu = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (!isEditorOpen && activePlacement) {
      e.preventDefault();
      cancelWorldPlacement();
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0f172a',
        fontFamily: TOKENS.fontSans,
      }}
    >
      {/* Pixi WebGL Canvas Mount */}
      <div
        ref={canvasContainerRef}
        onPointerMove={handleCanvasPointerMove}
        onPointerLeave={handleCanvasPointerLeave}
        onClick={handleCanvasClick}
        onContextMenu={handleCanvasContextMenu}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: !isEditorOpen && activePlacement ? 'crosshair' : 'default',
        }}
      />

      {initError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            padding: 24,
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              borderRadius: 8,
              padding: '14px 18px',
              color: '#fca5a5',
              fontSize: 13,
              maxWidth: 460,
            }}
          >
            Failed to initialize renderer: {initError}
          </div>
        </div>
      )}

      {/* Top Center Placement Mode Pill */}
      {!isEditorOpen && activePlacement && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(19, 23, 34, 0.94)',
            border: `1px solid ${TOKENS.accentHairline}`,
            borderRadius: 8,
            padding: '8px 12px',
            color: TOKENS.textPrimary,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            pointerEvents: 'auto',
            zIndex: 20,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TOKENS.accent }}>
            <PlaceIcon size={15} />
            <span style={{ fontWeight: 500, color: TOKENS.textPrimary }}>
              Placing: {activePlacement.name}
            </span>
          </span>
          <span
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: 12,
              color: TOKENS.textMuted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {activePlacement.width}×{activePlacement.height}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: TOKENS.fontMono,
              fontSize: 12,
              color: TOKENS.warning,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span>AnchorZ:</span>
            <button
              type="button"
              onClick={() => setActivePlacementAnchorZ(placementAnchorZ - 1)}
              aria-label="Decrease placement Anchor Z"
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgRaised,
                color: TOKENS.textPrimary,
                cursor: 'pointer',
                padding: 0,
                fontFamily: TOKENS.fontMono,
                fontSize: 12,
              }}
            >
              -
            </button>
            <span style={{ minWidth: 22, textAlign: 'center' }}>{placementAnchorZ}</span>
            <button
              type="button"
              onClick={() => setActivePlacementAnchorZ(placementAnchorZ + 1)}
              aria-label="Increase placement Anchor Z"
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgRaised,
                color: TOKENS.textPrimary,
                cursor: 'pointer',
                padding: 0,
                fontFamily: TOKENS.fontMono,
                fontSize: 12,
              }}
            >
              +
            </button>
          </span>
          <span style={{ fontSize: 12, color: TOKENS.textSecondary }}>
            <kbd style={kbdStyle}>[</kbd>/<kbd style={kbdStyle}>]</kbd> Z · Click to stamp · Right-click or <kbd style={kbdStyle}>Esc</kbd> to cancel
          </span>
          <button
            type="button"
            onClick={cancelWorldPlacement}
            aria-label="Cancel placement"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 4,
              border: `1px solid ${TOKENS.hairline}`,
              backgroundColor: TOKENS.bgRaised,
              color: TOKENS.textSecondary,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}

      {/* Top Left HUD: World Telemetry */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: '12px 16px',
          color: '#f8fafc',
          fontSize: 13,
          lineHeight: 1.5,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
          pointerEvents: 'auto',
          minWidth: 256,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: '#38bdf8' }}>
          Synapse Infinite World
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 12px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: '#94a3b8' }}>World Seed:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{worldSeed}</span>
            <button
              type="button"
              onClick={() => setWorldSeed(Math.floor(Math.random() * 900000) + 100000)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.1)',
                color: '#cbd5e1',
                border: 'none',
                borderRadius: 4,
                padding: '3px 6px',
                cursor: 'pointer',
              }}
              title="Generate new world seed"
            >
              <DiceIcon size={12} />
            </button>
          </span>

          <span style={{ color: '#94a3b8' }}>World Pos:</span>
          <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>
            ({playerCoords.x.toFixed(1)}, {playerCoords.y.toFixed(1)})
          </span>

          <span style={{ color: '#94a3b8' }}>Tile Pos:</span>
          <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>
            ({tileCoords.x}, {tileCoords.y})
          </span>

          <span style={{ color: '#94a3b8' }}>Chunk Pos:</span>
          <span style={{ fontFamily: 'monospace', color: '#34d399' }}>
            ({chunkCoords.x}, {chunkCoords.y})
          </span>
        </div>

        <div
          style={{
            margin: '8px 0',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        />

        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: '#e2e8f0' }}>
          Loose Culling & Pool Telemetry
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 12px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <span style={{ color: '#94a3b8' }}>Visible Tiles:</span>
          <span style={{ color: '#4ade80', fontWeight: 600 }}>
            {cullingTelemetry.visibleCount}
          </span>

          <span style={{ color: '#94a3b8' }}>Loaded (Active):</span>
          <span style={{ color: '#fbbf24', fontWeight: 600 }}>
            {cullingTelemetry.loadedCount}
          </span>

          <span style={{ color: '#94a3b8' }}>Pooled Sprites:</span>
          <span style={{ color: '#60a5fa', fontWeight: 600 }}>
            {cullingTelemetry.pooledCount}
          </span>

          <span style={{ color: '#94a3b8' }}>Buffer Margin:</span>
          <span>
            <button
              type="button"
              onClick={() => setBufferMargin(2)}
              style={{
                background: bufferMargin === 2 ? '#38bdf8' : 'rgba(255,255,255,0.1)',
                color: bufferMargin === 2 ? '#0f172a' : '#cbd5e1',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                marginRight: 4,
              }}
            >
              2 tiles
            </button>
            <button
              type="button"
              onClick={() => setBufferMargin(3)}
              style={{
                background: bufferMargin === 3 ? '#38bdf8' : 'rgba(255,255,255,0.1)',
                color: bufferMargin === 3 ? '#0f172a' : '#cbd5e1',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              3 tiles
            </button>
          </span>
        </div>

        <div
          style={{
            margin: '8px 0',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        />

        <div
          style={{
            margin: '8px 0',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        />

        {/* Noise Visualizer & Multi-Noise Channels Inspector */}
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Noise Engine Inspector</span>
          <button
            type="button"
            onClick={toggleNoiseVisualizer}
            style={{
              background: showNoiseVisualizer ? '#22c55e' : 'rgba(255,255,255,0.1)',
              color: showNoiseVisualizer ? '#0f172a' : '#cbd5e1',
              border: 'none',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showNoiseVisualizer ? 'Colors: ON [V]' : 'Tiles: ON [V]'}
          </button>
        </div>

        {activeTileNoise && (
          <div style={{ marginBottom: 8, background: 'rgba(0,0,0,0.25)', padding: '6px 8px', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  backgroundColor: activeTileNoise.hexColor,
                  border: '1px solid rgba(255,255,255,0.4)',
                }}
              />
              <span style={{ fontWeight: 600, fontSize: 12, color: '#f8fafc' }}>
                {activeTileNoise.label}
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '2px 8px',
                fontSize: 11,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span style={{ color: '#94a3b8' }}>Continental:</span>
              <span style={{ color: activeTileNoise.isWater ? '#38bdf8' : '#e2e8f0' }}>
                {activeTileNoise.continentalness.toFixed(3)} {activeTileNoise.isWater ? '(Water Basin)' : ''}
              </span>

              <span style={{ color: '#94a3b8' }}>Forest Ecology:</span>
              <span style={{ color: activeTileNoise.hasTree ? '#4ade80' : '#e2e8f0' }}>
                {activeTileNoise.forestDensity.toFixed(3)}
                {activeTileNoise.hasTree && (
                  <span style={{ color: '#86efac', fontWeight: 600, marginLeft: 4 }}>
                    🌲 Trunk [{activeTileNoise.treeMaturity?.toUpperCase() ?? 'TREE'}]
                  </span>
                )}
              </span>

              {activeTileNoise.forestZone && activeTileNoise.forestZone !== 'none' && (
                <>
                  <span style={{ color: '#94a3b8' }}>Forest Zone:</span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        activeTileNoise.forestZone === 'core'
                          ? '#4ade80'
                          : activeTileNoise.forestZone === 'clearing'
                            ? '#fef08a'
                            : activeTileNoise.forestZone === 'edge'
                              ? '#a3e635'
                              : '#86efac',
                    }}
                  >
                    {activeTileNoise.forestZone === 'core'
                      ? 'Core (Old-Growth)'
                      : activeTileNoise.forestZone === 'clearing'
                        ? 'Sunlit Glade (Clearing)'
                        : activeTileNoise.forestZone === 'edge'
                          ? 'Edge (Ecotone)'
                          : 'Interior Woods'}
                  </span>

                  <span style={{ color: '#94a3b8' }}>Canopy Cover:</span>
                  <span style={{ color: activeTileNoise.isCanopy ? '#86efac' : '#cbd5e1' }}>
                    {activeTileNoise.isCanopy ? '🌿 Shaded Canopy' : '☀️ Open Sky'}
                  </span>
                </>
              )}

              <span style={{ color: '#94a3b8' }}>Temp / Humidity:</span>
              <span style={{ color: '#fbbf24' }}>
                {activeTileNoise.temperature.toFixed(2)} / {activeTileNoise.humidity.toFixed(2)}
              </span>

              <span style={{ color: '#94a3b8' }}>Erosion Relief:</span>
              <span style={{ color: '#cbd5e1' }}>
                {activeTileNoise.erosion.toFixed(3)}
              </span>

              {activeTileNoise.isVillage && (
                <>
                  <span style={{ color: '#94a3b8' }}>Community:</span>
                  <span style={{ color: activeTileNoise.isPlaza ? '#f43f5e' : '#c084fc', fontWeight: 600 }}>
                    {activeTileNoise.isPlaza ? 'Plaza Center' : 'Village District'}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
          <span style={{ color: '#94a3b8' }}>Zoom Level [Z]:</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1.0, 0.5, 0.25].map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoomLevel(z)}
                style={{
                  background: zoomLevel === z ? '#38bdf8' : 'rgba(255,255,255,0.1)',
                  color: zoomLevel === z ? '#0f172a' : '#cbd5e1',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            onClick={toggleDebugOverlay}
            style={{
              flex: 1,
              background: showDebugOverlay ? '#22c55e' : 'rgba(255,255,255,0.1)',
              color: showDebugOverlay ? '#0f172a' : '#cbd5e1',
              border: 'none',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showDebugOverlay ? 'Hide Debug [C]' : 'Debug Culling [C]'}
          </button>
          <button
            type="button"
            onClick={toggleInspectInsetCulling}
            title="Shrinks culling window inside viewport so preloaded margin & unloaded tiles are visible"
            style={{
              background: inspectInsetCulling ? '#f59e0b' : 'rgba(255,255,255,0.1)',
              color: inspectInsetCulling ? '#0f172a' : '#cbd5e1',
              border: 'none',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {inspectInsetCulling ? 'Inset On [I]' : 'Inset [I]'}
          </button>
        </div>

        <button
          type="button"
          onClick={openEditor}
          style={{
            marginTop: 6,
            width: '100%',
            background: '#38bdf8',
            color: '#09111b',
            border: 'none',
            borderRadius: 6,
            padding: '7px 10px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Building Editor [B]
        </button>
      </div>

      {/* Bottom Right Controls Guide */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: '10px 14px',
          color: '#94a3b8',
          fontSize: 12,
          lineHeight: 1.6,
          pointerEvents: 'none',
        }}
      >
        <div>
          <kbd style={kbdStyle}>W A S D</kbd> / <kbd style={kbdStyle}>Arrows</kbd> Move
        </div>
        <div>
          <kbd style={kbdStyle}>Shift</kbd> Sprint (480 px/s)
        </div>
        <div>
          <kbd style={kbdStyle}>V</kbd> Noise Colors · <kbd style={kbdStyle}>Z</kbd> Zoom ·{' '}
          <kbd style={kbdStyle}>C</kbd> Debug Overlay · <kbd style={kbdStyle}>B</kbd> Building Editor
        </div>
      </div>

      {/* Top Right HUD: Noise Visual Palette Legend */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          backgroundColor: 'rgba(15, 23, 42, 0.90)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 8,
          padding: showLegend ? '12px 14px' : '8px 12px',
          color: '#f8fafc',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
          pointerEvents: 'auto',
          maxWidth: 300,
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: showLegend ? 10 : 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13, color: '#38bdf8' }}>
            Noise World Palette
          </span>
          <button
            type="button"
            onClick={() => setShowLegend((prev) => !prev)}
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: '#94a3b8',
              border: 'none',
              borderRadius: 4,
              padding: '2px 6px',
              fontSize: 10,
              cursor: 'pointer',
            }}
          >
            {showLegend ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {showLegend && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {NOISE_PALETTE.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    minWidth: 14,
                    borderRadius: 3,
                    backgroundColor: entry.hexColor,
                    marginTop: 2,
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, color: '#f1f5f9', lineHeight: 1.2 }}>
                    {entry.label}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.2 }}>
                    {entry.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isEditorOpen && (
        <BuildingEditorModal
          assetLibrary={assetLibrary}
          onClose={closeEditor}
        />
      )}
    </div>
  );
}
