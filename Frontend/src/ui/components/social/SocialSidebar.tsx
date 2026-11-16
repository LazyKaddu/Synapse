import React, { useMemo } from 'react';
import { useSocialStore } from '../../../store/socialStore.ts';
import { DirectChatTab } from './DirectChatTab.tsx';
import { GroupChatTab } from './GroupChatTab.tsx';
import { AddFriendTab } from './AddFriendTab.tsx';

export const SocialSidebar: React.FC = () => {
  const isOpen = useSocialStore((state) => state.isOpen);
  const toggleSidebar = useSocialStore((state) => state.toggleSidebar);
  const activeTab = useSocialStore((state) => state.activeTab);
  const setActiveTab = useSocialStore((state) => state.setActiveTab);
  const unreadDirect = useSocialStore((state) => state.unreadDirect);
  const unreadGroups = useSocialStore((state) => state.unreadGroups);
  const pendingIncoming = useSocialStore((state) => state.pendingIncoming);

  // Badge calculations
  const directUnreadCount = useMemo(() => {
    return Object.values(unreadDirect).reduce((sum: number, count: number) => sum + count, 0);
  }, [unreadDirect]);

  const groupUnreadCount = useMemo(() => {
    return Object.values(unreadGroups).reduce((sum: number, count: number) => sum + count, 0);
  }, [unreadGroups]);

  const incomingRequestCount = pendingIncoming.length;

  const totalUnreadBadge = directUnreadCount + groupUnreadCount + incomingRequestCount;

  return (
    <>
      {/* Floating Toggle Pill Button on the Right Edge */}
      <button
        type="button"
        onClick={toggleSidebar}
        title="Toggle Social Chat & Friends (Enter / Tab)"
        style={{
          position: 'fixed',
          right: isOpen ? 368 : 16,
          top: 20,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderRadius: 24,
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
          color: '#f8fafc',
          cursor: 'pointer',
          transition: 'right 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.15s ease',
          pointerEvents: 'auto',
        }}
      >
        {/* Chat Bubble Icon */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: '#38bdf8' }}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>

        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>
          {isOpen ? 'Close Social' : 'Social'}
        </span>

        {/* Hotkey hint */}
        <kbd
          style={{
            fontSize: 10,
            fontFamily: 'monospace',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 4,
            padding: '1px 5px',
            color: '#94a3b8',
          }}
        >
          Tab
        </kbd>

        {/* Total Unread Notification Badge */}
        {!isOpen && totalUnreadBadge > 0 && (
          <span
            style={{
              backgroundColor: '#ef4444',
              color: '#ffffff',
              fontSize: 10,
              fontWeight: 700,
              borderRadius: 12,
              padding: '2px 6px',
              minWidth: 18,
              textAlign: 'center',
              boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
            }}
          >
            {totalUnreadBadge}
          </span>
        )}
      </button>

      {/* Right-docked Sliding Drawer (360px wide) */}
      <aside
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 360,
          maxWidth: '90vw',
          zIndex: 9998,
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.45)',
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
          pointerEvents: isOpen ? 'auto' : 'none',
          userSelect: 'none',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '14px 16px 10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: '#38bdf8',
                boxShadow: '0 0 8px #38bdf8',
              }}
            />
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: '#f8fafc',
                letterSpacing: '0.03em',
              }}
            >
              Synapse Social & Chat
            </h2>
          </div>

          <button
            type="button"
            onClick={toggleSidebar}
            title="Close Drawer"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              borderRadius: 6,
              color: '#94a3b8',
              padding: '4px 8px',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            ✕
          </button>
        </div>

        {/* 3-Tab Bar: [1] Chat Individual [2] Groups [3] Add Friend */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            padding: '6px 12px',
            gap: 6,
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
          }}
        >
          {/* Tab 1: Direct Chat */}
          <button
            type="button"
            onClick={() => setActiveTab('direct')}
            style={{
              padding: '8px 4px',
              borderRadius: 6,
              border: activeTab === 'direct'
                ? '1px solid #38bdf8'
                : '1px solid transparent',
              backgroundColor: activeTab === 'direct'
                ? 'rgba(56, 189, 248, 0.15)'
                : 'transparent',
              color: activeTab === 'direct' ? '#38bdf8' : '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
            }}
          >
            <span>Direct</span>
            {directUnreadCount > 0 && (
              <span
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  fontSize: 9,
                  fontWeight: 700,
                  borderRadius: 10,
                  padding: '1px 4px',
                  minWidth: 14,
                  textAlign: 'center',
                }}
              >
                {directUnreadCount}
              </span>
            )}
          </button>

          {/* Tab 2: Groups */}
          <button
            type="button"
            onClick={() => setActiveTab('groups')}
            style={{
              padding: '8px 4px',
              borderRadius: 6,
              border: activeTab === 'groups'
                ? '1px solid #c084fc'
                : '1px solid transparent',
              backgroundColor: activeTab === 'groups'
                ? 'rgba(192, 132, 252, 0.15)'
                : 'transparent',
              color: activeTab === 'groups' ? '#c084fc' : '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
            }}
          >
            <span>Groups</span>
            {groupUnreadCount > 0 && (
              <span
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  fontSize: 9,
                  fontWeight: 700,
                  borderRadius: 10,
                  padding: '1px 4px',
                  minWidth: 14,
                  textAlign: 'center',
                }}
              >
                {groupUnreadCount}
              </span>
            )}
          </button>

          {/* Tab 3: Add Friend */}
          <button
            type="button"
            onClick={() => setActiveTab('add_friend')}
            style={{
              padding: '8px 4px',
              borderRadius: 6,
              border: activeTab === 'add_friend'
                ? '1px solid #4ade80'
                : '1px solid transparent',
              backgroundColor: activeTab === 'add_friend'
                ? 'rgba(74, 222, 128, 0.15)'
                : 'transparent',
              color: activeTab === 'add_friend' ? '#4ade80' : '#94a3b8',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              transition: 'all 0.15s ease',
            }}
          >
            <span>Add Friend</span>
            {incomingRequestCount > 0 && (
              <span
                style={{
                  background: '#3b82f6',
                  color: '#ffffff',
                  fontSize: 9,
                  fontWeight: 700,
                  borderRadius: 10,
                  padding: '1px 4px',
                  minWidth: 14,
                  textAlign: 'center',
                }}
              >
                {incomingRequestCount}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content Body */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {activeTab === 'direct' && <DirectChatTab />}
          {activeTab === 'groups' && <GroupChatTab />}
          {activeTab === 'add_friend' && <AddFriendTab />}
        </div>
      </aside>
    </>
  );
};
