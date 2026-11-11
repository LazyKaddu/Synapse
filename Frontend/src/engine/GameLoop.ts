/**
 * Main PixiJS v8 Game Loop Orchestrator.
 * Connects the Renderer and World engine inside a unified lifecycle.
 */

import type { Ticker } from 'pixi.js';
import { Renderer, type RendererConfig } from './Renderer.ts';
import { World } from './World.ts';
import { useGameStore } from '../store/gameStore.ts';

export interface GameLoopOptions {
  rendererConfig?: Partial<RendererConfig>;
  tilesetPath?: string;
}

export class GameLoop {
  private readonly renderer: Renderer;
  private readonly world: World;
  private readonly tilesetPath?: string;

  private tickerCallback: ((ticker: Ticker) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private isDestroyed = false;
  private isRunning = false;

  constructor(canvas: HTMLCanvasElement, options: GameLoopOptions = {}) {
    const width = options.rendererConfig?.width ?? window.innerWidth;
    const height = options.rendererConfig?.height ?? window.innerHeight;
    const store = useGameStore.getState();

    this.tilesetPath = options.tilesetPath;
    this.renderer = new Renderer(canvas, {
      width,
      height,
      backgroundColor: 0x0f172a,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      antialias: false,
      showStats: false,
      ...options.rendererConfig,
    });

    this.world = new World({
      seed: store.worldSeed,
      bufferMargin: store.bufferMargin,
      viewportWidth: width,
      viewportHeight: height,
      tilesetPath: options.tilesetPath,
    });
  }

  /**
   * Initializes the PixiJS application, loads tilesets, and starts the loop.
   */
  public async start(): Promise<void> {
    if (this.isRunning || this.isDestroyed) return;

    await this.renderer.init();
    if (this.isDestroyed) {
      this.renderer.destroy();
      return;
    }

    await this.world.init(this.tilesetPath);
    if (this.isDestroyed) {
      this.world.destroy();
      this.renderer.destroy();
      return;
    }

    this.renderer.addToWorld(this.world.worldContainer);

    this.tickerCallback = (ticker: Ticker) => {
      if (this.isDestroyed) return;
      const dt = Math.min(ticker.deltaMS / 1000, 0.1);
      this.world.update(dt);
    };
    this.renderer.app.ticker.add(this.tickerCallback);

    this.resizeHandler = () => {
      if (this.isDestroyed) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.renderer.resize(width, height);
      this.world.resize(width, height);
    };
    window.addEventListener('resize', this.resizeHandler);

    this.isRunning = true;
  }

  public getRenderer(): Renderer {
    return this.renderer;
  }

  public getWorld(): World {
    return this.world;
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.isRunning = false;

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.tickerCallback) {
      this.renderer.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }
    this.world.destroy();
    this.renderer.destroy();
  }
}
