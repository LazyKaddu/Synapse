import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react';
import { GameLoop } from '../../engine/index.ts';
import { useGameStore } from '../../store/gameStore.ts';

const kbdStyle: CSSProperties = {
  color: '#f1f5f9',
  background: 'rgba(255,255,255,0.1)',
  padding: '2px 6px',
  borderRadius: 4,
};

export default function Game(): JSX.Element {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // Zustand state subscriptions
  const worldSeed = useGameStore((state) => state.worldSeed);
  const bufferMargin = useGameStore((state) => state.bufferMargin);
  const playerCoords = useGameStore((state) => state.playerCoords);
  const tileCoords = useGameStore((state) => state.tileCoords);
  const chunkCoords = useGameStore((state) => state.chunkCoords);
  const cullingTelemetry = useGameStore((state) => state.cullingTelemetry);
  const showDebugOverlay = useGameStore((state) => state.showDebugOverlay);
  const inspectInsetCulling = useGameStore((state) => state.inspectInsetCulling);

  const toggleDebugOverlay = useGameStore((state) => state.toggleDebugOverlay);
  const toggleInspectInsetCulling = useGameStore((state) => state.toggleInspectInsetCulling);
  const setBufferMargin = useGameStore((state) => state.setBufferMargin);
  const setWorldSeed = useGameStore((state) => state.setWorldSeed);

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

    gameLoop.start().catch((err: unknown) => {
      if (disposed) return;
      console.error('Failed to initialize Pixi game engine:', err);
      setInitError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      disposed = true;
      gameLoop.destroy();
      canvas.remove();
    };
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#0f172a',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Pixi WebGL Canvas Mount */}
      <div
        ref={canvasContainerRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
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

      {/* Top Left HUD: World Telemetry */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 8,
          padding: '12px 16px',
          color: '#f8fafc',
          fontSize: 13,
          lineHeight: 1.5,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
          pointerEvents: 'auto',
          minWidth: 240,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#38bdf8' }}>
          Synapse Infinite World
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
          <span style={{ color: '#94a3b8' }}>World Seed:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{worldSeed}</span>
            <button
              type="button"
              onClick={() => setWorldSeed(Math.floor(Math.random() * 900000) + 100000)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                color: '#94a3b8',
                border: 'none',
                borderRadius: 4,
                padding: '1px 6px',
                fontSize: 10,
                cursor: 'pointer',
              }}
              title="Generate new world seed"
            >
              🎲
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

        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
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
          <kbd style={kbdStyle}>C</kbd> Debug Overlay · <kbd style={kbdStyle}>I</kbd> Inset Culling
        </div>
      </div>
    </div>
  );
}
