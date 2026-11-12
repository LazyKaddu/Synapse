import { type DragEvent, type JSX, useMemo } from 'react';
import {
  decodeAssetId,
  getAssetSetBySheetId,
} from '../../../engine/prefab/assetRegistry.ts';
import {
  StackedPrefabCodec,
  type StackedPrefabData,
} from '../../../engine/prefab/PrefabCodec.ts';
import {
  base64ToArrayBuffer,
  type CellStackEntry,
} from '../../../engine/prefab/builderGrid.ts';
import type {
  BackendPrefabSummary,
  SavedPrefabEntry,
} from '../../../store/prefabStore.ts';
import type { DragPayload } from './AssetPaletteSidebar.tsx';
import { PrefabThumbnailCanvas } from './PrefabThumbnailCanvas.tsx';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClearIcon,
  LoadIcon,
  PlaceIcon,
  RefreshIcon,
} from './icons.tsx';
import { compactIconButtonStyle, TOKENS } from './theme.ts';

interface SavedBuildingsSidebarProps {
  inspectedCell: { col: number; row: number } | null;
  inspectedCellStack: readonly CellStackEntry[];
  anchorZ: number;
  activeZIndex: number;
  onSelectActiveZIndex: (zIndex: number) => void;
  onChangeCellTileZIndex: (col: number, row: number, fromZ: number, toZ: number) => void;
  onRemoveCellTile: (col: number, row: number, zIndex: number) => void;
  intermediatePrefabs: readonly SavedPrefabEntry[];
  backendPrefabs: readonly BackendPrefabSummary[];
  backendStatus: { tone: 'neutral' | 'positive' | 'negative'; text: string } | null;
  isSyncingBackend: boolean;
  busyBackendId: number | null;
  getPreviewUrl: (assetId: number) => string | undefined;
  onDragStartPayload: (payload: DragPayload) => void;
  onDragEndPayload: () => void;
  onLoadIntermediate: (entry: SavedPrefabEntry) => void;
  onPlaceIntermediate: (entry: SavedPrefabEntry) => void;
  onDeleteIntermediate: (id: string) => void;
  onRefreshBackend: () => void;
  onLoadBackend: (summary: BackendPrefabSummary) => void;
  onPlaceBackend: (summary: BackendPrefabSummary) => void;
  onDeleteBackend: (id: number) => void;
}

interface DecodedIntermediateCardData {
  entry: SavedPrefabEntry;
  stacked: StackedPrefabData | null;
  layerCount: number;
  byteLength: number;
}

function formatAssetLabel(assetId: number): string {
  const decoded = decodeAssetId(assetId);
  if (!decoded) return `#${assetId}`;
  const set = getAssetSetBySheetId(decoded.sheetId);
  return set ? `${set.label} #${decoded.tileIndex}` : `Tile #${decoded.tileIndex}`;
}

