import { create } from 'zustand';
import { useAuthStore } from './authStore.ts';
import { gameSocket } from '../network/socket.ts';

export interface FriendDto {
  user_id: string;
  username: string;
  is_online: boolean;
}

export interface FriendRequestDto {
  id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  status: 'pending' | 'accepted' | 'declined' | string;
  created_at: string;
}

export interface GroupMemberDto {
  user_id: string;
  username: string;
  is_owner: boolean;
  joined_at: string;
}

export interface GroupDto {
  id: string;
  name: string;
  owner_id: string;
  members: GroupMemberDto[];
  created_at: string;
}

export interface ChatMessageDto {
  id: string;
  message_type: 'direct' | 'group' | string;
  sender_id: string;
  sender_name: string;
  recipient_id?: string | null;
  group_id?: string | null;
  content: string;
  created_at: string;
}

export type SocialTab = 'direct' | 'groups' | 'add_friend';

export interface SocialState {
  isOpen: boolean;
  activeTab: SocialTab;
  friends: FriendDto[];
  pendingIncoming: FriendRequestDto[];
  pendingOutgoing: FriendRequestDto[];
  groups: GroupDto[];
  selectedFriendId: string | null;
  selectedGroupId: string | null;
  directMessages: Record<string, ChatMessageDto[]>;
  groupMessages: Record<string, ChatMessageDto[]>;
  unreadDirect: Record<string, number>;
  unreadGroups: Record<string, number>;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveTab: (tab: SocialTab) => void;
  selectFriend: (friendId: string | null) => void;
  selectGroup: (groupId: string | null) => void;
  sendFriendRequest: (targetUserId: string) => void;
  acceptFriendRequest: (requestId: string) => void;
  declineFriendRequest: (requestId: string) => void;
  sendDirectMessage: (recipientId: string, content: string) => void;
  sendGroupMessage: (groupId: string, content: string) => void;
  createGroup: (name: string, initialMemberIds?: string[]) => void;
  inviteToGroup: (groupId: string, targetUserId: string) => void;
  loadChatHistory: (targetType: 'direct' | 'group', targetId: string) => void;
  handleSocialMessage: (msg: any) => void;
}

export const INITIAL_DEMO_FRIENDS: FriendDto[] = [
  {
    user_id: 'p-aria-101',
    username: 'Aria [ID: p-aria-101]',
    is_online: true,
  },
  {
    user_id: 'p-kaelen-202',
    username: 'Kaelen [ID: p-kaelen-202]',
    is_online: false,
  },
];

export const INITIAL_DEMO_INCOMING: FriendRequestDto[] = [
  {
    id: 'req-demo-1',
    from_user_id: 'p-zephyr-303',
    from_user_name: 'Zephyr [ID: p-zephyr-303]',
    to_user_id: 'current_user',
    status: 'pending',
    created_at: new Date(Date.now() - 3600000).toISOString(),
  },
];

