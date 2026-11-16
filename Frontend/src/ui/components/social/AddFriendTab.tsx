import React, { useState } from 'react';
import { useSocialStore } from '../../../store/socialStore.ts';
import { useAuthStore } from '../../../store/authStore.ts';

export const AddFriendTab: React.FC = () => {
  const pendingIncoming = useSocialStore((state) => state.pendingIncoming);
  const pendingOutgoing = useSocialStore((state) => state.pendingOutgoing);
  const sendFriendRequest = useSocialStore((state) => state.sendFriendRequest);
  const acceptFriendRequest = useSocialStore((state) => state.acceptFriendRequest);
  const declineFriendRequest = useSocialStore((state) => state.declineFriendRequest);

  const authUser = useAuthStore(
    (state) =>
      state.selectedCharacter?.id || state.accountId || 'p-hero-777'
  );
  const authName = useAuthStore(
    (state) =>
      state.selectedCharacter?.name || state.username || 'Adventurer'
  );

  const [targetId, setTargetId] = useState('');
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleCopyId = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(authUser);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = targetId.trim();
    if (!trimmed) return;
    if (trimmed === authUser) {
      setFeedback('You cannot send a friend request to yourself.');
      return;
    }

    sendFriendRequest(trimmed);
    setTargetId('');
    setFeedback(`Friend request sent to ${trimmed}!`);
    setTimeout(() => setFeedback(null), 3000);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        padding: '14px 16px',
        gap: 16,
      }}
    >
      {/* "My ID" Card */}
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 8,
          backgroundColor: 'rgba(30, 41, 59, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>
            My Player Identity
          </span>
          <span style={{ fontSize: 11, color: '#38bdf8' }}>{authName}</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f1f5f9' }}>
            {authUser}
          </span>
          <button
            type="button"
            onClick={handleCopyId}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              backgroundColor: copied ? '#10b981' : 'rgba(56, 189, 248, 0.2)',
              color: copied ? '#ffffff' : '#38bdf8',
              border: copied ? 'none' : '1px solid rgba(56, 189, 248, 0.4)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {copied ? 'Copied!' : 'Copy My ID'}
          </button>
        </div>
      </div>

      {/* Send Friend Request Box */}
      <form
        onSubmit={handleSend}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <label style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>
          Add Friend by Player ID
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="e.g. p-kaelen-202"
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 6,
              backgroundColor: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              color: '#f8fafc',
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!targetId.trim()}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              backgroundColor: targetId.trim() ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
              color: targetId.trim() ? '#ffffff' : '#64748b',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: targetId.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Send Request
          </button>
        </div>
        {feedback && (
          <div style={{ fontSize: 11, color: '#38bdf8', fontStyle: 'italic' }}>
            {feedback}
          </div>
        )}
      </form>

      {/* Incoming Requests Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>
            Incoming Requests
          </span>
          {pendingIncoming.length > 0 && (
            <span
              style={{
                fontSize: 10,
                backgroundColor: '#3b82f6',
                color: '#ffffff',
                padding: '1px 6px',
                borderRadius: 10,
                fontWeight: 700,
              }}
            >
              {pendingIncoming.length}
            </span>
          )}
        </div>

        {pendingIncoming.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '4px 0' }}>
            No incoming friend requests.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingIncoming.map((req) => (
              <div
                key={req.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                    {req.from_user_name}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    ID: {req.from_user_id}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => acceptFriendRequest(req.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      backgroundColor: '#16a34a',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => declineFriendRequest(req.id)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 4,
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outgoing Requests Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>
          Outgoing Requests
        </span>

        {pendingOutgoing.length === 0 ? (
          <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '4px 0' }}>
            No outgoing requests pending.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingOutgoing.map((req) => (
              <div
                key={req.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 12, color: '#cbd5e1' }}>
                    Sent to: {req.to_user_id}
                  </span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>
                    Status: {req.status}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  Pending
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
