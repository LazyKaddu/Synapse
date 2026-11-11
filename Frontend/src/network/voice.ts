// LiveKit WebRTC room connection handlers for voice chat

import { Room, RoomEvent, RemoteParticipant, LocalParticipant, Track, TrackPublication, ConnectionState } from 'livekit-client';
import { gameSocket } from './socket';
import { OpCode, VoiceJoinPacket, VoiceSpeakingPacket } from './opcodes';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';

interface VoiceConfig {
  url: string;
  token: string;
  roomName: string;
}

interface ParticipantVoiceState {
  participantId: string;
  identity: string;
  speaking: boolean;
  volume: number;
  audioLevel: number;
}

class VoiceManager {
  private room: Room | null = null;
  private config: VoiceConfig | null = null;
  private localParticipant: LocalParticipant | null = null;
  private participantStates: Map<string, ParticipantVoiceState> = new Map();
  private isConnecting = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private volumeCheckInterval: ReturnType<typeof setInterval> | null = null;
  private handlers: Map<string, Set<Function>> = new Map();

  // Event types
  static readonly EVENTS = {
    CONNECTED: 'voice:connected',
    DISCONNECTED: 'voice:disconnected',
    PARTICIPANT_JOINED: 'voice:participant_joined',
    PARTICIPANT_LEFT: 'voice:participant_left',
    SPEAKING_CHANGE: 'voice:speaking_change',
    VOLUME_CHANGE: 'voice:volume_change',
    ERROR: 'voice:error',
    LOCAL_AUDIO_LEVEL: 'voice:local_audio_level',
  } as const;

  async connect(config: VoiceConfig): Promise<void> {
    if (this.isConnecting || (this.room && this.room.connectionState === ConnectionState.Connected)) {
      return;
    }

    this.config = config;
    this.isConnecting = true;

    try {
      // Request microphone permission
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
        video: false,
      });

      // Setup audio analysis for local volume detection
      this.setupAudioAnalysis();

      // Create LiveKit room
      this.room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      this.setupRoomListeners();

      // Connect to room
      await this.room.connect(config.url, config.token, {
        autoSubscribe: true,
      });

      this.localParticipant = this.room.localParticipant;
      this.isConnecting = false;

      this.emit(VoiceManager.EVENTS.CONNECTED, { room: this.room });

      // Notify server we joined voice
      this.notifyServerVoiceJoin(true);

