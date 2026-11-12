import { type JSX, useEffect, useRef } from 'react';
import type {
  PrefabData,
  StackedPrefabData,
} from '../../../engine/prefab/PrefabCodec.ts';
import { EMPTY_ASSET_ID } from '../../../engine/prefab/assetRegistry.ts';
import { TOKENS } from './theme.ts';

interface PrefabThumbnailCanvasProps {
  prefab: PrefabData | StackedPrefabData;
  getPreviewUrl: (assetId: number) => string | undefined;
  size?: number;
}

const imageCache = new Map<string, HTMLImageElement>();
const pendingImageLoads = new Map<string, Promise<HTMLImageElement | null>>();

function loadPreviewImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  const existing = pendingImageLoads.get(url);
  if (existing) {
    return existing;
  }

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache.set(url, img);
      pendingImageLoads.delete(url);
      resolve(img);
    };
    img.onerror = () => {
      pendingImageLoads.delete(url);
      resolve(null);
    };
    img.src = url;
  });

  pendingImageLoads.set(url, promise);
  return promise;
}

export function PrefabThumbnailCanvas({
  prefab,
  getPreviewUrl,
  size = 56,
}: PrefabThumbnailCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;

    const layers =
      'layers' in prefab
        ? [...prefab.layers].sort((a, b) => a.zIndex - b.zIndex)
        : [{ zIndex: 0, prefab }];

    const draw = async (): Promise<void> => {
      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;

      if (prefab.width <= 0 || prefab.height <= 0 || layers.length === 0) {
        return;
      }

      const uniqueUrls = new Set<string>();
      for (const layer of layers) {
        for (let i = 0; i < layer.prefab.grid.length; i++) {
          const assetId = layer.prefab.grid[i];
          if (assetId === EMPTY_ASSET_ID) continue;
          const url = getPreviewUrl(assetId);
          if (url && !imageCache.has(url)) {
            uniqueUrls.add(url);
          }
        }
      }

      if (uniqueUrls.size > 0) {
        await Promise.all(Array.from(uniqueUrls, (url) => loadPreviewImage(url)));
        if (cancelled) return;
      }

      ctx.clearRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = false;

      const padding = 4;
      const available = size - padding * 2;
      const maxDim = Math.max(prefab.width, prefab.height);
      const cellPx = Math.max(1, Math.floor(available / maxDim));
      const drawW = prefab.width * cellPx;
      const drawH = prefab.height * cellPx;
      const offsetX = Math.floor((size - drawW) / 2);
      const offsetY = Math.floor((size - drawH) / 2);

      for (const layer of layers) {
        const layerGrid = layer.prefab.grid;
        for (let row = 0; row < prefab.height; row++) {
          for (let col = 0; col < prefab.width; col++) {
            const assetId = layerGrid[row * prefab.width + col];
            if (assetId === EMPTY_ASSET_ID) continue;

            const url = getPreviewUrl(assetId);
            const img = url ? imageCache.get(url) : undefined;
            const dx = offsetX + col * cellPx;
            const dy = offsetY + row * cellPx;

            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, dx, dy, cellPx, cellPx);
            } else {
              ctx.fillStyle = TOKENS.textMuted;
              ctx.fillRect(dx, dy, cellPx, cellPx);
            }
          }
        }
      }
    };

    void draw();

    return () => {
      cancelled = true;
    };
  }, [prefab, getPreviewUrl, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: 'block',
        imageRendering: 'pixelated',
        backgroundColor: TOKENS.bgDeepest,
        borderRadius: 6,
        border: `1px solid ${TOKENS.hairline}`,
        flexShrink: 0,
      }}
    />
  );
}
