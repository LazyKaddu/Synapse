// GameSocket client managing WebSocket connection, binary stream, and social frames

import { BinaryOpCode, type ServerBinaryPacket, type SocialMessage } from './opcodes.ts';
import { encodeClientMovement, encodeClientAction, decodeServerBinaryPacket } from './binary.ts';

export type BinaryPacketCallback = (packet: ServerBinaryPacket) => void;
export type SocialPacketCallback = (message: SocialMessage) => void;
export type ConnectionCallback = (connected: boolean) => void;

export class GameSocketClient {
  private ws: WebSocket | null = null;
  private binaryListeners: Set<BinaryPacketCallback> = new Set();
  private socialListeners: Set<SocialPacketCallback> = new Set();
  private connectionListeners: Set<ConnectionCallback> = new Set();

  connect(wsUrl: string, ticket: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const fullUrl = `${wsUrl}?ticket=${encodeURIComponent(ticket)}`;
        const socket = new WebSocket(fullUrl);
        socket.binaryType = 'arraybuffer';

        socket.onopen = () => {
          this.ws = socket;
          this.notifyConnection(true);
          resolve();
        };

        socket.onerror = (err) => {
          reject(err);
        };

        socket.onclose = () => {
          this.ws = null;
          this.notifyConnection(false);
        };

        socket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            const decoded = decodeServerBinaryPacket(event.data);
            if (decoded) {
              for (const listener of this.binaryListeners) {
                listener(decoded);
              }
            }
          } else if (typeof event.data === 'string') {
            try {
              const social = JSON.parse(event.data) as SocialMessage;
              for (const listener of this.socialListeners) {
                listener(social);
              }
            } catch (err) {
              console.error('Failed to parse social JSON frame:', err);
            }
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  sendMovement(posX: number, posY: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const packet = encodeClientMovement(posX, posY);
      this.ws.send(packet);
    }
  }

  sendAction(actionId: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const packet = encodeClientAction(actionId);
      this.ws.send(packet);
    }
  }

  sendChatMessage(channel: string, sender: string, content: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg: SocialMessage = {
        type: 'CHAT_MSG',
        channel,
        sender,
        content,
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  onBinary(callback: BinaryPacketCallback): () => void {
    this.binaryListeners.add(callback);
    return () => this.binaryListeners.delete(callback);
  }

  onSocial(callback: SocialPacketCallback): () => void {
    this.socialListeners.add(callback);
    return () => this.socialListeners.delete(callback);
  }

  onConnection(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback);
    return () => this.connectionListeners.delete(callback);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.binaryListeners.clear();
    this.socialListeners.clear();
    this.connectionListeners.clear();
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
