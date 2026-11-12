import { type DragEvent, type JSX } from 'react';
import {
  ASSET_SETS,
  type AssetSetDefinition,
  type LoadedAssetTile,
} from '../../../engine/prefab/assetRegistry.ts';
import { TOKENS } from './theme.ts';

export type DragPayload =
  | { kind: 'tile'; assetId: number }
  | { kind: 'prefab'; id: string };

interface AssetPaletteSidebarProps {
  activeSheetId: number;
  onSelectSheet: (sheetId: number) => void;
  tiles: readonly LoadedAssetTile[];
  selectedAssetId: number;
  isLoading: boolean;
  loadError: string | null;
  onSelectTile: (assetId: number) => void;
  onDragStartPayload: (payload: DragPayload) => void;
  onDragEndPayload: () => void;
}

export function AssetPaletteSidebar({
  activeSheetId,
  onSelectSheet,
  tiles,
  selectedAssetId,
  isLoading,
  loadError,
  onSelectTile,
  onDragStartPayload,
  onDragEndPayload,
}: AssetPaletteSidebarProps): JSX.Element {
  const activeSet: AssetSetDefinition | undefined = ASSET_SETS.find(
    (s) => s.sheetId === activeSheetId
  );

  const handleTileDragStart = (e: DragEvent<HTMLButtonElement>, assetId: number): void => {
    const payload: DragPayload = { kind: 'tile', assetId };
    const serialized = JSON.stringify(payload);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', serialized);
    e.dataTransfer.setData('text/plain', serialized);
    onDragStartPayload(payload);
  };

  return (
    <aside
      style={{
        width: 268,
        flexShrink: 0,
        backgroundColor: TOKENS.bgPanel,
        borderRight: `1px solid ${TOKENS.hairline}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '12px 16px 8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: TOKENS.textPrimary }}>
          Asset Library
        </span>
        <span
          style={{
            fontFamily: TOKENS.fontMono,
            fontSize: 12,
            color: TOKENS.textMuted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {tiles.length} tiles
        </span>
      </div>

      {/* 6 ASSET_SETS Tabs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 4,
          padding: '0 12px 12px',
          borderBottom: `1px solid ${TOKENS.hairline}`,
        }}
      >
        {ASSET_SETS.map((set) => {
          const isActive = set.sheetId === activeSheetId;
          return (
            <button
              key={set.id}
              type="button"
              onClick={() => onSelectSheet(set.sheetId)}
              style={{
                height: 32,
                padding: '0 8px',
                borderRadius: 6,
                border: `1px solid ${isActive ? TOKENS.accentHairline : TOKENS.hairline}`,
                backgroundColor: isActive ? TOKENS.accentSurface : TOKENS.bgRaised,
                color: isActive ? TOKENS.textPrimary : TOKENS.textSecondary,
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                textAlign: 'left',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                transition: `background-color 140ms ${TOKENS.ease}, border-color 140ms ${TOKENS.ease}`,
              }}
            >
              {set.label}
            </button>
          );
        })}
      </div>

      {/* Tile Grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 12,
        }}
      >
        {isLoading ? (
          <div style={{ fontSize: 12, color: TOKENS.textMuted, padding: 8 }}>
            Loading sprite sheets...
          </div>
        ) : loadError ? (
          <div
            style={{
              fontSize: 12,
              color: TOKENS.negative,
              backgroundColor: TOKENS.negativeSurface,
              border: `1px solid ${TOKENS.hairline}`,
              borderRadius: 6,
              padding: 8,
            }}
          >
            {loadError}
          </div>
        ) : tiles.length === 0 ? (
          <div style={{ fontSize: 12, color: TOKENS.textMuted, padding: 8 }}>
            No non-empty tiles found in {activeSet?.label ?? 'sheet'}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 6,
            }}
          >
            {tiles.map((tile) => {
              const isSelected = tile.assetId === selectedAssetId;
              return (
                <button
                  key={tile.assetId}
                  type="button"
                  draggable
                  onClick={() => onSelectTile(tile.assetId)}
                  onDragStart={(e) => handleTileDragStart(e, tile.assetId)}
                  onDragEnd={onDragEndPayload}
                  title={`${activeSet?.label ?? 'Sheet'} #${tile.tileIndex} (${tile.col}, ${tile.row})`}
                  style={{
                    width: 44,
                    height: 44,
                    padding: 4,
                    borderRadius: 6,
                    border: `1px solid ${isSelected ? TOKENS.accent : TOKENS.hairline}`,
                    backgroundColor: isSelected ? TOKENS.accentSurface : TOKENS.bgDeepest,
                    boxShadow: isSelected
                      ? `inset 0 0 0 1px ${TOKENS.accent}`
                      : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'grab',
                    transition: `border-color 120ms ${TOKENS.ease}, background-color 120ms ${TOKENS.ease}`,
                  }}
                >
                  {tile.previewDataUrl ? (
                    <img
                      src={tile.previewDataUrl}
                      alt={`Tile ${tile.tileIndex}`}
                      width={32}
                      height={32}
                      draggable={false}
                      style={{
                        width: 32,
                        height: 32,
                        display: 'block',
                        imageRendering: 'pixelated',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderTop: `1px solid ${TOKENS.hairline}`,
          fontSize: 12,
          color: TOKENS.textMuted,
        }}
      >
        Click to paint or drag onto grid
      </div>
    </aside>
  );
}
