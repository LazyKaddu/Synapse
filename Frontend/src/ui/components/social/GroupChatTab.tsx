import React, { useState, useRef, useEffect } from 'react';
import { useSocialStore, type GroupDto, type ChatMessageDto } from '../../../store/socialStore.ts';
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

export const GroupChatTab: React.FC = () => {
  const groups = useSocialStore((state) => state.groups);
  const selectedGroupId = useSocialStore((state) => state.selectedGroupId);
  const selectGroup = useSocialStore((state) => state.selectGroup);
  const groupMessages = useSocialStore((state) => state.groupMessages);
  const unreadGroups = useSocialStore((state) => state.unreadGroups);
  const sendGroupMessage = useSocialStore((state) => state.sendGroupMessage);
  const createGroup = useSocialStore((state) => state.createGroup);
  const inviteToGroup = useSocialStore((state) => state.inviteToGroup);
  const friends = useSocialStore((state) => state.friends);

  const authUser = useAuthStore((state) => state.selectedCharacter?.id || state.accountId || 'p-player-self');
  const [inputText, setInputText] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedInitialFriends, setSelectedInitialFriends] = useState<string[]>([]);
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);
  const [selectedInviteFriendId, setSelectedInviteFriendId] = useState('');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeGroup: GroupDto | null =
    groups.find((g) => g.id === selectedGroupId) || groups[0] || null;

  const activeMessages: ChatMessageDto[] = activeGroup
    ? groupMessages[activeGroup.id] || []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activeGroup?.id]);

  const handleSend = () => {
    if (!activeGroup || !inputText.trim()) return;
    sendGroupMessage(activeGroup.id, inputText.trim());
    setInputText('');
  };

  const handleCreateGroupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    createGroup(newGroupName.trim(), selectedInitialFriends);
    setNewGroupName('');
    setSelectedInitialFriends([]);
    setShowCreateModal(false);
  };

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !selectedInviteFriendId) return;
    inviteToGroup(activeGroup.id, selectedInviteFriendId);
    setSelectedInviteFriendId('');
  };

  // Friends not yet in this group
  const unjoinedFriends = activeGroup
    ? friends.filter((f) => !activeGroup.members.some((m) => m.user_id === f.user_id))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Top Group Selection & Create Action Strip */}
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
        <button
          type="button"
          onClick={() => setShowCreateModal((prev) => !prev)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
            borderRadius: 20,
            border: '1px dashed #38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.1)',
            color: '#38bdf8',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <span>+ Create Group</span>
        </button>

        {groups.map((group) => {
          const isSelected = activeGroup?.id === group.id;
          const unread = unreadGroups[group.id] || 0;

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => {
                selectGroup(group.id);
                setShowMembersDrawer(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 20,
                border: isSelected
                  ? '1px solid #a855f7'
                  : '1px solid rgba(255, 255, 255, 0.12)',
                backgroundColor: isSelected
                  ? 'rgba(168, 85, 247, 0.2)'
                  : 'rgba(255, 255, 255, 0.05)',
                color: isSelected ? '#d8b4fe' : '#e2e8f0',
                fontSize: 12,
                fontWeight: isSelected ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
            >
              <span># {group.name}</span>
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
        })}
      </div>

      {/* Inline Create Group Form */}
      {showCreateModal && (
        <form
          onSubmit={handleCreateGroupSubmit}
          style={{
            padding: '12px 14px',
            backgroundColor: 'rgba(30, 27, 75, 0.85)',
            borderBottom: '1px solid rgba(168, 85, 247, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#f3e8ff' }}>
              Create New Party / Group
            </span>
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Group Name (e.g. Dungeon Squad)"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#f8fafc',
              fontSize: 12,
              outline: 'none',
            }}
          />

          {friends.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#c084fc' }}>Add Friends:</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 80, overflowY: 'auto' }}>
                {friends.map((f) => {
                  const isChecked = selectedInitialFriends.includes(f.user_id);
                  return (
                    <label
                      key={f.user_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        color: '#e2e8f0',
                        cursor: 'pointer',
                        background: isChecked ? 'rgba(168, 85, 247, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setSelectedInitialFriends((prev) =>
                            isChecked
                              ? prev.filter((id) => id !== f.user_id)
                              : [...prev, f.user_id]
                          );
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      <span>{f.username.split(' [')[0]}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={!newGroupName.trim()}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              backgroundColor: newGroupName.trim() ? '#9333ea' : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: newGroupName.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Create
          </button>
        </form>
      )}

      {activeGroup ? (
        <>
          {/* Active Group Header with Member List Toggle */}
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
              <span style={{ fontSize: 13, fontWeight: 700, color: '#e9d5ff' }}>
                # {activeGroup.name}
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                ({activeGroup.members.length} members)
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowMembersDrawer((prev) => !prev)}
              style={{
                background: showMembersDrawer ? 'rgba(168, 85, 247, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 4,
                padding: '3px 8px',
                color: '#e2e8f0',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {showMembersDrawer ? 'Hide Members' : 'View Members'}
            </button>
          </div>

          {/* Members List Drawer */}
          {showMembersDrawer && (
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
                Group Members
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 110, overflowY: 'auto' }}>
                {activeGroup.members.map((member) => (
                  <div
                    key={member.user_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      color: '#e2e8f0',
                      padding: '2px 0',
                    }}
                  >
                    <span>{member.username}</span>
                    {member.is_owner && (
                      <span
                        style={{
                          fontSize: 10,
                          backgroundColor: 'rgba(245, 158, 11, 0.2)',
                          color: '#fbbf24',
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontWeight: 600,
                        }}
                      >
                        Leader
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Invite Friend Selector */}
              {unjoinedFriends.length > 0 && (
                <form
                  onSubmit={handleInviteSubmit}
                  style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}
                >
                  <select
                    value={selectedInviteFriendId}
                    onChange={(e) => setSelectedInviteFriendId(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      borderRadius: 6,
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#f8fafc',
                      fontSize: 11,
                      outline: 'none',
                    }}
                  >
                    <option value="">+ Select friend to invite...</option>
                    {unjoinedFriends.map((f) => (
                      <option key={f.user_id} value={f.user_id}>
                        {f.username}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={!selectedInviteFriendId}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      backgroundColor: selectedInviteFriendId ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: selectedInviteFriendId ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Invite
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Group Message Stream */}
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
            {activeMessages.length === 0 ? (
              <div
                style={{
                  margin: 'auto',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: 12,
                }}
              >
                No group messages yet. Start the conversation!
              </div>
            ) : (
              activeMessages.map((msg) => {
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
                          color: isMe ? '#93c5fd' : '#c084fc',
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

          {/* Group Message Input Bar */}
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
              placeholder={`Message #${activeGroup.name}...`}
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
                backgroundColor: inputText.trim() ? '#9333ea' : 'rgba(255, 255, 255, 0.08)',
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
          No groups available. Create one to start group chatting!
        </div>
      )}
    </div>
  );
};