export const INITIAL_DEMO_GROUPS: GroupDto[] = [
  {
    id: 'grp-demo-1',
    name: 'Raid Alpha',
    owner_id: 'p-aria-101',
    members: [
      {
        user_id: 'p-aria-101',
        username: 'Aria',
        is_owner: true,
        joined_at: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        user_id: 'p-kaelen-202',
        username: 'Kaelen',
        is_owner: false,
        joined_at: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
    created_at: new Date(Date.now() - 86400000).toISOString(),
  },
];

export const INITIAL_DEMO_DIRECT_MESSAGES: Record<string, ChatMessageDto[]> = {
  'p-aria-101': [
    {
      id: 'demo-msg-1',
      message_type: 'direct',
      sender_id: 'p-aria-101',
      sender_name: 'Aria',
      recipient_id: 'current_user',
      content: 'Hey traveler! Ready to explore the ancient ruins?',
      created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    },
    {
      id: 'demo-msg-2',
      message_type: 'direct',
      sender_id: 'current_user',
      sender_name: 'You',
      recipient_id: 'p-aria-101',
      content: 'Just stocking up on potions at the plaza.',
      created_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    },
    {
      id: 'demo-msg-3',
      message_type: 'direct',
      sender_id: 'p-aria-101',
      sender_name: 'Aria',
      recipient_id: 'current_user',
      content: 'Awesome, meet me near the western gate when ready!',
      created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    },
  ],
};

export const INITIAL_DEMO_GROUP_MESSAGES: Record<string, ChatMessageDto[]> = {
  'grp-demo-1': [
    {
      id: 'demo-gmsg-1',
      message_type: 'group',
      sender_id: 'p-aria-101',
      sender_name: 'Aria',
      group_id: 'grp-demo-1',
      content: 'Welcome to Raid Alpha! Let\'s coordinate our strategy before departing.',
      created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    },
    {
      id: 'demo-gmsg-2',
      message_type: 'group',
      sender_id: 'p-kaelen-202',
      sender_name: 'Kaelen',
      group_id: 'grp-demo-1',
      content: 'I brought extra armor kits for the team.',
      created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
  ],
};

function getCurrentUser(): { id: string; name: string } {
  try {
    const auth = useAuthStore.getState();
    const id = auth.selectedCharacter?.id || auth.accountId || 'p-player-self';
    const name = auth.selectedCharacter?.name || auth.username || 'You';
    return { id, name };
  } catch {
    return { id: 'p-player-self', name: 'You' };
  }
}

export const useSocialStore = create<SocialState>()((set, get) => ({
  isOpen: false,
  activeTab: 'direct',
  friends: [...INITIAL_DEMO_FRIENDS],
  pendingIncoming: [...INITIAL_DEMO_INCOMING],
  pendingOutgoing: [],
  groups: [...INITIAL_DEMO_GROUPS],
  selectedFriendId: 'p-aria-101',
  selectedGroupId: 'grp-demo-1',
  directMessages: { ...INITIAL_DEMO_DIRECT_MESSAGES },
  groupMessages: { ...INITIAL_DEMO_GROUP_MESSAGES },
  unreadDirect: { 'p-aria-101': 1 },
  unreadGroups: {},

  toggleSidebar: () => {
    set((state) => {
      const nextOpen = !state.isOpen;
      // If opening, mark active conversation unread as 0
      const unreadDirect = { ...state.unreadDirect };
      const unreadGroups = { ...state.unreadGroups };
      if (nextOpen) {
        if (state.activeTab === 'direct' && state.selectedFriendId) {
          unreadDirect[state.selectedFriendId] = 0;
        } else if (state.activeTab === 'groups' && state.selectedGroupId) {
          unreadGroups[state.selectedGroupId] = 0;
        }
      }
      return {
        isOpen: nextOpen,
        unreadDirect,
        unreadGroups,
      };
    });
  },

  setSidebarOpen: (open: boolean) => {
    set((state) => {
      const unreadDirect = { ...state.unreadDirect };
      const unreadGroups = { ...state.unreadGroups };
      if (open) {
        if (state.activeTab === 'direct' && state.selectedFriendId) {
          unreadDirect[state.selectedFriendId] = 0;
        } else if (state.activeTab === 'groups' && state.selectedGroupId) {
          unreadGroups[state.selectedGroupId] = 0;
        }
      }
      return {
        isOpen: open,
        unreadDirect,
        unreadGroups,
      };
    });
  },

  setActiveTab: (tab: SocialTab) => {
    set((state) => {
      const unreadDirect = { ...state.unreadDirect };
      const unreadGroups = { ...state.unreadGroups };
      if (tab === 'direct' && state.selectedFriendId) {
        unreadDirect[state.selectedFriendId] = 0;
      } else if (tab === 'groups' && state.selectedGroupId) {
        unreadGroups[state.selectedGroupId] = 0;
      }
      return {
        activeTab: tab,
        unreadDirect,
        unreadGroups,
      };
    });
  },

  selectFriend: (friendId: string | null) => {
    set((state) => ({
      selectedFriendId: friendId,
      unreadDirect: friendId
        ? { ...state.unreadDirect, [friendId]: 0 }
        : state.unreadDirect,
    }));
    if (friendId) {
      get().loadChatHistory('direct', friendId);
    }
  },

  selectGroup: (groupId: string | null) => {
    set((state) => ({
      selectedGroupId: groupId,
      unreadGroups: groupId
        ? { ...state.unreadGroups, [groupId]: 0 }
        : state.unreadGroups,
    }));
    if (groupId) {
      get().loadChatHistory('group', groupId);
    }
  },

  sendFriendRequest: (targetUserId: string) => {
    const trimmed = targetUserId.trim();
    if (!trimmed) return;
    const user = getCurrentUser();
    const newRequest: FriendRequestDto = {
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from_user_id: user.id,
      from_user_name: user.name,
      to_user_id: trimmed,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    set((state) => ({
      pendingOutgoing: [...state.pendingOutgoing, newRequest],
    }));
    try {
      gameSocket.sendFriendRequest(trimmed);
    } catch (err) {
      console.warn('Socket sendFriendRequest failed:', err);
    }
  },

  acceptFriendRequest: (requestId: string) => {
    const state = get();
    const req = state.pendingIncoming.find((r) => r.id === requestId);
    if (!req) return;

    const newFriend: FriendDto = {
      user_id: req.from_user_id,
      username: req.from_user_name,
      is_online: true,
    };

    set((s) => ({
      pendingIncoming: s.pendingIncoming.filter((r) => r.id !== requestId),
      friends: [
        ...s.friends.filter((f) => f.user_id !== newFriend.user_id),
        newFriend,
      ],
      selectedFriendId: s.selectedFriendId || newFriend.user_id,
    }));

    try {
      gameSocket.acceptFriendRequest(requestId);
    } catch (err) {
      console.warn('Socket acceptFriendRequest failed:', err);
    }
  },

  declineFriendRequest: (requestId: string) => {
    set((state) => ({
      pendingIncoming: state.pendingIncoming.filter((r) => r.id !== requestId),
    }));
    try {
      gameSocket.declineFriendRequest(requestId);
    } catch (err) {
      console.warn('Socket declineFriendRequest failed:', err);
    }
  },

  sendDirectMessage: (recipientId: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const user = getCurrentUser();
    const newMsg: ChatMessageDto = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message_type: 'direct',
      sender_id: user.id,
      sender_name: user.name,
      recipient_id: recipientId,
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      directMessages: {
        ...state.directMessages,
        [recipientId]: [...(state.directMessages[recipientId] || []), newMsg],
      },
    }));

    try {
      gameSocket.sendDirectMessage(recipientId, trimmed);
    } catch (err) {
      console.warn('Socket sendDirectMessage failed:', err);
    }

    // Interactive offline demo auto-reply for demo bots
    if (
      !gameSocket.isConnected &&
      (recipientId === 'p-aria-101' || recipientId === 'p-kaelen-202')
    ) {
      setTimeout(() => {
        const friend = get().friends.find((f) => f.user_id === recipientId);
        const replyText =
          recipientId === 'p-aria-101'
            ? 'Got it! Meeting you at the coordinates shortly.'
            : 'Acknowledged! Bringing extra supplies.';
        const botMsg: ChatMessageDto = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          message_type: 'direct',
          sender_id: recipientId,
          sender_name: friend ? friend.username.replace(/ \[ID: .*\]/, '') : 'Friend',
          recipient_id: user.id,
          content: replyText,
          created_at: new Date().toISOString(),
        };
        get().handleSocialMessage({
          type: 'DIRECT_MSG_RECEIVED',
          message: botMsg,
        });
      }, 500);
    }
  },

  sendGroupMessage: (groupId: string, content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const user = getCurrentUser();
    const newMsg: ChatMessageDto = {
      id: `gmsg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      message_type: 'group',
      sender_id: user.id,
      sender_name: user.name,
      group_id: groupId,
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      groupMessages: {
        ...state.groupMessages,
        [groupId]: [...(state.groupMessages[groupId] || []), newMsg],
      },
    }));

    try {
      gameSocket.sendGroupMessage(groupId, trimmed);
    } catch (err) {
      console.warn('Socket sendGroupMessage failed:', err);
    }
  },

  createGroup: (name: string, initialMemberIds?: string[]) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const user = getCurrentUser();
    const members: GroupMemberDto[] = [
      {
        user_id: user.id,
        username: user.name,
        is_owner: true,
        joined_at: new Date().toISOString(),
      },
    ];

    if (initialMemberIds) {
      for (const mId of initialMemberIds) {
        if (mId === user.id) continue;
        const fr = get().friends.find((f) => f.user_id === mId);
        members.push({
          user_id: mId,
          username: fr ? fr.username.replace(/ \[ID: .*\]/, '') : mId,
          is_owner: false,
          joined_at: new Date().toISOString(),
        });
      }
    }

    const newGroup: GroupDto = {
      id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      owner_id: user.id,
      members,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      groups: [...state.groups, newGroup],
      selectedGroupId: newGroup.id,
    }));

    try {
      gameSocket.createGroup(trimmed, initialMemberIds || []);
    } catch (err) {
      console.warn('Socket createGroup failed:', err);
    }
  },

  inviteToGroup: (groupId: string, targetUserId: string) => {
    const state = get();
    const group = state.groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.members.some((m) => m.user_id === targetUserId)) return;

    const fr = state.friends.find((f) => f.user_id === targetUserId);
    const newMember: GroupMemberDto = {
      user_id: targetUserId,
      username: fr ? fr.username.replace(/ \[ID: .*\]/, '') : targetUserId,
      is_owner: false,
      joined_at: new Date().toISOString(),
    };

    set((s) => ({
      groups: s.groups.map((g) =>
        g.id === groupId
          ? { ...g, members: [...g.members, newMember] }
          : g
      ),
    }));

    try {
      gameSocket.inviteToGroup(groupId, targetUserId);
    } catch (err) {
      console.warn('Socket inviteToGroup failed:', err);
    }
  },

  loadChatHistory: (targetType: 'direct' | 'group', targetId: string) => {
    try {
      gameSocket.fetchChatHistory(targetType, targetId);
    } catch (err) {
      console.warn('Socket fetchChatHistory failed:', err);
    }
  },

  handleSocialMessage: (msg: any) => {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'FRIEND_LIST_SYNC': {
        set((state) => {
          const syncedFriends: FriendDto[] = Array.isArray(msg.friends) ? msg.friends : [];
          // Preserve demo friends if not already in list
          const combined = [...syncedFriends];
          for (const demoF of INITIAL_DEMO_FRIENDS) {
            if (!combined.some((f) => f.user_id === demoF.user_id)) {
              combined.push(demoF);
            }
          }
          return {
            friends: combined,
            pendingIncoming: Array.isArray(msg.pending_incoming)
              ? msg.pending_incoming
              : state.pendingIncoming,
            pendingOutgoing: Array.isArray(msg.pending_outgoing)
              ? msg.pending_outgoing
              : state.pendingOutgoing,
          };
        });
        break;
      }

      case 'FRIEND_REQUEST_RECEIVED': {
        const req: FriendRequestDto = msg.request;
        if (!req) break;
        set((state) => ({
          pendingIncoming: [
            ...state.pendingIncoming.filter((r) => r.id !== req.id),
            req,
          ],
        }));
        break;
      }

      case 'FRIEND_STATUS_UPDATE': {
        const { user_id, is_online } = msg;
        if (!user_id) break;
        set((state) => ({
          friends: state.friends.map((f) =>
            f.user_id === user_id ? { ...f, is_online: Boolean(is_online) } : f
          ),
        }));
        break;
      }

      case 'DIRECT_MSG_RECEIVED': {
        const message: ChatMessageDto = msg.message;
        if (!message) break;
        const user = getCurrentUser();
        const otherId =
          message.sender_id === user.id
            ? message.recipient_id || ''
            : message.sender_id;
        if (!otherId) break;

        set((state) => {
          const existing = state.directMessages[otherId] || [];
          if (existing.some((m) => m.id === message.id)) return state;

          const isViewing =
            state.isOpen &&
            state.activeTab === 'direct' &&
            state.selectedFriendId === otherId;

          const currentUnread = state.unreadDirect[otherId] || 0;
          return {
            directMessages: {
              ...state.directMessages,
              [otherId]: [...existing, message],
            },
            unreadDirect: {
              ...state.unreadDirect,
              [otherId]: isViewing ? 0 : currentUnread + 1,
            },
          };
        });
        break;
      }

      case 'GROUP_MSG_RECEIVED': {
        const message: ChatMessageDto = msg.message;
        if (!message) break;
        const groupId = message.group_id;
        if (!groupId) break;

        set((state) => {
          const existing = state.groupMessages[groupId] || [];
          if (existing.some((m) => m.id === message.id)) return state;

          const isViewing =
            state.isOpen &&
            state.activeTab === 'groups' &&
            state.selectedGroupId === groupId;

          const currentUnread = state.unreadGroups[groupId] || 0;
          return {
            groupMessages: {
              ...state.groupMessages,
              [groupId]: [...existing, message],
            },
            unreadGroups: {
              ...state.unreadGroups,
              [groupId]: isViewing ? 0 : currentUnread + 1,
            },
          };
        });
        break;
      }

      case 'GROUP_LIST_SYNC': {
        const groups: GroupDto[] = Array.isArray(msg.groups) ? msg.groups : [];
        set(() => {
          const combined = [...groups];
          for (const dg of INITIAL_DEMO_GROUPS) {
            if (!combined.some((g) => g.id === dg.id)) {
              combined.push(dg);
            }
          }
          return { groups: combined };
        });
        break;
      }

      case 'GROUP_CREATED': {
        const group: GroupDto = msg.group;
        if (!group) break;
        set((state) => ({
          groups: [...state.groups.filter((g) => g.id !== group.id), group],
        }));
        break;
      }

      case 'GROUP_MEMBER_JOINED': {
        const { group_id, member } = msg;
        if (!group_id || !member) break;
        set((state) => ({
          groups: state.groups.map((g) => {
            if (g.id !== group_id) return g;
            if (g.members.some((m) => m.user_id === member.user_id)) return g;
            return { ...g, members: [...g.members, member] };
          }),
        }));
        break;
      }

      case 'CHAT_HISTORY_SYNC': {
        const { target_type, target_id, messages } = msg;
        if (!target_id || !Array.isArray(messages)) break;
        set((state) => {
          if (target_type === 'direct') {
            return {
              directMessages: {
                ...state.directMessages,
                [target_id]: messages,
              },
            };
          } else if (target_type === 'group') {
            return {
              groupMessages: {
                ...state.groupMessages,
                [target_id]: messages,
              },
            };
          }
          return state;
        });
        break;
      }
    }
  },
}));
