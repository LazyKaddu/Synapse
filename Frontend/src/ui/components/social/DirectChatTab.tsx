import React, { useState, useRef, useEffect } from 'react';
import { useSocialStore, type ChatMessageDto } from '../../../store/socialStore.ts';
import { useAuthStore } from '../../../store/authStore.ts';

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const DirectChatTab: React.FC = () => {
  const friends = useSocialStore((state) => state.friends);
  const selectedFriendId = useSocialStore((state) => state.selectedFriendId);
  const selectFriend = useSocialStore((state) => state.selectFriend);
  const directMessages = useSocialStore((state) => state.directMessages);
  const unreadDirect = useSocialStore((state) => state.unreadDirect);
  const sendDirectMessage = useSocialStore((state) => state.sendDirectMessage);

  const authUser = useAuthStore((state) => state.selectedCharacter?.id || state.accountId || 'p-player-self');
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedFriend = friends.find((f) => f.user_id === selectedFriendId) || friends[0] || null;

  // Auto-scroll to bottom of conversation
  const activeConversation: ChatMessageDto[] = selectedFriend
    ? directMessages[selectedFriend.user_id] || []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation.length, selectedFriend?.user_id]);

  const handleSend = () => {
    if (!selectedFriend || !inputText.trim()) return;
    sendDirectMessage(selectedFriend.user_id, inputText.trim());
    setInputText('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Horizontal Friends Bar */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 12px',
          overflowX: 'auto',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
          scrollbarWidth: 'none',
          minHeight: 52,
          alignItems: 'center',
        }}
      >
        {friends.length === 0 ? (
          <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', padding: '4px 6px' }}>
            No friends online. Use "Add Friend" tab to connect!
          </div>
        ) : (
          friends.map((friend) => {
            const isSelected = selectedFriend?.user_id === friend.user_id;
            const unread = unreadDirect[friend.user_id] || 0;
            const displayName = friend.username.replace(/ \[ID: .*\]/, '');

            return (
              <button
                key={friend.user_id}
                type="button"
                onClick={() => selectFriend(friend.user_id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 20,
                  border: isSelected
                    ? '1px solid #38bdf8'
                    : '1px solid rgba(255, 255, 255, 0.12)',
                  backgroundColor: isSelected
                    ? 'rgba(56, 189, 248, 0.2)'
                    : 'rgba(255, 255, 255, 0.05)',
                  color: isSelected ? '#38bdf8' : '#e2e8f0',
                  fontSize: 12,
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
              >
                {/* Status Dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: friend.is_online ? '#10b981' : '#64748b',
                    boxShadow: friend.is_online ? '0 0 6px #10b981' : 'none',
                  }}
                />
                <span>{displayName}</span>

                {/* Unread Pill */}
                {unread > 0 && (
                  <span
                    style={{
                      background: '#ef4444',
                      color: '#ffffff',
                      fontSize: 10,
                      fontWeight: 700,
                      borderRadius: 10,
                      padding: '1px 5px',
                      minWidth: 16,
                      textAlign: 'center',
                    }}
                  >
                    {unread}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {selectedFriend ? (
        <>
          {/* Header of Active Friend Chat */}
          <div
            style={{
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: selectedFriend.is_online ? '#10b981' : '#64748b',
                  boxShadow: selectedFriend.is_online ? '0 0 8px #10b981' : 'none',
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                {selectedFriend.username}
              </span>
            </div>
            <span
              style={{
                fontSize: 11,
                color: selectedFriend.is_online ? '#10b981' : '#94a3b8',
                fontWeight: 500,
              }}
            >
              {selectedFriend.is_online ? 'Online' : 'Offline'}
            </span>
          </div>

          {/* Conversation Bubble Stream */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {activeConversation.length === 0 ? (
              <div
                style={{
                  margin: 'auto',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: 12,
                }}
              >
                No messages yet. Send a greeting to start the conversation!
              </div>
            ) : (
              activeConversation.map((msg) => {
                const isMe = msg.sender_id === authUser || msg.sender_id === 'current_user';
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMe ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      alignSelf: isMe ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 6,
                        marginBottom: 2,
                        padding: '0 4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: isMe ? '#93c5fd' : '#94a3b8',
                        }}
                      >
                        {isMe ? 'You' : msg.sender_name}
                      </span>
                      <span style={{ fontSize: 9, color: '#64748b' }}>
                        {formatTime(msg.created_at)}
                      </span>
                    </div>

                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: 12,
                        borderBottomRightRadius: isMe ? 2 : 12,
                        borderBottomLeftRadius: isMe ? 12 : 2,
                        backgroundColor: isMe ? '#2563eb' : '#334155',
                        color: '#f8fafc',
                        fontSize: 13,
                        lineHeight: 1.4,
                        wordBreak: 'break-word',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input Bar */}
          <div
            style={{
              padding: '10px 12px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={`Message ${selectedFriend.username.split(' [')[0]}...`}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 8,
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#f8fafc',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputText.trim()}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                backgroundColor: inputText.trim() ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                color: inputText.trim() ? '#ffffff' : '#64748b',
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: inputText.trim() ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s ease',
              }}
            >
              Send
            </button>
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            fontSize: 13,
            padding: 20,
            textAlign: 'center',
          }}
        >
          Select or add a friend to start chatting.
        </div>
      )}
    </div>
  );
};
