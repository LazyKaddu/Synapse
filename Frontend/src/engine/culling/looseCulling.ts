/**
 * Loose Viewport Culling Mathematics.
 * Calculates exact screen-visible tile bounds and expanded preload buffer bounds.
 */

export interface TileBounds {
  // Visible viewport bounding box in tile coordinates
  readonly minVisX: number;
  readonly maxVisX: number;
  readonly minVisY: number;
  readonly maxVisY: number;

  // Loose preload buffer bounding box in tile coordinates
  readonly minBufX: number;
  readonly maxBufX: number;
  readonly minBufY: number;
  readonly maxBufY: number;

  // Real-time counts
  readonly visibleTileCount: number;
  readonly bufferedTileCount: number;
}

/**
 * Calculates visible and buffered tile coordinates given camera world position,
 * screen dimensions, tile rendered size, and loose preload buffer margin.
 */
export function calculateTileBounds(
  cameraX: number,
  cameraY: number,
  viewportWidth: number,
  viewportHeight: number,
  tileSize = 64,
  bufferMargin = 2
): TileBounds {
  // World space rectangle covered by viewport
  const halfW = viewportWidth / 2;
  const halfH = viewportHeight / 2;

  const worldMinX = cameraX - halfW;
  const worldMaxX = cameraX + halfW;
  const worldMinY = cameraY - halfH;
  const worldMaxY = cameraY + halfH;

  // Calculate visible tile boundaries
  const minVisX = Math.floor(worldMinX / tileSize);
  const maxVisX = Math.floor((worldMaxX - 0.001) / tileSize);
  const minVisY = Math.floor(worldMinY / tileSize);
  const maxVisY = Math.floor((worldMaxY - 0.001) / tileSize);

  // Expand by buffer margin
  const minBufX = minVisX - bufferMargin;
  const maxBufX = maxVisX + bufferMargin;
  const minBufY = minVisY - bufferMargin;
  const maxBufY = maxVisY + bufferMargin;

  const visibleTileCount = Math.max(0, maxVisX - minVisX + 1) * Math.max(0, maxVisY - minVisY + 1);
  const bufferedTileCount = Math.max(0, maxBufX - minBufX + 1) * Math.max(0, maxBufY - minBufY + 1);

  return {
    minVisX,
    maxVisX,
    minVisY,
    maxVisY,
    minBufX,
    maxBufX,
    minBufY,
    maxBufY,
    visibleTileCount,
    bufferedTileCount,
  };
}

/**
 * Checks whether a given tile coordinate is within the visible viewport bounds.
 */
export function isTileVisible(tx: number, ty: number, bounds: TileBounds): boolean {
  return (
    tx >= bounds.minVisX &&
    tx <= bounds.maxVisX &&
    ty >= bounds.minVisY &&
    ty <= bounds.maxVisY
  );
}

/**
 * Checks whether a given tile coordinate is within the loose preload buffer bounds.
 */
export function isTileBuffered(tx: number, ty: number, bounds: TileBounds): boolean {
  return (
    tx >= bounds.minBufX &&
    tx <= bounds.maxBufX &&
    ty >= bounds.minBufY &&
    ty <= bounds.maxBufY
  );
}
