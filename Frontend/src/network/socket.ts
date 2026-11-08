// Core WebSocket singleton and event loop for real-time communication

import { OpCode, ServerPacket, ClientPacket, BasePacket } from './opcodes';
import { parsePacket, createPacketBuilder, validatePacket, HEADER_SIZE } from './binary';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';

type PacketHandler = (packet: ServerPacket) => void;
type ConnectionHandler = (connected: boolean) => void;
type ErrorHandler = (error: Error) => void;

interface QueuedPacket {
  data: Uint8Array;
  resolve: (value: void) => void;
  reject: (reason: Error) => void;
}

export class GameSocket {
  private static instance: GameSocket | null = null;
  private ws: WebSocket | null = null;
  private url: string = '';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private sequence = 0;
  private handlers: Map<OpCode, Set<PacketHandler>> = new Map();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private packetQueue: QueuedPacket[] = [];
  private isConnecting = false;
  private shouldReconnect = true;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private pendingPings: Map<number, number> = new Map(); // sequence -> timestamp
  private packetBuilder: ReturnType<typeof createPacketBuilder>;

  private constructor() {
    this.packetBuilder = createPacketBuilder(() => this.nextSequence());
  }

  static getInstance(): GameSocket {
    if (!GameSocket.instance) {
      GameSocket.instance = new GameSocket();
    }
    return GameSocket.instance;
  }

  static destroy(): void {
    if (GameSocket.instance) {
      GameSocket.instance.disconnect();
      GameSocket.instance = null;
    }
  }

  // Connect to game server
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        // Wait for existing connection attempt
        const checkConnection = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkConnection);
            resolve();
          } else if (this.ws?.readyState === WebSocket.CLOSED) {
            clearInterval(checkConnection);
            reject(new Error('Connection failed'));
          }
        }, 100);
        return;
      }

      this.url = url;
      this.isConnecting = true;
      this.shouldReconnect = true;

      try {
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this.setupEventListeners(resolve, reject);
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private setupEventListeners(resolve: () => void, reject: (error: Error) => void): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('[GameSocket] Connected to', this.url);
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushQueue();
      this.notifyConnectionChange(true);
      resolve();
    };

    this.ws.onclose = (event) => {
      console.log('[GameSocket] Disconnected:', event.code, event.reason);
      this.stopHeartbeat();
      this.isConnecting = false;
      this.notifyConnectionChange(false);

      if (this.shouldReconnect && !event.wasClean) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event) => {
      console.error('[GameSocket] Error:', event);
      const error = new Error('WebSocket error');
      this.notifyError(error);
      if (this.isConnecting) {
        this.isConnecting = false;
        reject(error);
      }
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: ArrayBuffer): void {
    const validation = validatePacket(data);
    if (!validation.valid) {
      console.warn('[GameSocket] Invalid packet:', validation.error);
      return;
    }

    try {
      const parsed = parsePacket(data);
      const { packet } = parsed;

      // Handle pong responses for latency calculation
      if (packet.opcode === OpCode.PONG) {
        const sentTime = this.pendingPings.get(packet.sequence);
        if (sentTime) {
          const latency = Date.now() - sentTime;
          useGameStore.getState().setLatency(latency);
          this.pendingPings.delete(packet.sequence);
        }
        return;
      }

      // Handle server hello ack
      if (packet.opcode === OpCode.HELLO_ACK) {
        console.log('[GameSocket] Hello acknowledged');
        // Send auth response after hello ack
        this.sendAuthResponse();
        return;
      }

      // Dispatch to registered handlers
      const handlers = this.handlers.get(packet.opcode);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(packet as ServerPacket);
          } catch (error) {
            console.error(`[GameSocket] Handler error for opcode ${packet.opcode}:`, error);
          }
        });
      }

      // Also dispatch to wildcard handlers
      const wildcardHandlers = this.handlers.get(OpCode.ERROR as unknown as OpCode);
      if (wildcardHandlers && packet.opcode !== OpCode.ERROR) {
        wildcardHandlers.forEach((handler) => {
          try {
            handler(packet as ServerPacket);
          } catch (error) {
            console.error('[GameSocket] Wildcard handler error:', error);
          }
        });
      }
    } catch (error) {
      console.error('[GameSocket] Failed to parse packet:', error);
    }
  }

  private async sendAuthResponse(): Promise<void> {
    const { accessToken, selectedCharacter } = useAuthStore.getState();
    if (accessToken && selectedCharacter) {
      // The token itself is the response for the challenge
      this.send(this.packetBuilder.buildAuthResponse(selectedCharacter.id, accessToken));
    }
  }

  // Send a packet (queued if not connected)
  send(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(data);
          resolve();
        } catch (error) {
          reject(error);
        }
      } else {
        this.packetQueue.push({ data, resolve, reject });
      }
    });
  }

  // Send player movement
  sendPlayerMove(
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    rotation: number,
    inputFlags: number
  ): Promise<void> {
    return this.send(
      this.packetBuilder.buildPlayerMove(position, velocity, rotation, inputFlags)
    );
  }

  // Send chat message
  sendChatMessage(channel: number, message: string, targetId?: string): Promise<void> {
    return this.send(this.packetBuilder.buildChatMessage(channel, message, targetId));
  }

  // Send ping for latency measurement
  sendPing(): void {
    const sequence = this.nextSequence();
    this.pendingPings.set(sequence, Date.now());
    this.send(this.packetBuilder.buildPing());
  }

  // Register packet handler for specific opcode
  on(opcode: OpCode, handler: PacketHandler): () => void {
    if (!this.handlers.has(opcode)) {
      this.handlers.set(opcode, new Set());
    }
    this.handlers.get(opcode)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(opcode)?.delete(handler);
    };
  }

  // Register handler for all packets
  onAny(handler: PacketHandler): () => void {
    return this.on(OpCode.ERROR as unknown as OpCode, handler);
  }

  // Connection state handlers
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  private notifyConnectionChange(connected: boolean): void {
    useGameStore.getState().setConnected(connected);
    this.connectionHandlers.forEach((handler) => {
      try {
        handler(connected);
      } catch (error) {
        console.error('[GameSocket] Connection handler error:', error);
      }
    });
  }

  private notifyError(error: Error): void {
    this.errorHandlers.forEach((handler) => {
      try {
        handler(error);
      } catch (e) {
        console.error('[GameSocket] Error handler error:', e);
      }
    });
  }

  private flushQueue(): void {
    while (this.packetQueue.length > 0) {
      const { data, resolve, reject } = this.packetQueue.shift()!;
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(data);
          resolve();
        } catch (error) {
          reject(error);
        }
      } else {
        // Put back if connection lost
        this.packetQueue.unshift({ data, resolve, reject });
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[GameSocket] Max reconnect attempts reached');
      this.notifyError(new Error('Max reconnect attempts reached'));
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;

    console.log(`[GameSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect(this.url).catch(() => {
          // Reconnect will be scheduled again in onclose
        });
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.sendPing();
      }
    }, 5000); // Ping every 5 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.pendingPings.clear();
  }

  private nextSequence(): number {
    this.sequence = (this.sequence + 1) % 0xffffffff;
    return this.sequence;
  }

  // Disconnect cleanly
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.packetQueue.forEach(({ reject }) => {
      reject(new Error('Disconnected'));
    });
    this.packetQueue = [];
    this.handlers.clear();
    this.connectionHandlers.clear();
    this.errorHandlers.clear();
  }

  // Get connection state
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const gameSocket = GameSocket.getInstance();
export default gameSocket;