// GameSocket client managing WebSocket connection, binary stream, and social frames

import { type ServerBinaryPacket, type SocialMessage } from './opcodes.ts';
import { encodeClientMovement, encodeClientAction, decodeServerBinaryPacket } from './binary.ts';
import { useSocialStore } from '../store/socialStore.ts';

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
              // Invoke socialStore directly
              useSocialStore.getState().handleSocialMessage(social);
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

  private notifyConnection(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(connected);
      } catch (err) {
        console.error('Connection listener error:', err);
      }
    }
  }

  sendMovement(posX: number, posY: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const packet = encodeClientMovement(posX, posY);
      this.ws.send(packet as unknown as BufferSource);
    }
  }

  sendAction(actionId: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const packet = encodeClientAction(actionId);
      this.ws.send(packet as unknown as BufferSource);
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

  sendSocialJson(message: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendFriendRequest(targetUserId: string): void {
    this.sendSocialJson({
      type: 'FRIEND_REQUEST_SEND',
      target_user_id: targetUserId,
    });
  }

  acceptFriendRequest(requestId: string): void {
    this.sendSocialJson({
      type: 'FRIEND_REQUEST_ACCEPT',
      request_id: requestId,
    });
  }

  declineFriendRequest(requestId: string): void {
    this.sendSocialJson({
      type: 'FRIEND_REQUEST_DECLINE',
      request_id: requestId,
    });
  }

  sendDirectMessage(recipientId: string, content: string): void {
    this.sendSocialJson({
      type: 'DIRECT_MSG_SEND',
      recipient_id: recipientId,
      content,
    });
  }

  sendGroupMessage(groupId: string, content: string): void {
    this.sendSocialJson({
      type: 'GROUP_MSG_SEND',
      group_id: groupId,
      content,
    });
  }

  createGroup(name: string, initialMembers: string[] = []): void {
    this.sendSocialJson({
      type: 'GROUP_CREATE',
      name,
      initial_members: initialMembers,
    });
  }

  inviteToGroup(groupId: string, targetUserId: string): void {
    this.sendSocialJson({
      type: 'GROUP_INVITE',
      group_id: groupId,
      target_user_id: targetUserId,
    });
  }

  fetchChatHistory(targetType: 'direct' | 'group', targetId: string, limit?: number): void {
    this.sendSocialJson({
      type: 'FETCH_CHAT_HISTORY',
      target_type: targetType,
      target_id: targetId,
      limit,
    });
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

export const gameSocket = new GameSocketClient();
