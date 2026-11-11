/**
 * World Manager.
 * Orchestrates procedural world generation, tileset slicing, loose viewport culling,
 * zero-allocation sprite pooling, character controller, and debug culling overlay.
 */

import { Container, Graphics, Sprite } from 'pixi.js';
import { TilesetManager } from './tileset/tileset.ts';
import { getTileAt, RENDER_TILE_SIZE, RENDER_SCALE, type WorldTile } from './procedural/worldGen.ts';
import { calculateTileBounds, type TileBounds } from './culling/looseCulling.ts';
import { SpritePool, type CullingTelemetry } from './culling/spritePool.ts';
import { useGameStore } from '../store/gameStore.ts';

export interface WorldConfig {
  seed: number;
  bufferMargin: number;
  viewportWidth: number;
  viewportHeight: number;
  tilesetPath?: string;
}

export class World {
  public readonly worldContainer: Container;
  public readonly tileContainer: Container;
  public readonly characterContainer: Container;
  public readonly debugOverlayContainer: Container;

  private readonly tilesetManager: TilesetManager;
  private readonly spritePool: SpritePool<Sprite>;

  // Character controller state
  public playerX = 0;
  public playerY = 0;
  private readonly baseSpeed = 240; // px/sec (3.75 tiles/sec)
  private readonly sprintSpeed = 480; // px/sec (7.5 tiles/sec)
  private readonly keysDown = new Set<string>();

  // Configuration and dimensions
  private seed: number;
  private bufferMargin: number;
  private viewportWidth: number;
  private viewportHeight: number;

  private characterBox: Graphics;
  private debugGraphics: Graphics;
  private isInitialized = false;
  private isDestroyed = false;
  private showDebugOverlay = false;
  private inspectInsetCulling = false;
  private facingAngle = -Math.PI / 2;
  private lastTelemetry: CullingTelemetry = {
    visibleCount: -1,
    loadedCount: -1,
    pooledCount: -1,
    totalAllocated: -1,
  };

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;
  private storeUnsubscribe: (() => void) | null = null;

  constructor(config: WorldConfig) {
    this.seed = config.seed;
    this.bufferMargin = config.bufferMargin;
    this.viewportWidth = config.viewportWidth;
    this.viewportHeight = config.viewportHeight;

    // Root containers
    this.worldContainer = new Container();
    this.worldContainer.sortableChildren = true;

    this.tileContainer = new Container();
    this.tileContainer.zIndex = 0;
    this.worldContainer.addChild(this.tileContainer);

    this.characterContainer = new Container();
    this.characterContainer.zIndex = 10;
    this.worldContainer.addChild(this.characterContainer);

    this.debugOverlayContainer = new Container();
    this.debugOverlayContainer.zIndex = 20;
    this.worldContainer.addChild(this.debugOverlayContainer);

    // Tileset manager
    this.tilesetManager = new TilesetManager();

    // Sprite pool with zero net allocations during movement
    this.spritePool = new SpritePool<Sprite>({
      createItem: () => {
        const sprite = new Sprite();
        sprite.scale.set(RENDER_SCALE);
        this.tileContainer.addChild(sprite);
        return sprite;
      },
      onActivate: (sprite: Sprite, tx: number, ty: number, tile: WorldTile) => {
        sprite.texture = this.tilesetManager.getTexture(tile.col, tile.row);
        sprite.position.set(tx * RENDER_TILE_SIZE, ty * RENDER_TILE_SIZE);
        sprite.visible = true;
      },
      onRecycle: (sprite: Sprite) => {
        sprite.visible = false;
      },
    });

    // Character placeholder box (32x32 centered at player position)
    this.characterBox = new Graphics();
    this.createCharacterBox();
    this.characterContainer.addChild(this.characterBox);

    // Debug overlay graphics
    this.debugGraphics = new Graphics();
    this.debugOverlayContainer.addChild(this.debugGraphics);

    // Event handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundBlur = () => this.keysDown.clear();
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('blur', this.boundBlur);

    // Subscribe to store debug overlay, inset inspector, buffer margin, and seed updates
    this.storeUnsubscribe = useGameStore.subscribe((state) => {
      const seedChanged = state.worldSeed !== this.seed;
      const overlayChanged =
        state.showDebugOverlay !== this.showDebugOverlay ||
        state.inspectInsetCulling !== this.inspectInsetCulling ||
        state.bufferMargin !== this.bufferMargin;

      this.showDebugOverlay = state.showDebugOverlay;
      this.inspectInsetCulling = state.inspectInsetCulling;
      this.bufferMargin = state.bufferMargin;
      this.seed = state.worldSeed;

      if (seedChanged) {
        this.spritePool.clear();
      }
      if ((seedChanged || overlayChanged) && !this.isDestroyed) {
        this.updateCameraAndCulling();
      }
    });

    // Sync initial state
    const currentStore = useGameStore.getState();
    this.showDebugOverlay = currentStore.showDebugOverlay;
    this.inspectInsetCulling = currentStore.inspectInsetCulling;
    this.bufferMargin = currentStore.bufferMargin;
    this.seed = currentStore.worldSeed;
  }

