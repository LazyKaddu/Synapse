// Main game loop running at 60 FPS using requestAnimationFrame

import { Renderer } from './Renderer';
import { World } from './World';
import { PlayerController } from './entities/PlayerController';
import { MonsterController } from './entities/MonsterController';
import { gameSocket } from '../network/socket';
import { OpCode, EntityMovePacket, PlayerMovePacket, ChunkDataPacket } from '../network/opcodes';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { Vector3 } from '../types/protocol';

type GameState = 'loading' | 'running' | 'paused' | 'error';

interface GameLoopConfig {
  targetFPS: number;
  fixedTimestep: number;
  maxSubSteps: number;
}

const DEFAULT_CONFIG: GameLoopConfig = {
  targetFPS: 60,
  fixedTimestep: 1 / 60, // 16.666ms
  maxSubSteps: 3,
};

export class GameLoop {
  private renderer: Renderer;
  private world: World;
  private playerController: PlayerController;
  private monsterController: MonsterController;
  
  private state: GameState = 'loading';
  private lastTime = 0;
  private accumulator = 0;
  private frameCount = 0;
  private fps = 0;
  private fpsUpdateTime = 0;
  
  private animationFrameId: number | null = null;
  private config: GameLoopConfig;
  
  // Network interpolation
  private networkUpdateAccumulator = 0;
  private readonly NETWORK_UPDATE_RATE = 20; // 20 Hz network updates
  private lastSentPosition: Vector3 = { x: 0, y: 0, z: 0 };
  private positionThreshold = 0.05; // Minimum distance to send update

  constructor(canvas: HTMLCanvasElement, config: Partial<GameLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize core systems
    this.renderer = new Renderer(canvas);
    this.world = new World(this.renderer);
    this.playerController = new PlayerController(this.renderer, this.world);
    this.monsterController = new MonsterController(this.renderer, this.world);
    
    this.setupNetworkHandlers();
    this.setupInputHandlers();
  }

  private setupNetworkHandlers(): void {
    // Entity movement updates from server
    gameSocket.on(OpCode.ENTITY_MOVE, (packet: EntityMovePacket) => {
      this.handleEntityMove(packet);
    });

    // Player position updates (authoritative correction)
    gameSocket.on(OpCode.PLAYER_POSITION_UPDATE, (packet: PlayerMovePacket) => {
      this.handlePlayerPositionUpdate(packet);
    });

    // Chunk data
    gameSocket.on(OpCode.CHUNK_DATA, (packet: ChunkDataPacket) => {
      this.world.loadChunkData(packet.chunkX, packet.chunkY, packet.data);
    });

    // Entity spawn/despawn
    gameSocket.on(OpCode.CHARACTER_SPAWN, (packet) => {
      this.handleEntitySpawn(packet);
    });

    gameSocket.on(OpCode.CHARACTER_DESPAWN, (packet) => {
      this.handleEntityDespawn(packet);
    });

    // Connection state
    gameSocket.onConnectionChange((connected) => {
      if (connected) {
        this.sendHello();
      } else {
        this.setState('paused');
      }
    });
  }

  private setupInputHandlers(): void {
    // Input is handled by PlayerController
    // We just need to send movement updates to server
  }

  private sendHello(): void {
    const helloPacket = gameSocket.packetBuilder.buildHello('1.0.0', 1);
    gameSocket.send(helloPacket).catch(console.error);
  }

  private handleEntityMove(packet: EntityMovePacket): void {
    const { entityId, position, velocity, rotation } = packet;
    
    // Update or create entity
    const player = useGameStore.getState().players.get(entityId);
    const monster = useGameStore.getState().monsters.get(entityId);
    
    if (player) {
      useGameStore.getState().updatePlayer(entityId, { position, velocity, rotation });
      this.playerController.updateRemotePlayer(entityId, position, velocity, rotation);
    } else if (monster) {
      useGameStore.getState().updateMonster(entityId, { position, velocity, rotation });
      this.monsterController.updateMonster(entityId, position, velocity, rotation);
    } else {
      // Unknown entity, create as generic
      this.playerController.createRemotePlayer(entityId, position, rotation);
    }
  }

  private handlePlayerPositionUpdate(packet: PlayerMovePacket): void {
    // Server-authoritative position correction
    const { position, velocity, rotation } = packet;
    this.playerController.correctPosition(position, velocity, rotation);
    useGameStore.getState().updatePlayerPosition(position, velocity, rotation);
  }

  private handleEntitySpawn(packet: any): void {
    // Handle entity spawn from server
    const { entityId, entityType, position, rotation, metadata } = packet;
    
    if (entityType === 'player') {
      this.playerController.createRemotePlayer(entityId, position, rotation, metadata);
    } else if (entityType === 'monster') {
      this.monsterController.spawnMonster(entityId, position, rotation, metadata);
    }
  }

