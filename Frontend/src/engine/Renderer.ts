// PixiJS Application setup and canvas mounting

import * as PIXI from 'pixi.js';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';

export interface RendererConfig {
  width: number;
  height: number;
  backgroundColor: number;
  resolution: number;
  autoDensity: boolean;
  antialias: boolean;
  preferWebGL: boolean;
}

const DEFAULT_CONFIG: RendererConfig = {
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x1a1a2e,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  antialias: true,
  preferWebGL: true,
};

export class Renderer {
  public app: PIXI.Application;
  public stage: Container;
  public worldContainer: Container;
  public uiContainer: Container;
  public effectsContainer: Container;
  
  private config: RendererConfig;
  private canvas: HTMLCanvasElement;
  private statsContainer: Container;
  private fpsText: Text;
  private entityCountText: Text;

  constructor(canvas: HTMLCanvasElement, config: Partial<RendererConfig> = {}) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Create PixiJS Application
    this.app = new PIXI.Application({
      view: this.canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundColor: this.config.backgroundColor,
      resolution: this.config.resolution,
      autoDensity: this.config.autoDensity,
      antialias: this.config.antialias,
      preferWebGL: this.config.preferWebGL,
    });

    // Setup container hierarchy
    this.stage = this.app.stage;
    this.setupContainers();
    this.setupDebugStats();
    this.setupResizeHandler();
  }

  private setupContainers(): void {
    // World container (game world, entities, terrain)
    this.worldContainer = new Container();
    this.worldContainer.sortableChildren = true;
    this.worldContainer.zIndex = 0;
    this.stage.addChild(this.worldContainer);

    // Effects container (particles, spell effects)
    this.effectsContainer = new Container();
    this.effectsContainer.zIndex = 10;
    this.stage.addChild(this.effectsContainer);

    // UI container (health bars, nameplates, minimap)
    this.uiContainer = new Container();
    this.uiContainer.zIndex = 100;
    this.stage.addChild(this.uiContainer);
  }

  private setupDebugStats(): void {
    this.statsContainer = new Container();
    this.statsContainer.zIndex = 1000;
    this.stage.addChild(this.statsContainer);

    const style = new TextStyle({
      fontFamily: 'Monospace',
      fontSize: 14,
      fill: 0x00ff00,
      stroke: 0x000000,
      strokeThickness: 2,
    });

    this.fpsText = new Text('FPS: 0', style);
    this.fpsText.position.set(10, 10);
    this.statsContainer.addChild(this.fpsText);

    this.entityCountText = new Text('Entities: 0', style);
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

  // Main render call (called by GameLoop)
  render(interpolationAlpha: number): void {
    // PixiJS auto-renders via requestAnimationFrame
    // This method can be used for manual render if needed
    this.app.render();
  }

  // Update loop (called at variable rate)
  update(deltaTime: number): void {
    // Update PixiJS ticker
    this.app.ticker.update();
  }

  // Fixed update (called at fixed rate)
  fixedUpdate(deltaTime: number): void {
    // Physics updates would go here if using a physics engine
  }

  // Resize canvas and renderer
  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;
    
    this.app.renderer.resize(width, height);
    
    // Update camera/viewport
    this.worldContainer.position.set(width / 2, height / 2);
  }

  // Get world position from screen coordinates
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const worldPos = this.worldContainer.toLocal(new PIXI.Point(screenX, screenY));
    return { x: worldPos.x, y: worldPos.y };
  }

  // Get screen position from world coordinates
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    const screenPos = this.worldContainer.toGlobal(new PIXI.Point(worldX, worldY));
    return { x: screenPos.x, y: screenPos.y };
  }

  // Add child to world container
  addToWorld(child: PIXI.DisplayObject, zIndex = 0): void {
    child.zIndex = zIndex;
    this.worldContainer.addChild(child);
  }

  // Remove child from world container
  removeFromWorld(child: PIXI.DisplayObject): void {
    this.worldContainer.removeChild(child);
  }

  // Add child to UI container
  addToUI(child: PIXI.DisplayObject): void {
    this.uiContainer.addChild(child);
  }

  // Remove child from UI container
  removeFromUI(child: PIXI.DisplayObject): void {
    this.uiContainer.removeChild(child);
  }

  // Add child to effects container
  addEffect(child: PIXI.DisplayObject): void {
    this.effectsContainer.addChild(child);
  }

  // Remove child from effects container
  removeEffect(child: PIXI.DisplayObject): void {
    this.effectsContainer.removeChild(child);
  }

  // Camera follow
  follow(target: { x: number; y: number }, lerp = 0.1): void {
    const targetX = -target.x + this.config.width / 2;
    const targetY = -target.y + this.config.height / 2;
    
    this.worldContainer.position.x += (targetX - this.worldContainer.position.x) * lerp;
    this.worldContainer.position.y += (targetY - this.worldContainer.position.y) * lerp;
  }

  // Set camera position directly
  setCameraPosition(x: number, y: number): void {
    this.worldContainer.position.set(-x + this.config.width / 2, -y + this.config.height / 2);
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

  // Get canvas element
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // Get renderer dimensions
  getWidth(): number {
    return this.config.width;
  }

  getHeight(): number {
    return this.config.height;
  }

  // Destroy renderer and cleanup
  destroy(): void {
    window.removeEventListener('resize', (this as any)._resizeHandler);
    this.app.destroy(true, { children: true, texture: true, baseTexture: true });
  }
}

// Utility: Create a simple colored rectangle for debugging
export function createDebugRect(
  width: number,
  height: number,
  color: number = 0xff0000,
  alpha: number = 0.5
): Graphics {
  const rect = new Graphics();
  rect.rect(0, 0, width, height);
  rect.fill({ color, alpha });
  return rect;
}

// Utility: Create a circle for debugging
export function createDebugCircle(
  radius: number,
  color: number = 0x00ff00,
  alpha: number = 0.5
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
  const defaultStyle: TextStyle = new TextStyle({
    fontFamily: 'Arial',
    fontSize: 12,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 2,
    ...style,
  });
  return new Text(text, defaultStyle);
}