      // Start volume monitoring
      this.startVolumeMonitoring();
    } catch (error) {
      this.isConnecting = false;
      this.emit(VoiceManager.EVENTS.ERROR, error);
      throw error;
    }
  }

  private setupAudioAnalysis(): void {
    if (!this.mediaStream) return;

    this.audioContext = new AudioContext({ sampleRate: 48000 });
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    source.connect(this.analyser);
  }

  private setupRoomListeners(): void {
    if (!this.room) return;

    // Connection state changes
    this.room.on(RoomEvent.ConnectionStateChanged, (state) => {
      if (state === ConnectionState.Disconnected) {
        this.handleDisconnect();
      }
    });

    // Participant events
    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      this.handleParticipantJoined(participant);
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.handleParticipantLeft(participant);
    });

    // Track events
    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      this.handleTrackSubscribed(track, participant);
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      this.handleTrackUnsubscribed(track, participant);
    });

    // Local track events
    this.room.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (publication.kind === Track.Kind.Audio) {
        console.log('[VoiceManager] Local audio published');
      }
    });
  }

  private handleParticipantJoined(participant: RemoteParticipant): void {
    const state: ParticipantVoiceState = {
      participantId: participant.sid || participant.identity,
      identity: participant.identity,
      speaking: false,
      volume: 0,
      audioLevel: 0,
    };
    this.participantStates.set(state.participantId, state);

    this.emit(VoiceManager.EVENTS.PARTICIPANT_JOINED, { participant, state });
  }

  private handleParticipantLeft(participant: RemoteParticipant): void {
    const participantId = participant.sid || participant.identity;
    this.participantStates.delete(participantId);

    this.emit(VoiceManager.EVENTS.PARTICIPANT_LEFT, { participantId, identity: participant.identity });
  }

  private handleTrackSubscribed(track: Track, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      const participantId = participant.sid || participant.identity;
      const state = this.participantStates.get(participantId);
      if (state) {
        // Attach audio element for playback
        const audioElement = track.attach();
        audioElement.volume = 1.0;
        document.body.appendChild(audioElement);
        audioElement.play().catch(console.error);
      }
    }
  }

  private handleTrackUnsubscribed(track: Track, participant: RemoteParticipant): void {
    if (track.kind === Track.Kind.Audio) {
      track.detach().forEach((element) => element.remove());
    }
  }

  private startVolumeMonitoring(): void {
    // Monitor local audio level
    this.volumeCheckInterval = setInterval(() => {
      if (this.analyser && this.localParticipant) {
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);
        
        // Calculate average volume (0-1)
        const sum = dataArray.reduce((acc, val) => acc + val, 0);
        const average = sum / dataArray.length;
        const normalizedVolume = Math.min(average / 128, 1);

        // Emit local audio level for UI visualization
        this.emit(VoiceManager.EVENTS.LOCAL_AUDIO_LEVEL, { volume: normalizedVolume });

        // Send speaking state to server if threshold crossed
        const speaking = normalizedVolume > 0.05;
        this.updateLocalSpeakingState(speaking, normalizedVolume);
      }

      // Update remote participant volumes from server events
      this.participantStates.forEach((state, id) => {
        if (id !== this.localParticipant?.sid) {
          this.emit(VoiceManager.EVENTS.VOLUME_CHANGE, {
            participantId: id,
            volume: state.volume,
            speaking: state.speaking,
          });
        }
      });
    }, 100); // 10 FPS for volume updates
  }

  private updateLocalSpeakingState(speaking: boolean, volume: number): void {
    const currentState = this.participantStates.get(this.localParticipant?.sid || '');
    if (currentState && currentState.speaking === speaking && Math.abs(currentState.volume - volume) < 0.05) {
      return; // No significant change
    }

    if (this.localParticipant) {
      const participantId = this.localParticipant.sid || this.localParticipant.identity;
      const state: ParticipantVoiceState = {
        participantId,
        identity: this.localParticipant.identity,
        speaking,
        volume,
        audioLevel: volume,
      };
      this.participantStates.set(participantId, state);

      // Notify server
      this.sendSpeakingState(speaking, volume);

      this.emit(VoiceManager.EVENTS.SPEAKING_CHANGE, { participantId, speaking, volume });
    }
  }

  private sendSpeakingState(speaking: boolean, volume: number): void {
    if (!gameSocket.isConnected) return;

    // Send via WebSocket binary protocol
    const packet = gameSocket.packetBuilder.buildVoiceSpeaking(
      this.localParticipant?.identity || '',
      speaking,
      volume
    );
    gameSocket.send(packet).catch(console.error);
  }

  private notifyServerVoiceJoin(joining: boolean): void {
    if (!gameSocket.isConnected || !this.config) return;

    const opcode = joining ? OpCode.VOICE_JOIN : OpCode.VOICE_LEAVE;
    // This would need a proper packet builder method
    console.log(`[VoiceManager] Notify server: voice ${joining ? 'join' : 'leave'}`);
  }

  // Handle incoming voice speaking packets from server
  handleServerVoiceSpeaking(packet: VoiceSpeakingPacket): void {
    const state = this.participantStates.get(packet.entityId);
    if (state) {
      state.speaking = packet.speaking;
      state.volume = packet.volume;
      state.audioLevel = packet.volume;

      this.emit(VoiceManager.EVENTS.SPEAKING_CHANGE, {
        participantId: packet.entityId,
        speaking: packet.speaking,
        volume: packet.volume,
      });
    }
  }

  // Handle incoming voice join packets from server
  handleServerVoiceJoin(packet: VoiceJoinPacket): void {
    // Server tells us to join a voice room
    if (this.config && packet.roomId !== this.config.roomName) {
      this.connect({
        url: packet.roomId, // This would be the LiveKit URL
        token: packet.token,
        roomName: packet.roomId,
      }).catch(console.error);
    }
  }

  // Toggle mute
  async setMuted(muted: boolean): Promise<void> {
    if (this.localParticipant) {
      const audioPub = this.localParticipant.getTrackPublication(Track.Kind.Audio);
      if (audioPub) {
        await audioPub.mute(muted);
      }
    }
  }

  isMuted(): boolean {
    const audioPub = this.localParticipant?.getTrackPublication(Track.Kind.Audio);
    return audioPub?.muted ?? false;
  }

  // Get all participant voice states
  getParticipantStates(): ParticipantVoiceState[] {
    return Array.from(this.participantStates.values());
  }

  // Get specific participant state
  getParticipantState(participantId: string): ParticipantVoiceState | undefined {
    return this.participantStates.get(participantId);
  }

  // Disconnect from voice
  async disconnect(): Promise<void> {
    this.stopVolumeMonitoring();

    if (this.room) {
      this.notifyServerVoiceJoin(false);
      await this.room.disconnect();
      this.room = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }

    this.participantStates.clear();
    this.localParticipant = null;
    this.config = null;

    this.emit(VoiceManager.EVENTS.DISCONNECTED, {});
  }

  private stopVolumeMonitoring(): void {
    if (this.volumeCheckInterval) {
      clearInterval(this.volumeCheckInterval);
      this.volumeCheckInterval = null;
    }
  }

  private handleDisconnect(): void {
    this.stopVolumeMonitoring();
    this.participantStates.clear();
    this.emit(VoiceManager.EVENTS.DISCONNECTED, {});
  }

  // Event emitter pattern
  on(event: string, handler: Function): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: Function): void {
    this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: unknown): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`[VoiceManager] Handler error for ${event}:`, error);
      }
    });
  }

  // Check if connected
  get connected(): boolean {
    return this.room?.connectionState === ConnectionState.Connected;
  }

  get connectionState(): ConnectionState {
    return this.room?.connectionState ?? ConnectionState.Disconnected;
  }
}