  private handleEntityDespawn(packet: any): void {
    const { entityId } = packet;
    this.playerController.removeRemotePlayer(entityId);
    this.monsterController.despawnMonster(entityId);
    useGameStore.getState().removeEntity(entityId);
  }

  // Main loop entry point
  start(): void {
    if (this.state === 'running') return;
    
    this.setState('running');
    this.lastTime = performance.now();
    this.tick();
  }

  stop(): void {
    this.setState('paused');
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private tick = (currentTime: number): void => {
    if (this.state !== 'running') return;

    const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;

    // Clamp delta time to prevent spiral of death
    const clampedDelta = Math.min(deltaTime, 0.25);

    // Fixed timestep accumulation
    this.accumulator += clampedDelta;
    
    // Update FPS counter
    this.updateFPS(currentTime);

    // Fixed update steps
    let subSteps = 0;
    while (this.accumulator >= this.config.fixedTimestep && subSteps < this.config.maxSubSteps) {
      this.fixedUpdate(this.config.fixedTimestep);
      this.accumulator -= this.config.fixedTimestep;
      subSteps++;
    }

    // Variable update (rendering, interpolation)
    const interpolationAlpha = this.accumulator / this.config.fixedTimestep;
    this.update(clampedDelta, interpolationAlpha);

    // Render
    this.render(interpolationAlpha);

    // Schedule next frame
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private fixedUpdate(deltaTime: number): void {
    // Physics, game logic at fixed rate
    this.playerController.fixedUpdate(deltaTime);
    this.monsterController.fixedUpdate(deltaTime);
    this.world.fixedUpdate(deltaTime);
    
    // Send network updates at fixed rate
    this.networkUpdateAccumulator += deltaTime;
    const networkInterval = 1 / this.NETWORK_UPDATE_RATE;
    
    if (this.networkUpdateAccumulator >= networkInterval) {
      this.sendNetworkUpdate();
      this.networkUpdateAccumulator = 0;
    }
  }

  private update(deltaTime: number, interpolationAlpha: number): void {
    // Variable rate updates (input, UI, interpolation)
    this.playerController.update(deltaTime, interpolationAlpha);
    this.monsterController.update(deltaTime, interpolationAlpha);
    this.world.update(deltaTime, interpolationAlpha);
    this.renderer.update(deltaTime);
  }

  private render(interpolationAlpha: number): void {
    this.renderer.render(interpolationAlpha);
  }

  private sendNetworkUpdate(): void {
    const player = this.playerController.getLocalPlayer();
    if (!player) return;

    const position = player.position;
    const velocity = player.velocity;
    const rotation = player.rotation;
    const inputFlags = useGameStore.getState().inputFlags;

    // Only send if position changed significantly
    const dx = position.x - this.lastSentPosition.x;
    const dy = position.y - this.lastSentPosition.y;
    const dz = position.z - this.lastSentPosition.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;

    if (distanceSq > this.positionThreshold * this.positionThreshold || inputFlags !== 0) {
      gameSocket.sendPlayerMove(position, velocity, rotation, inputFlags).catch(console.error);
      this.lastSentPosition = { ...position };
    }
  }

  private updateFPS(currentTime: number): void {
    this.frameCount++;
    if (currentTime - this.fpsUpdateTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsUpdateTime = currentTime;
      useGameStore.getState().setLatency(this.fps); // Reusing latency field for FPS display
    }
  }

  private setState(newState: GameState): void {
    this.state = newState;
    console.log(`[GameLoop] State changed to: ${newState}`);
  }

  // Public API
  getRenderer(): Renderer {
    return this.renderer;
  }

  getWorld(): World {
    return this.world;
  }

  getPlayerController(): PlayerController {
    return this.playerController;
  }

  getMonsterController(): MonsterController {
    return this.monsterController;
  }

  getFPS(): number {
    return this.fps;
  }

  getState(): GameState {
    return this.state;
  }

  // Resize handler
  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
  }

  // Cleanup
  destroy(): void {
    this.stop();
    this.renderer.destroy();
    this.world.destroy();
    this.playerController.destroy();
    this.monsterController.destroy();
  }
}

// Singleton instance getter
let gameLoopInstance: GameLoop | null = null;

export function createGameLoop(canvas: HTMLCanvasElement, config?: Partial<GameLoopConfig>): GameLoop {
  if (gameLoopInstance) {
    gameLoopInstance.destroy();
  }
  gameLoopInstance = new GameLoop(canvas, config);
  return gameLoopInstance;
}

export function getGameLoop(): GameLoop | null {
  return gameLoopInstance;
}

export function destroyGameLoop(): void {
  if (gameLoopInstance) {
    gameLoopInstance.destroy();
    gameLoopInstance = null;
  }
}