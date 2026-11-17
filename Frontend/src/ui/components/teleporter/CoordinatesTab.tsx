import React, { useMemo, useState } from 'react';
import { RENDER_TILE_SIZE, tileToWorld } from '../../../engine/procedural/landmarkFinder.ts';
import { getNoiseVisualTile, WorldNoise } from '../../../engine/procedural/worldNoise.ts';
import { CollisionEngine } from '../../../engine/collision/collision.ts';
import { useGameStore } from '../../../store/gameStore.ts';
import { TOKENS } from '../building-editor/theme.ts';
import { CompassIcon, TeleportIcon } from './icons.tsx';

export interface CoordinatesTabProps {
  worldNoise: WorldNoise;
  onTeleport: (worldX: number, worldY: number, label?: string) => void;
}

export const CoordinatesTab: React.FC<CoordinatesTabProps> = ({ worldNoise, onTeleport }) => {
  const currentTileCoords = useGameStore((state) => state.tileCoords);

  const [inputTx, setInputTx] = useState<string>(String(currentTileCoords.x));
  const [inputTy, setInputTy] = useState<string>(String(currentTileCoords.y));

  const parsedTx = Number.parseInt(inputTx, 10);
  const parsedTy = Number.parseInt(inputTy, 10);
  const isValidCoord = !Number.isNaN(parsedTx) && !Number.isNaN(parsedTy);

  const tx = isValidCoord ? parsedTx : 0;
  const ty = isValidCoord ? parsedTy : 0;

  // Live conversion math
  const originWorld = tileToWorld(tx, ty, RENDER_TILE_SIZE, false);
  const centerWorld = tileToWorld(tx, ty, RENDER_TILE_SIZE, true);

  // Live Biome / Terrain / Collision inspection via WorldNoise & CollisionEngine
  const terrainPreview = useMemo(() => {
    if (!isValidCoord) return null;

    const visual = getNoiseVisualTile(worldNoise, tx, ty);
    const biome = worldNoise.getBiomeAt(tx, ty);
    const isWater = worldNoise.isWaterAt(tx, ty);
    const tree = worldNoise.getTreeAt(tx, ty);
    const village = worldNoise.getVillageAt(tx, ty);
    const forest = worldNoise.getForestAt(tx, ty);

    // Collision check using collision engine
    const collisionEngine = new CollisionEngine(worldNoise, RENDER_TILE_SIZE);
    const playerHalfSize = 14;
    const hit = collisionEngine.checkCollision({
      minX: centerWorld.worldX - playerHalfSize,
      minY: centerWorld.worldY - playerHalfSize,
      maxX: centerWorld.worldX + playerHalfSize,
      maxY: centerWorld.worldY + playerHalfSize,
    });

    let statusType: 'walkable' | 'water' | 'obstacle' = 'walkable';
    let statusLabel = 'Walkable Terrain';
    let statusColor: string = TOKENS.positive;
    let statusBg: string = TOKENS.positiveSurface;

    if (hit) {
      if (hit.type === 'water' || isWater) {
        statusType = 'water';
        statusLabel = 'Water Basin';
        statusColor = TOKENS.accent;
        statusBg = TOKENS.accentSurface;
      } else {
        statusType = 'obstacle';
        statusLabel = hit.label ? `Obstacle (${hit.label})` : 'Solid Obstacle';
        statusColor = TOKENS.negative;
        statusBg = TOKENS.negativeSurface;
      }
    }

    return {
      visual,
      biome,
      isWater,
      tree,
      village,
      forest,
      hit,
      statusType,
      statusLabel,
      statusColor,
      statusBg,
    };
  }, [worldNoise, tx, ty, isValidCoord, centerWorld.worldX, centerWorld.worldY]);

  const handleFillOrigin = (): void => {
    setInputTx('0');
    setInputTy('0');
  };

  const handleFillCurrent = (): void => {
    setInputTx(String(currentTileCoords.x));
    setInputTy(String(currentTileCoords.y));
  };

  const handleExecuteTeleport = (): void => {
    if (!isValidCoord) return;
    onTeleport(centerWorld.worldX, centerWorld.worldY, `Tile (${tx}, ${ty})`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Coordinate Input Controls */}
      <div
        style={{
          backgroundColor: TOKENS.bgRaised,
          border: `1px solid ${TOKENS.hairline}`,
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: TOKENS.textSecondary,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <CompassIcon size={14} />
            Target Coordinates
          </span>

          {/* Quick-Fill Action Buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handleFillOrigin}
              title="Set coordinates to world center (0, 0)"
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                backgroundColor: TOKENS.bgHover,
                color: TOKENS.textSecondary,
                cursor: 'pointer',
              }}
            >
              Origin (0, 0)
            </button>
            <button
              type="button"
              onClick={handleFillCurrent}
              title={`Fill current player tile (${currentTileCoords.x}, ${currentTileCoords.y})`}
              style={{
                fontSize: 11,
                padding: '3px 8px',
                borderRadius: 4,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                backgroundColor: TOKENS.bgHover,
                color: TOKENS.accent,
                cursor: 'pointer',
              }}
            >
              Current Tile
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label
              htmlFor="teleport-input-tile-x"
              style={{
                display: 'block',
                fontSize: 12,
                color: TOKENS.textSecondary,
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Tile X Coordinate
            </label>
            <input
              id="teleport-input-tile-x"
              type="number"
              value={inputTx}
              onChange={(e) => setInputTx(e.target.value)}
              placeholder="0"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 36,
                padding: '0 10px',
                backgroundColor: TOKENS.bgDeepest,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                borderRadius: 6,
                color: TOKENS.textPrimary,
                fontFamily: TOKENS.fontMono,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="teleport-input-tile-y"
              style={{
                display: 'block',
                fontSize: 12,
                color: TOKENS.textSecondary,
                marginBottom: 6,
                fontWeight: 500,
              }}
            >
              Tile Y Coordinate
            </label>
            <input
              id="teleport-input-tile-y"
              type="number"
              value={inputTy}
              onChange={(e) => setInputTy(e.target.value)}
              placeholder="0"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                height: 36,
                padding: '0 10px',
                backgroundColor: TOKENS.bgDeepest,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                borderRadius: 6,
                color: TOKENS.textPrimary,
                fontFamily: TOKENS.fontMono,
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>

      {/* Live Conversion Display to World Pixels */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <div
          style={{
            backgroundColor: TOKENS.bgRaised,
            border: `1px solid ${TOKENS.hairline}`,
            borderRadius: 8,
            padding: '10px 14px',
          }}
        >
          <div style={{ fontSize: 11, color: TOKENS.textMuted, marginBottom: 4 }}>
            Tile Coordinates
          </div>
          <div
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: 14,
              color: '#a78bfa',
              fontWeight: 600,
            }}
          >
            ({tx}, {ty})
          </div>
        </div>

        <div
          style={{
            backgroundColor: TOKENS.bgRaised,
            border: `1px solid ${TOKENS.hairline}`,
            borderRadius: 8,
            padding: '10px 14px',
          }}
        >
          <div style={{ fontSize: 11, color: TOKENS.textMuted, marginBottom: 4 }}>
            World Pixels (Tile × 64)
          </div>
          <div
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: 14,
              color: TOKENS.accent,
              fontWeight: 600,
            }}
          >
            ({originWorld.worldX}, {originWorld.worldY}) px
          </div>
        </div>
      </div>

      {/* Live Biome & Terrain Preview */}
      {terrainPreview && (
        <div
          style={{
            backgroundColor: TOKENS.bgRaised,
            border: `1px solid ${TOKENS.hairline}`,
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: TOKENS.textSecondary,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              Terrain & Biome Inspection
            </span>

            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 4,
                backgroundColor: terrainPreview.statusBg,
                color: terrainPreview.statusColor,
                border: `1px solid ${terrainPreview.statusColor}40`,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: terrainPreview.statusColor,
                }}
              />
              {terrainPreview.statusLabel}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '6px 16px',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <span style={{ color: TOKENS.textMuted }}>Biome Class:</span>
            <span style={{ color: TOKENS.textPrimary, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: terrainPreview.visual.hexColor,
                }}
              />
              {terrainPreview.visual.label} ({terrainPreview.biome.replace('_', ' ')})
            </span>

            {terrainPreview.village && terrainPreview.village.isInside && (
              <>
                <span style={{ color: TOKENS.textMuted }}>Village:</span>
                <span style={{ color: '#c084fc', fontWeight: 600 }}>
                  {terrainPreview.village.villageName ?? 'Settlement'}{' '}
                  {terrainPreview.village.isPlaza ? '· Plaza Center' : ''}
                </span>
              </>
            )}

            {terrainPreview.tree && (
              <>
                <span style={{ color: TOKENS.textMuted }}>Tree Growth:</span>
                <span style={{ color: '#86efac' }}>
                  Variant {terrainPreview.tree.variant} · {(terrainPreview.tree.maturity ?? 'mature').toUpperCase()}
                </span>
              </>
            )}

            {terrainPreview.forest.zone !== 'none' && (
              <>
                <span style={{ color: TOKENS.textMuted }}>Forest Zone:</span>
                <span style={{ color: '#4ade80' }}>
                  {terrainPreview.forest.zone.toUpperCase()} (Density: {(terrainPreview.forest.density * 100).toFixed(0)}%)
                </span>
              </>
            )}
          </div>

          {terrainPreview.statusType !== 'walkable' && (
            <div
              style={{
                marginTop: 10,
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                fontSize: 11,
                color: TOKENS.accent,
                lineHeight: 1.4,
              }}
            >
              Safe-landing protection enabled: Teleportation will automatically relocate landing to the nearest clear walkable ground.
            </div>
          )}
        </div>
      )}

      {/* Action Button */}
      <button
        type="button"
        disabled={!isValidCoord}
        onClick={handleExecuteTeleport}
        style={{
          height: 40,
          backgroundColor: isValidCoord ? TOKENS.accent : TOKENS.bgRaised,
          color: isValidCoord ? TOKENS.accentText : TOKENS.textMuted,
          border: `1px solid ${isValidCoord ? TOKENS.accent : TOKENS.hairline}`,
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
          cursor: isValidCoord ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          transition: `all 140ms ${TOKENS.ease}`,
        }}
      >
        <TeleportIcon size={16} />
        Teleport to Coordinates ({tx}, {ty})
      </button>
    </div>
  );
};
