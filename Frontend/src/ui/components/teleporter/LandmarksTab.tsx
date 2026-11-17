import React, { useMemo } from 'react';
import {
  findNearestForest,
  findNearestVillage,
  findNearestWater,
  type LandmarkResult,
} from '../../../engine/procedural/landmarkFinder.ts';
import { WorldNoise } from '../../../engine/procedural/worldNoise.ts';
import { useGameStore } from '../../../store/gameStore.ts';
import { TOKENS } from '../building-editor/theme.ts';
import { ForestIcon, LandmarkIcon, TeleportIcon, WaterIcon } from './icons.tsx';

export interface LandmarksTabProps {
  worldNoise: WorldNoise;
  onTeleport: (worldX: number, worldY: number, label?: string) => void;
}

export const LandmarksTab: React.FC<LandmarksTabProps> = ({ worldNoise, onTeleport }) => {
  const currentTileCoords = useGameStore((state) => state.tileCoords);

  // Compute nearest landmarks relative to player's current tile position
  const landmarks = useMemo(() => {
    const originX = currentTileCoords.x;
    const originY = currentTileCoords.y;

    const village = findNearestVillage(worldNoise, originX, originY);
    const forest = findNearestForest(worldNoise, originX, originY);
    const water = findNearestWater(worldNoise, originX, originY);

    let forestZoneLabel = 'Woods';
    let forestCanopyLabel = 'Canopy Cover';
    if (forest) {
      const fInfo = worldNoise.getForestAt(forest.tileX, forest.tileY);
      forestZoneLabel =
        fInfo.zone === 'core'
          ? 'Core Old-Growth'
          : fInfo.zone === 'clearing'
            ? 'Sunlit Clearing'
            : fInfo.zone === 'edge'
              ? 'Forest Fringe'
              : 'Interior Woods';
      forestCanopyLabel = fInfo.isCanopy ? 'Dense Canopy' : 'Open Glade';
    }

    return {
      village,
      forest,
      water,
      forestZoneLabel,
      forestCanopyLabel,
    };
  }, [worldNoise, currentTileCoords.x, currentTileCoords.y]);

  const renderCard = (
    title: string,
    subtitle: string,
    categoryBadge: string,
    icon: React.ReactNode,
    landmark: LandmarkResult | null,
    extraInfo?: string,
    accentColor: string = TOKENS.accent,
    accentSurface: string = TOKENS.accentSurface
  ) => {
    if (!landmark) {
      return (
        <div
          style={{
            backgroundColor: TOKENS.bgRaised,
            border: `1px solid ${TOKENS.hairline}`,
            borderRadius: 8,
            padding: 16,
            color: TOKENS.textMuted,
            fontSize: 12,
          }}
        >
          No {title.toLowerCase()} found within search radius.
        </div>
      );
    }

    const distTiles = Math.round(landmark.distance);
    const distanceString =
      distTiles === 0 ? 'Current Location' : `${distTiles} tiles away`;

    return (
      <div
        style={{
          backgroundColor: TOKENS.bgRaised,
          border: `1px solid ${TOKENS.hairlineStrong}`,
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          transition: `transform 140ms ${TOKENS.ease}, border-color 140ms ${TOKENS.ease}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: accentSurface,
                color: accentColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {icon}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: TOKENS.textPrimary }}>
                {title}
              </div>
              <div style={{ fontSize: 11, color: TOKENS.textSecondary, marginTop: 2 }}>
                {subtitle}
              </div>
            </div>
          </div>

          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 4,
              fontWeight: 600,
              backgroundColor: accentSurface,
              color: accentColor,
              border: `1px solid ${accentColor}40`,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              whiteSpace: 'nowrap',
            }}
          >
            {categoryBadge}
          </span>
        </div>

        {/* Distance & Coordinates Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            backgroundColor: TOKENS.bgDeepest,
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: TOKENS.textMuted }}>Coords:</span>
            <span
              style={{
                fontFamily: TOKENS.fontMono,
                color: TOKENS.textPrimary,
                fontWeight: 600,
              }}
            >
              ({landmark.tileX}, {landmark.tileY})
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: TOKENS.textMuted }}>Distance:</span>
            <span
              style={{
                fontFamily: TOKENS.fontMono,
                color: distTiles === 0 ? TOKENS.positive : TOKENS.accent,
                fontWeight: 600,
              }}
            >
              {distanceString}
            </span>
          </div>
        </div>

        {extraInfo && (
          <div style={{ fontSize: 11, color: TOKENS.textMuted, fontStyle: 'italic' }}>
            {extraInfo}
          </div>
        )}

        {/* 1-Click Teleport Action Button */}
        <button
          type="button"
          onClick={() => onTeleport(landmark.worldX, landmark.worldY, landmark.name)}
          style={{
            height: 34,
            backgroundColor: accentColor,
            color: TOKENS.accentText,
            border: `1px solid ${accentColor}`,
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: `opacity 140ms ${TOKENS.ease}`,
          }}
        >
          <TeleportIcon size={14} />
          Teleport to {title}
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. Nearest Village Plaza */}
      {renderCard(
        landmarks.village?.name ?? 'Nearest Village Plaza',
        landmarks.village ? `Procedural Settlement: ${landmarks.village.villageName}` : 'Civilian Town Center',
        'Town Plaza',
        <LandmarkIcon size={20} />,
        landmarks.village,
        'Town plaza features cobblestone square, town well, street grid, and surrounding merchant cottages.',
        '#f59e0b',
        'rgba(245, 158, 11, 0.15)'
      )}

      {/* 2. Nearest Forest Grove */}
      {renderCard(
        'Nearest Forest Grove',
        `${landmarks.forestZoneLabel} · ${landmarks.forestCanopyLabel}`,
        'Forestry',
        <ForestIcon size={20} />,
        landmarks.forest,
        'Old-growth timber canopy, sunlit clearings, and ecological tree clusters with natural clearance.',
        '#22c55e',
        'rgba(34, 197, 94, 0.15)'
      )}

      {/* 3. Nearest Water / Shoreline */}
      {renderCard(
        'Nearest Water & Shoreline',
        'Natural Basin & Lake Shore',
        'Aquatic',
        <WaterIcon size={20} />,
        landmarks.water,
        'Submerged freshwater basin. Safe landing system auto-relocates arrival to adjacent walkable beach/shore.',
        '#06b6d4',
        'rgba(6, 182, 212, 0.15)'
      )}
    </div>
  );
};