  /**
   * Initializes tileset textures and populates initial view tiles.
   */
  public async init(tilesetPath?: string): Promise<void> {
    await this.tilesetManager.load(tilesetPath);
    if (this.isDestroyed) return;
    this.isInitialized = true;
    this.updateCameraAndCulling();
  }

  private createCharacterBox(): void {
    this.characterBox.clear();
    // 32x32 box offset by -16,-16 to center on (playerX, playerY)
    this.characterBox.rect(-16, -16, 32, 32);
    this.characterBox.fill({ color: 0x38bdf8, alpha: 0.9 });
    this.characterBox.stroke({ color: 0xffffff, width: 2 });
    // Visor indicator pointing in current facing direction
    this.characterBox.rect(-6, -12, 12, 6);
    this.characterBox.fill({ color: 0x0f172a, alpha: 0.8 });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Ignore input if user is typing in a text field
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    if (e.code === 'KeyC' && !e.repeat) {
      useGameStore.getState().toggleDebugOverlay();
      return;
    }
    if (e.code === 'KeyI' && !e.repeat) {
      useGameStore.getState().toggleInspectInsetCulling();
      return;
    }

    this.keysDown.add(e.code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.code);
  }

  /**
   * Ticker update: processes delta-time normalized input, updates camera position,
   * performs loose viewport culling, and renders debug overlay.
   */
  public update(deltaSeconds: number): void {
    if (this.isDestroyed) return;

    this.processMovement(deltaSeconds);
    this.updateCameraAndCulling();
  }