export function SavedBuildingsSidebar({
  inspectedCell,
  inspectedCellStack,
  anchorZ,
  activeZIndex,
  onSelectActiveZIndex,
  onChangeCellTileZIndex,
  onRemoveCellTile,
  intermediatePrefabs,
  backendPrefabs,
  backendStatus,
  isSyncingBackend,
  busyBackendId,
  getPreviewUrl,
  onDragStartPayload,
  onDragEndPayload,
  onLoadIntermediate,
  onPlaceIntermediate,
  onDeleteIntermediate,
  onRefreshBackend,
  onLoadBackend,
  onPlaceBackend,
  onDeleteBackend,
}: SavedBuildingsSidebarProps): JSX.Element {
  const decodedIntermediates = useMemo<DecodedIntermediateCardData[]>(() => {
    return intermediatePrefabs.map((entry) => {
      try {
        const buffer = base64ToArrayBuffer(entry.payloadBase64);
        const stacked = StackedPrefabCodec.decodeAny(buffer);
        return {
          entry,
          stacked,
          layerCount: stacked.layers.length,
          byteLength: entry.byteLength ?? buffer.byteLength,
        };
      } catch {
        return {
          entry,
          stacked: null,
          layerCount: 0,
          byteLength: entry.byteLength ?? 0,
        };
      }
    });
  }, [intermediatePrefabs]);

  const topToBottomCellStack = useMemo(
    () => [...inspectedCellStack].sort((a, b) => b.zIndex - a.zIndex),
    [inspectedCellStack]
  );

  const handlePrefabDragStart = (e: DragEvent<HTMLDivElement>, id: string): void => {
    const payload: DragPayload = { kind: 'prefab', id };
    const serialized = JSON.stringify(payload);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/json', serialized);
    e.dataTransfer.setData('text/plain', serialized);
    onDragStartPayload(payload);
  };

  return (
    <aside
      style={{
        width: 312,
        flexShrink: 0,
        backgroundColor: TOKENS.bgPanel,
        borderLeft: `1px solid ${TOKENS.hairline}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Cell Stack / Z-Index Inspector */}
      <div
        style={{
          flexShrink: 0,
          maxHeight: 210,
          display: 'flex',
          flexDirection: 'column',
          borderBottom: `1px solid ${TOKENS.hairline}`,
        }}
      >
        <div
          style={{
            padding: '10px 16px 6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: TOKENS.textPrimary }}>
            Cell Stack {inspectedCell ? `(${inspectedCell.col}, ${inspectedCell.row})` : ''}
          </span>
          <span
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: 12,
              color: TOKENS.textMuted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {topToBottomCellStack.length} {topToBottomCellStack.length === 1 ? 'layer' : 'layers'}
          </span>
        </div>

        <div
          style={{
            overflowY: 'auto',
            padding: '0 12px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {!inspectedCell ? (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgCanvas,
                fontSize: 12,
                color: TOKENS.textMuted,
              }}
            >
              Click any grid cell to inspect or reorder its stacked Z-index layers.
            </div>
          ) : topToBottomCellStack.length === 0 ? (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgCanvas,
                fontSize: 12,
                color: TOKENS.textMuted,
              }}
            >
              Cell ({inspectedCell.col}, {inspectedCell.row}) is empty.
            </div>
          ) : (
            topToBottomCellStack.map((entry) => {
              const url = getPreviewUrl(entry.assetId);
              const isActiveZ = entry.zIndex === activeZIndex;
              return (
                <div
                  key={`${entry.zIndex}-${entry.assetId}`}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 6,
                    border: `1px solid ${isActiveZ ? TOKENS.accentHairline : TOKENS.hairline}`,
                    backgroundColor: isActiveZ ? TOKENS.accentSurface : TOKENS.bgCanvas,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {url ? (
                    <img
                      src={url}
                      alt=""
                      style={{
                        width: 24,
                        height: 24,
                        imageRendering: 'pixelated',
                        borderRadius: 4,
                        border: `1px solid ${TOKENS.hairline}`,
                        backgroundColor: TOKENS.bgDeepest,
                        flexShrink: 0,
                      }}
                    />
                  ) : null}

                  <button
                    type="button"
                    onClick={() => onSelectActiveZIndex(entry.zIndex)}
                    title="Click to set active Z-index to this layer"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      textAlign: 'left',
                      color: TOKENS.textPrimary,
                      fontSize: 12,
                      fontFamily: TOKENS.fontSans,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatAssetLabel(entry.assetId)}
                  </button>

                  <label
                    title={`Relative Z = ${entry.zIndex} · World Z = ${anchorZ + entry.zIndex} (${anchorZ + entry.zIndex > 0 ? 'Over Player' : 'Under Player'})`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontFamily: TOKENS.fontMono,
                      fontSize: 11,
                      color: TOKENS.textSecondary,
                    }}
                  >
                    <span>Z</span>
                    <input
                      type="number"
                      min={-32768}
                      max={32767}
                      value={entry.zIndex}
                      aria-label={`Z-index for ${formatAssetLabel(entry.assetId)}`}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10);
                        if (!Number.isNaN(parsed)) {
                          onChangeCellTileZIndex(
                            inspectedCell.col,
                            inspectedCell.row,
                            entry.zIndex,
                            parsed
                          );
                        }
                      }}
                      style={{
                        width: 40,
                        height: 22,
                        padding: '0 4px',
                        borderRadius: 4,
                        border: `1px solid ${TOKENS.hairlineStrong}`,
                        backgroundColor: TOKENS.bgDeepest,
                        color: TOKENS.textPrimary,
                        fontFamily: TOKENS.fontMono,
                        fontSize: 11,
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'center',
                      }}
                    />
                    <span
                      style={{
                        fontSize: 10,
                        color: anchorZ + entry.zIndex > 0 ? TOKENS.accent : TOKENS.positive,
                        minWidth: 22,
                        textAlign: 'right',
                      }}
                    >
                      {anchorZ + entry.zIndex > 0 ? `+${anchorZ + entry.zIndex}` : anchorZ + entry.zIndex}
                    </span>
                  </label>

                  <button
                    type="button"
                    title="Move up (Z + 1)"
                    onClick={() =>
                      onChangeCellTileZIndex(
                        inspectedCell.col,
                        inspectedCell.row,
                        entry.zIndex,
                        entry.zIndex + 1
                      )
                    }
                    style={{ ...compactIconButtonStyle, height: 22, padding: '0 4px' }}
                  >
                    <ArrowUpIcon size={12} />
                  </button>
                  <button
                    type="button"
                    title="Move down (Z - 1)"
                    onClick={() =>
                      onChangeCellTileZIndex(
                        inspectedCell.col,
                        inspectedCell.row,
                        entry.zIndex,
                        entry.zIndex - 1
                      )
                    }
                    style={{ ...compactIconButtonStyle, height: 22, padding: '0 4px' }}
                  >
                    <ArrowDownIcon size={12} />
                  </button>
                  <button
                    type="button"
                    title="Remove tile from this layer"
                    onClick={() =>
                      onRemoveCellTile(inspectedCell.col, inspectedCell.row, entry.zIndex)
                    }
                    style={{
                      ...compactIconButtonStyle,
                      height: 22,
                      padding: '0 4px',
                      color: TOKENS.textMuted,
                    }}
                  >
                    <ClearIcon size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Intermediate Prefabs (Local) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderBottom: `1px solid ${TOKENS.hairline}`,
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
            Intermediate Prefabs (Local)
          </span>
          <span
            style={{
              fontFamily: TOKENS.fontMono,
              fontSize: 12,
              color: TOKENS.textMuted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {decodedIntermediates.length}
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {decodedIntermediates.length === 0 ? (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgCanvas,
                fontSize: 12,
                lineHeight: 1.5,
                color: TOKENS.textMuted,
              }}
            >
              Save an intermediate prefab to store it locally and drag-stamp copies onto larger grids.
            </div>
          ) : (
            decodedIntermediates.map(({ entry, stacked, layerCount, byteLength }) => (
              <div
                key={entry.id}
                draggable
                onDragStart={(e) => handlePrefabDragStart(e, entry.id)}
                onDragEnd={onDragEndPayload}
                title="Drag onto canvas to stamp a copy"
                style={{
                  padding: 8,
                  borderRadius: 8,
                  border: `1px solid ${TOKENS.hairline}`,
                  backgroundColor: TOKENS.bgCanvas,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  cursor: 'grab',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {stacked ? (
                    <PrefabThumbnailCanvas
                      prefab={stacked}
                      getPreviewUrl={getPreviewUrl}
                      size={52}
                    />
                  ) : (
                    <div
                      style={{
                        width: 52,
                        height: 52,
                        borderRadius: 6,
                        border: `1px solid ${TOKENS.hairline}`,
                        backgroundColor: TOKENS.bgDeepest,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: TOKENS.textPrimary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.name}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontFamily: TOKENS.fontMono,
                        fontSize: 12,
                        color: TOKENS.textMuted,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {entry.width}×{entry.height}
                      {layerCount > 1 ? ` · ${layerCount}L` : ''}
                      {(stacked?.anchorZ ?? entry.anchorZ ?? 0) !== 0
                        ? ` · Az${stacked?.anchorZ ?? entry.anchorZ ?? 0}`
                        : ''}{' '}
                      · {byteLength} B
                    </div>
                    <div style={{ marginTop: 2, fontSize: 11, color: TOKENS.accent }}>
                      Drag to stamp
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onLoadIntermediate(entry)}
                    style={{ ...compactIconButtonStyle, flex: 1 }}
                  >
                    <LoadIcon size={14} />
                    <span>Load</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onPlaceIntermediate(entry)}
                    style={{
                      ...compactIconButtonStyle,
                      flex: 1,
                      color: TOKENS.textPrimary,
                      borderColor: TOKENS.accentHairline,
                      backgroundColor: TOKENS.accentSurface,
                    }}
                  >
                    <PlaceIcon size={14} />
                    <span>Place</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteIntermediate(entry.id)}
                    title={`Delete ${entry.name}`}
                    style={{ ...compactIconButtonStyle, color: TOKENS.textMuted }}
                  >
                    <ClearIcon size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Backend Prefabs (PostgreSQL) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '12px 16px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: TOKENS.textPrimary }}>
            Backend Prefabs (PostgreSQL)
          </span>
          <button
            type="button"
            onClick={onRefreshBackend}
            disabled={isSyncingBackend}
            style={{
              ...compactIconButtonStyle,
              height: 26,
              opacity: isSyncingBackend ? 0.6 : 1,
            }}
          >
            <RefreshIcon size={13} />
            <span>{isSyncingBackend ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>

        {backendStatus && (
          <div
            style={{
              margin: '0 12px 8px',
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${TOKENS.hairline}`,
              backgroundColor:
                backendStatus.tone === 'positive'
                  ? TOKENS.positiveSurface
                  : backendStatus.tone === 'negative'
                    ? TOKENS.negativeSurface
                    : TOKENS.bgRaised,
              color:
                backendStatus.tone === 'positive'
                  ? TOKENS.positive
                  : backendStatus.tone === 'negative'
                    ? TOKENS.negative
                    : TOKENS.textSecondary,
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {backendStatus.text}
          </div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 12px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {backendPrefabs.length === 0 ? (
            <div
              style={{
                padding: 12,
                borderRadius: 8,
                border: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgCanvas,
                fontSize: 12,
                lineHeight: 1.5,
                color: TOKENS.textMuted,
              }}
            >
              No backend prefabs loaded. Save to backend when signed in or press Refresh.
            </div>
          ) : (
            backendPrefabs.map((summary) => {
              const isBusy = busyBackendId === summary.id;
              return (
                <div
                  key={summary.id}
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${TOKENS.hairline}`,
                    backgroundColor: TOKENS.bgCanvas,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    opacity: isBusy ? 0.65 : 1,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: TOKENS.textPrimary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {summary.name}
                    </span>
                    <span
                      style={{
                        fontFamily: TOKENS.fontMono,
                        fontSize: 12,
                        color: TOKENS.textMuted,
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >
                      {summary.width}×{summary.height} · {summary.byte_length} B
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onLoadBackend(summary)}
                      style={{ ...compactIconButtonStyle, flex: 1 }}
                    >
                      <LoadIcon size={14} />
                      <span>Load</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onPlaceBackend(summary)}
                      style={{
                        ...compactIconButtonStyle,
                        flex: 1,
                        color: TOKENS.textPrimary,
                        borderColor: TOKENS.accentHairline,
                        backgroundColor: TOKENS.accentSurface,
                      }}
                    >
                      <PlaceIcon size={14} />
                      <span>Place</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onDeleteBackend(summary.id)}
                      title={`Delete ${summary.name}`}
                      style={{ ...compactIconButtonStyle, color: TOKENS.textMuted }}
                    >
                      <ClearIcon size={14} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