// Extend PacketBuilder for voice packets
declare module './binary' {
  interface PacketBuilder {
    buildVoiceSpeaking(entityId: string, speaking: boolean, volume: number): Uint8Array;
  }
}

// Add voice packet builder method
import { PacketBuilder } from './binary';

PacketBuilder.prototype.buildVoiceSpeaking = function(
  entityId: string,
  speaking: boolean,
  volume: number
): Uint8Array {
  const entityIdBytes = new TextEncoder().encode(entityId);
  const payload = new Uint8Array(2 + entityIdBytes.length + 1 + 4);
  let offset = 0;
  payload[offset++] = entityIdBytes.length;
  payload.set(entityIdBytes, offset);
  offset += entityIdBytes.length;
  payload[offset++] = speaking ? 1 : 0;
  const view = new DataView(payload.buffer, offset, 4);
  view.setFloat32(0, volume, true);

  const header = this.writeHeader(OpCode.VOICE_SPEAKING, payload.length);
  return this.concat([header, payload]);
};

// Export singleton
export const voiceManager = new VoiceManager();
export default voiceManager;

// Type extensions for LiveKit events
declare module 'livekit-client' {
  interface RoomEvent {
    'voice:speaking_change': [data: { participantId: string; speaking: boolean; volume: number }];
    'voice:volume_change': [data: { participantId: string; volume: number; speaking: boolean }];
    'voice:local_audio_level': [data: { volume: number }];
  }
}