  private processMovement(dt: number): void {
    let dx = 0;
    let dy = 0;

    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) dy -= 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) dy += 1;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) dx -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) dx += 1;

    if (dx !== 0 || dy !== 0) {
      // Normalize diagonal vectors
      if (dx !== 0 && dy !== 0) {
        dx *= Math.SQRT1_2;
        dy *= Math.SQRT1_2;
      }

      const isSprinting = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
      const speed = isSprinting ? this.sprintSpeed : this.baseSpeed;

      this.playerX += dx * speed * dt;
      this.playerY += dy * speed * dt;
      this.facingAngle = Math.atan2(dy, dx);

      // Sync player coordinates with store
      useGameStore.getState().setPlayerCoordinates(this.playerX, this.playerY, RENDER_TILE_SIZE);
    }

    // Update character placeholder box position and facing rotation in world space
    this.characterBox.position.set(this.playerX, this.playerY);
    this.characterBox.rotation = this.facingAngle + Math.PI / 2;
  }

  /**
   * Updates camera position with integer pixel rounding to eliminate tile shimmering,
   * evaluates loose culling bounds, and recycles sprites through the pool.
   */
  public updateCameraAndCulling(): void {
    if (!this.isInitialized || this.isDestroyed) return;

    // Center camera on player with integer pixel rounding
    const cameraWorldX = Math.round(this.viewportWidth / 2 - this.playerX);
    const cameraWorldY = Math.round(this.viewportHeight / 2 - this.playerY);
    this.worldContainer.position.set(cameraWorldX, cameraWorldY);

    const insetScale = this.showDebugOverlay && this.inspectInsetCulling ? 0.55 : 1.0;
    const effectiveWidth = this.viewportWidth * insetScale;
    const effectiveHeight = this.viewportHeight * insetScale;

    // Calculate loose culling bounds
    const bounds = calculateTileBounds(
      this.playerX,
      this.playerY,
      effectiveWidth,
      effectiveHeight,
      RENDER_TILE_SIZE,
      this.bufferMargin
    );

    // Update sprite pool
    this.spritePool.update(bounds, (tx, ty) => getTileAt(tx, ty, this.seed));

    // Telemetry (push to React store only on change)
    const telemetry = this.spritePool.getTelemetry(bounds);
    if (
      telemetry.visibleCount !== this.lastTelemetry.visibleCount ||
      telemetry.loadedCount !== this.lastTelemetry.loadedCount ||
      telemetry.pooledCount !== this.lastTelemetry.pooledCount ||
      telemetry.totalAllocated !== this.lastTelemetry.totalAllocated
    ) {
      this.lastTelemetry = telemetry;
      useGameStore.getState().setCullingTelemetry(telemetry);
    }

    // Update debug overlay
    this.renderDebugOverlay(bounds);
  }

  private renderDebugOverlay(bounds: TileBounds): void {
    this.debugGraphics.clear();
    if (!this.showDebugOverlay) return;

    // 1. Draw Visible Viewport Bounds in Green
    const visLeft = bounds.minVisX * RENDER_TILE_SIZE;
    const visTop = bounds.minVisY * RENDER_TILE_SIZE;
    const visWidth = (bounds.maxVisX - bounds.minVisX + 1) * RENDER_TILE_SIZE;
    const visHeight = (bounds.maxVisY - bounds.minVisY + 1) * RENDER_TILE_SIZE;

    this.debugGraphics.rect(visLeft, visTop, visWidth, visHeight);
    this.debugGraphics.stroke({ color: 0x22c55e, width: 3, alpha: 0.9 });

    // 2. Draw Preload Buffer Bounds in Amber/Orange
    const bufLeft = bounds.minBufX * RENDER_TILE_SIZE;
    const bufTop = bounds.minBufY * RENDER_TILE_SIZE;
    const bufWidth = (bounds.maxBufX - bounds.minBufX + 1) * RENDER_TILE_SIZE;
    const bufHeight = (bounds.maxBufY - bounds.minBufY + 1) * RENDER_TILE_SIZE;

    this.debugGraphics.rect(bufLeft, bufTop, bufWidth, bufHeight);
    this.debugGraphics.stroke({ color: 0xf59e0b, width: 2, alpha: 0.8 });

    // 3. Center crosshair at player position
    this.debugGraphics.moveTo(this.playerX - 12, this.playerY);
    this.debugGraphics.lineTo(this.playerX + 12, this.playerY);
    this.debugGraphics.moveTo(this.playerX, this.playerY - 12);
    this.debugGraphics.lineTo(this.playerX, this.playerY + 12);
    this.debugGraphics.stroke({ color: 0xef4444, width: 2, alpha: 1.0 });
  }

  public resize(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.updateCameraAndCulling();
  }

  public getTelemetry(): CullingTelemetry {
    const insetScale = this.showDebugOverlay && this.inspectInsetCulling ? 0.55 : 1.0;
    const bounds = calculateTileBounds(
      this.playerX,
      this.playerY,
      this.viewportWidth * insetScale,
      this.viewportHeight * insetScale,
      RENDER_TILE_SIZE,
      this.bufferMargin
    );
    return this.spritePool.getTelemetry(bounds);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('blur', this.boundBlur);
    if (this.storeUnsubscribe) {
      this.storeUnsubscribe();
      this.storeUnsubscribe = null;
    }
    this.spritePool.clear();
    this.tilesetManager.destroy();
    this.worldContainer.destroy({ children: true });
  }
}
