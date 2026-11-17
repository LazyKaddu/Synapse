import React, { useMemo } from 'react';
import { useSocialStore, type FriendDto } from '../../../store/socialStore.ts';
import { useGameStore } from '../../../store/gameStore.ts';
import { useTeleportStore } from '../../../store/teleportStore.ts';
import { TOKENS } from '../building-editor/theme.ts';
import { FriendsIcon, TeleportIcon } from './icons.tsx';

export interface FriendsTabProps {
  onTeleport: (worldX: number, worldY: number, label?: string) => void;
}

const DEMO_FRIEND_COORDS: Record<string, { x: number; y: number }> = {
  'p-aria-101': { x: 256, y: 192 },
  'p-rowan-303': { x: -128, y: 384 },
  'u-1': { x: 320, y: 640 },
  'u-3': { x: 512, y: -256 },
  'u-5': { x: 192, y: 128 },
};

export const FriendsTab: React.FC<FriendsTabProps> = ({ onTeleport }) => {
  const friends = useSocialStore((state) => state.friends);
  const players = useGameStore((state) => state.players);
  const showToast = useTeleportStore((state) => state.showToast);

  // Sort friends: online friends first, then alphabetically
  const sortedFriends = useMemo(() => {
    if (!friends || !Array.isArray(friends)) return [];
    return [...friends].sort((a, b) => {
      if (a.is_online === b.is_online) {
        return a.username.localeCompare(b.username);
      }
      return a.is_online ? -1 : 1;
    });
  }, [friends]);

  const handleFriendTeleport = (friend: FriendDto): void => {
    if (!friend.is_online) {
      showToast(`Cannot teleport to ${friend.username}: player is offline`, 'error');
      return;
    }

    const playerEntry = players.get(friend.user_id);
    const targetCoord = playerEntry?.position ?? DEMO_FRIEND_COORDS[friend.user_id] ?? { x: 256, y: 192 };

    onTeleport(targetCoord.x, targetCoord.y, friend.username);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          color: TOKENS.textSecondary,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <FriendsIcon size={14} />
          Friends Directory
        </span>
        <span style={{ color: TOKENS.textMuted }}>
          {friends.filter((f) => f.is_online).length} of {friends.length} online
        </span>
      </div>

      {sortedFriends.length === 0 ? (
        <div
          style={{
            backgroundColor: TOKENS.bgRaised,
            border: `1px solid ${TOKENS.hairline}`,
            borderRadius: 8,
            padding: 24,
            textAlign: 'center',
            color: TOKENS.textSecondary,
            fontSize: 13,
          }}
        >
          <FriendsIcon size={24} style={{ margin: '0 auto 8px auto', opacity: 0.6 }} />
          <div>No friends found in your social roster.</div>
          <div style={{ fontSize: 11, color: TOKENS.textMuted, marginTop: 4 }}>
            Press <kbd style={{ padding: '2px 4px', background: TOKENS.bgHover, borderRadius: 3 }}>Enter</kbd> to open Chat & add friends!
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedFriends.map((friend) => {
            const isOnline = friend.is_online === true;
            const playerEntry = players.get(friend.user_id);
            const coord = isOnline
              ? playerEntry?.position ?? DEMO_FRIEND_COORDS[friend.user_id] ?? { x: 256, y: 192 }
              : null;

            const tileX = coord ? Math.floor(coord.x / 64) : null;
            const tileY = coord ? Math.floor(coord.y / 64) : null;

            return (
              <div
                key={friend.user_id}
                style={{
                  backgroundColor: TOKENS.bgRaised,
                  border: `1px solid ${isOnline ? TOKENS.hairlineStrong : TOKENS.hairline}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  opacity: isOnline ? 1 : 0.65,
                  transition: `background-color 140ms ${TOKENS.ease}`,
                }}
              >
                {/* Friend Info & Online Status */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: isOnline ? TOKENS.positive : TOKENS.textMuted,
                        boxShadow: isOnline ? `0 0 6px ${TOKENS.positive}` : 'none',
                      }}
                      title={isOnline ? 'Online' : 'Offline'}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: TOKENS.textPrimary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {friend.username}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontWeight: 500,
                        backgroundColor: isOnline ? TOKENS.positiveSurface : TOKENS.bgHover,
                        color: isOnline ? TOKENS.positive : TOKENS.textMuted,
                        border: `1px solid ${isOnline ? 'rgba(76, 195, 138, 0.3)' : TOKENS.hairline}`,
                      }}
                    >
                      {isOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>

                  {/* Friend Active Coordinates */}
                  <div
                    style={{
                      fontSize: 11,
                      fontFamily: TOKENS.fontMono,
                      color: isOnline ? TOKENS.accent : TOKENS.textMuted,
                    }}
                  >
                    {isOnline && coord && tileX !== null && tileY !== null ? (
                      <span>
                        Tile ({tileX}, {tileY}) · World ({Math.round(coord.x)}, {Math.round(coord.y)}) px
                      </span>
                    ) : (
                      <span style={{ fontStyle: 'italic', fontFamily: TOKENS.fontSans }}>
                        Coordinates unavailable (Player offline)
                      </span>
                    )}
                  </div>
                </div>

                {/* 1-Click Teleport Button */}
                <button
                  type="button"
                  disabled={!isOnline}
                  onClick={() => handleFriendTeleport(friend)}
                  title={isOnline ? `Teleport directly to ${friend.username}` : 'Cannot teleport to offline friend'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 32,
                    padding: '0 12px',
                    borderRadius: 6,
                    border: `1px solid ${isOnline ? TOKENS.accentHairline : TOKENS.hairline}`,
                    backgroundColor: isOnline ? TOKENS.accentSurface : TOKENS.bgHover,
                    color: isOnline ? TOKENS.accent : TOKENS.textMuted,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isOnline ? 'pointer' : 'not-allowed',
                    flexShrink: 0,
                    transition: `all 140ms ${TOKENS.ease}`,
                  }}
                >
                  <TeleportIcon size={14} />
                  Teleport
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
