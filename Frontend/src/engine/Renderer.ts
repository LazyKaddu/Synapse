// PixiJS Application setup and canvas mounting

import { Application, Container, Graphics, Text, TextStyle, Point } from 'pixi.js';

export interface RendererConfig {
  width: number;
  height: number;
  backgroundColor: number;
  resolution: number;
  autoDensity: boolean;
  antialias: boolean;
  preferWebGL: boolean;
  showStats?: boolean;
}

const DEFAULT_CONFIG: RendererConfig = {
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x1a1a2e,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true,
  preferWebGL: true,
  showStats: false,
};

export class Renderer {
  public app: Application;
  public stage: Container;
  public worldContainer: Container;
  public uiContainer: Container;
  public effectsContainer: Container;
  
  private config: RendererConfig;
  private canvas: HTMLCanvasElement;
  private statsContainer: Container;
  private fpsText: Text;
  private entityCountText: Text;
  private isInitialized = false;
  private destroyRequested = false;

  constructor(canvas: HTMLCanvasElement, config: Partial<RendererConfig> = {}) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.app = new Application();
    this.stage = this.app.stage;
    this.worldContainer = new Container();
    this.uiContainer = new Container();
    this.effectsContainer = new Container();
    this.statsContainer = new Container();
    this.fpsText = new Text({ text: 'FPS: 0' });
    this.entityCountText = new Text({ text: 'Entities: 0' });
  }

  public async init(): Promise<void> {
    if (this.isInitialized || this.destroyRequested) return;

    await this.app.init({
      canvas: this.canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundColor: this.config.backgroundColor,
      resolution: this.config.resolution,
      autoDensity: this.config.autoDensity,
      antialias: this.config.antialias,
      preference: this.config.preferWebGL ? 'webgl' : undefined,
    });

    if (this.destroyRequested) {
      this.app.destroy({ removeView: false }, { children: true });
      this.destroyUnattachedContainers();
      return;
    }

    this.stage = this.app.stage;
    this.setupContainers();
    if (this.config.showStats) {
      this.setupDebugStats();
    }
    this.setupResizeHandler();
    this.isInitialized = true;
  }

  private setupContainers(): void {
    // World container (game world, entities, terrain)
    this.worldContainer.sortableChildren = true;
    this.worldContainer.zIndex = 0;
    this.stage.addChild(this.worldContainer);

    // Effects container (particles, spell effects)
    this.effectsContainer.zIndex = 10;
    this.stage.addChild(this.effectsContainer);

    // UI container (health bars, nameplates, minimap)
    this.uiContainer.zIndex = 100;
    this.stage.addChild(this.uiContainer);
  }

  private setupDebugStats(): void {
    this.statsContainer.zIndex = 1000;
    this.stage.addChild(this.statsContainer);

    const style = new TextStyle({
      fontFamily: 'Monospace',
      fontSize: 14,
      fill: 0x00ff00,
      stroke: { color: 0x000000, width: 2 },
    });

    this.fpsText = new Text({ text: 'FPS: 0', style });
    this.fpsText.position.set(10, 10);
    this.statsContainer.addChild(this.fpsText);

    this.entityCountText = new Text({ text: 'Entities: 0', style });
    this.entityCountText.position.set(10, 30);
    this.statsContainer.addChild(this.entityCountText);
  }

  private setupResizeHandler(): void {
    const handleResize = () => {
      this.resize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    
    // Store for cleanup
    (this as any)._resizeHandler = handleResize;
  }

  // Update debug stats
  updateStats(fps: number, entityCount: number): void {
    this.fpsText.text = `FPS: ${fps}`;
    this.entityCountText.text = `Entities: ${entityCount}`;
  }

  // Main render call
  render(): void {
    this.app.render();
  }

  // Update loop
  update(): void {
    this.app.ticker.update();
  }

  // Resize canvas and renderer
  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;

    if (this.isInitialized) {
      this.app.renderer.resize(width, height);
    }
  }

  // Get world position from screen coordinates
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const worldPos = this.worldContainer.toLocal(new Point(screenX, screenY));
    return { x: worldPos.x, y: worldPos.y };
  }

  // Get screen position from world coordinates
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const screenPos = this.worldContainer.toGlobal(new Point(worldX, worldY));
    return { x: screenPos.x, y: screenPos.y };
  }

  // Add child to world container
  addToWorld(child: Container, zIndex = 0): void {
    child.zIndex = zIndex;
    this.worldContainer.addChild(child);
  }

  // Remove child from world container
  removeFromWorld(child: Container): void {
    this.worldContainer.removeChild(child);
  }

  // Add child to UI container
  addToUI(child: Container): void {
    this.uiContainer.addChild(child);
  }

  // Remove child from UI container
  removeFromUI(child: Container): void {
    this.uiContainer.removeChild(child);
  }

  // Add child to effects container
  addEffect(child: Container): void {
    this.effectsContainer.addChild(child);
  }

  // Remove child from effects container
  removeEffect(child: Container): void {
    this.effectsContainer.removeChild(child);
  }

  // Camera follow with integer pixel rounding to eliminate tile shimmering
  follow(target: { x: number; y: number }, lerp = 0.1): void {
    const targetX = Math.round(-target.x + this.config.width / 2);
    const targetY = Math.round(-target.y + this.config.height / 2);
    
    this.worldContainer.position.x = Math.round(
      this.worldContainer.position.x + (targetX - this.worldContainer.position.x) * lerp
    );
    this.worldContainer.position.y = Math.round(
      this.worldContainer.position.y + (targetY - this.worldContainer.position.y) * lerp
    );
  }

  // Set camera position directly with integer pixel rounding
  setCameraPosition(x: number, y: number): void {
    this.worldContainer.position.set(
      Math.round(-x + this.config.width / 2),
      Math.round(-y + this.config.height / 2)
    );
  }

  // Get camera position
  getCameraPosition(): { x: number; y: number } {
    return {
      x: -this.worldContainer.position.x + this.config.width / 2,
      y: -this.worldContainer.position.y + this.config.height / 2,
    };
  }

  // Screen shake effect
  shake(intensity: number, duration: number): void {
    const originalX = this.worldContainer.position.x;
    const originalY = this.worldContainer.position.y;
    const startTime = Date.now();

    const shakeUpdate = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / duration;
      
      if (progress >= 1) {
        this.worldContainer.position.set(originalX, originalY);
        this.app.ticker.remove(shakeUpdate);
        return;
      }

      const currentIntensity = intensity * (1 - progress);
      this.worldContainer.position.set(
        originalX + (Math.random() - 0.5) * currentIntensity,
        originalY + (Math.random() - 0.5) * currentIntensity
      );
    };

    this.app.ticker.add(shakeUpdate);
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getWidth(): number {
    return this.config.width;
  }

  getHeight(): number {
    return this.config.height;
  }

  private destroyUnattachedContainers(): void {
    const containers: Container[] = [
      this.worldContainer,
      this.uiContainer,
      this.effectsContainer,
      this.statsContainer,
      this.fpsText,
      this.entityCountText,
    ];
    for (const container of containers) {
      if (!container.destroyed) {
        container.destroy({ children: true });
      }
    }
  }

  destroy(): void {
    this.destroyRequested = true;
    if ((this as any)._resizeHandler) {
      window.removeEventListener('resize', (this as any)._resizeHandler);
      (this as any)._resizeHandler = null;
    }
    if (this.isInitialized) {
      this.app.destroy({ removeView: false }, { children: true });
      this.isInitialized = false;
    }
  }
}

// Utility: Create a simple colored rectangle for debugging
export function createDebugRect(
  width: number,
  height: number,
  color = 0xff0000,
  alpha = 0.5
): Graphics {
  const rect = new Graphics();
  rect.rect(0, 0, width, height);
  rect.fill({ color, alpha });
  return rect;
}

// Utility: Create a circle for debugging
export function createDebugCircle(
  radius: number,
  color = 0x00ff00,
  alpha = 0.5
): Graphics {
  const circle = new Graphics();
  circle.circle(0, 0, radius);
  circle.fill({ color, alpha });
  return circle;
}

// Utility: Create text label
export function createLabel(
  text: string,
  style: Partial<TextStyle> = {}
): Text {
  const defaultStyle = new TextStyle({
    fontFamily: 'Arial',
    fontSize: 12,
    fill: 0xffffff,
    stroke: { color: 0x000000, width: 2 },
    ...style,
  });
  return new Text({ text, style: defaultStyle });
}
