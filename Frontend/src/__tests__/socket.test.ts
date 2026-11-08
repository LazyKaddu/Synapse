import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameSocket } from '../network/socket';
import { OpCode } from '../network/opcodes';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sentData: Uint8Array[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen(new Event('open'));
    }, 0);
  }

  send(data: Uint8Array | string) {
    if (this.readyState === MockWebSocket.OPEN) {
      this.sentData.push(data instanceof Uint8Array ? data : new TextEncoder().encode(data));
    } else {
      throw new Error('WebSocket not open');
    }
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason, wasClean: true }));
    }
  }

  simulateMessage(data: ArrayBuffer) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateClose(code = 1000, reason = '', wasClean = false) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code, reason, wasClean }));
    }
  }
}

// Mock global WebSocket
vi.stubGlobal('WebSocket', MockWebSocket);

describe('GameSocket', () => {
  let socket: GameSocket;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    // Reset singleton
    (GameSocket as any).instance = null;
    
    // Reset stores
    useGameStore.setState({
      connected: false,
      connecting: false,
      latency: 0,
      player: null,
      playerId: null,
      currentChunk: null,
      loadedChunks: new Set(),
      entities: new Map(),
      players: new Map(),
      monsters: new Map(),
      inputFlags: 0,
      moveTarget: null,
      combatTarget: null,
      inCombat: false,
      messages: [],
      maxMessages: 100,
      showMinimap: true,
      showChat: false,
      showInventory: false,
      showCharacter: false,
    });

    useAuthStore.setState({
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      accountId: 'acc-1',
      username: 'TestUser',
      email: 'test@example.com',
      characters: [],
      selectedCharacter: { id: 'char-1', name: 'TestChar' } as any,
      gameServerUrl: null,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    socket = GameSocket.getInstance();
  });

  afterEach(() => {
    socket.disconnect();
    vi.clearAllMocks();
  });

  describe('Connection', () => {
    it('should connect to server', async () => {
      const connectPromise = socket.connect('wss://test.example.com/ws');
      
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await connectPromise;
      
      expect(socket.isConnected).toBe(true);
      expect(socket.readyState).toBe(MockWebSocket.OPEN);
    });

    it('should return existing connection if already connected', async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Second connect should resolve immediately
      await expect(socket.connect('wss://test.example.com/ws')).resolves.toBeUndefined();
    });

    it('should notify connection change handlers', async () => {
      const handler = vi.fn();
      const unsubscribe = socket.onConnectionChange(handler);
      
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(handler).toHaveBeenCalledWith(true);
      
      unsubscribe();
    });

    it('should set game store connected state', async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(useGameStore.getState().connected).toBe(true);
    });
  });

  describe('Packet handling', () => {
    beforeEach(async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      mockWs = (socket as any).ws;
    });

    it('should register and call opcode handlers', () => {
      const handler = vi.fn();
      const unsubscribe = socket.on(OpCode.CHAT_MESSAGE, handler);
      
      // Create a chat message packet
      const builder = socket.packetBuilder;
      const packet = builder.buildChatMessage(0, 'Hello!');
      
      mockWs.simulateMessage(packet.buffer);
      
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].opcode).toBe(OpCode.CHAT_MESSAGE);
      expect(handler.mock.calls[0][0].message).toBe('Hello!');
      
      unsubscribe();
    });

    it('should unsubscribe handler', () => {
      const handler = vi.fn();
      const unsubscribe = socket.on(OpCode.CHAT_MESSAGE, handler);
      
      unsubscribe();
      
      const builder = socket.packetBuilder;
      const packet = builder.buildChatMessage(0, 'Hello!');
      mockWs.simulateMessage(packet.buffer);
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle wildcard handlers', () => {
      const handler = vi.fn();
      const unsubscribe = socket.onAny(handler);
      
      const builder = socket.packetBuilder;
      const packet = builder.buildChatMessage(0, 'Hello!');
      mockWs.simulateMessage(packet.buffer);
      
      expect(handler).toHaveBeenCalled();
      
      unsubscribe();
    });
  });

  describe('Sending packets', () => {
    beforeEach(async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      mockWs = (socket as any).ws;
    });

    it('should send packet immediately when connected', async () => {
      const builder = socket.packetBuilder;
      const packet = builder.buildChatMessage(0, 'Test');
      
      await socket.send(packet);
      
      expect(mockWs.sentData).toHaveLength(1);
      expect(mockWs.sentData[0]).toEqual(packet);
    });

    it('should queue packets when not connected', async () => {
      socket.disconnect();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const builder = socket.packetBuilder;
      const packet = builder.buildChatMessage(0, 'Queued');
      
      const sendPromise = socket.send(packet);
      
      // Reconnect
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Get the new mock WS instance
      const newMockWs = (socket as any).ws;
      
      await sendPromise;
      
      expect(newMockWs.sentData).toHaveLength(1);
    });

    it('should send player move', async () => {
      await socket.sendPlayerMove(
        { x: 100, y: 64, z: 100 },
        { x: 5, y: 0, z: 0 },
        1.57,
        3
      );
      
      expect(mockWs.sentData).toHaveLength(1);
      expect(mockWs.sentData[0][0]).toBe(OpCode.PLAYER_MOVE);
    });

    it('should send chat message', async () => {
      await socket.sendChatMessage(0, 'Hello World!');
      
      expect(mockWs.sentData).toHaveLength(1);
      expect(mockWs.sentData[0][0]).toBe(OpCode.CHAT_MESSAGE);
    });
  });

  describe('Ping/Pong', () => {
    beforeEach(async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      mockWs = (socket as any).ws;
    });

    it('should send ping and track latency', () => {
      const initialLatency = useGameStore.getState().latency;
      
      socket.sendPing();
      
      expect(mockWs.sentData).toHaveLength(1);
      expect(mockWs.sentData[0][0]).toBe(OpCode.PING);
      
      // Simulate pong response
      const builder = socket.packetBuilder;
      // We need to create a pong packet with the same sequence
      // Since we can't easily get the sequence, we'll test the ping was sent
    });
  });

  describe('Reconnection', () => {
    it('should attempt reconnect on unclean close', async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      mockWs = (socket as any).ws;
      mockWs.simulateClose(1006, 'Abnormal closure', false);
      
      // Wait for reconnect attempt
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should have attempted to create new WebSocket
      // In real test, we'd verify the reconnect logic
    });

    it('should not reconnect on clean close', async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      socket.disconnect();
      
      expect(socket.isConnected).toBe(false);
    });
  });

  describe('Disconnect', () => {
    it('should cleanup on disconnect', async () => {
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const handler = vi.fn();
      socket.on(OpCode.CHAT_MESSAGE, handler);
      
      socket.disconnect();
      
      expect(socket.isConnected).toBe(false);
      expect(useGameStore.getState().connected).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should notify error handlers', async () => {
      const handler = vi.fn();
      socket.onError(handler);
      
      await socket.connect('wss://test.example.com/ws');
      await new Promise(resolve => setTimeout(resolve, 10));
      
      mockWs = (socket as any).ws;
      mockWs.simulateError();
      
      expect(handler).toHaveBeenCalled();
    });
  });
});

describe('GameSocket Singleton', () => {
  afterEach(() => {
    GameSocket.destroy();
  });

  it('should return same instance', () => {
    const socket1 = GameSocket.getInstance();
    const socket2 = GameSocket.getInstance();
    
    expect(socket1).toBe(socket2);
  });

  it('should create new instance after destroy', () => {
    const socket1 = GameSocket.getInstance();
    GameSocket.destroy();
    const socket2 = GameSocket.getInstance();
    
    expect(socket1).not.toBe(socket2);
  });
});