import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  useSocialStore,
  INITIAL_DEMO_FRIENDS,
  INITIAL_DEMO_INCOMING,
  INITIAL_DEMO_GROUPS,
  type FriendRequestDto,
  type ChatMessageDto,
} from '../store/socialStore.ts';

describe('useSocialStore Unit Tests', () => {
  beforeEach(() => {
    // Reset store to known fresh state before each test
    useSocialStore.setState({
      isOpen: false,
      activeTab: 'direct',
      friends: [...INITIAL_DEMO_FRIENDS],
      pendingIncoming: [...INITIAL_DEMO_INCOMING],
      pendingOutgoing: [],
      groups: [...INITIAL_DEMO_GROUPS],
      selectedFriendId: 'p-aria-101',
      selectedGroupId: 'grp-demo-1',
      directMessages: {},
      groupMessages: {},
      unreadDirect: {},
      unreadGroups: {},
    });
  });

  describe('1. Sidebar and Tab Navigation Mutations', () => {
    it('toggles sidebar open and closed state', () => {
      assert.equal(useSocialStore.getState().isOpen, false);

      useSocialStore.getState().toggleSidebar();
      assert.equal(useSocialStore.getState().isOpen, true);

      useSocialStore.getState().toggleSidebar();
      assert.equal(useSocialStore.getState().isOpen, false);
    });

    it('sets sidebar open explicitly', () => {
      useSocialStore.getState().setSidebarOpen(true);
      assert.equal(useSocialStore.getState().isOpen, true);

      useSocialStore.getState().setSidebarOpen(false);
      assert.equal(useSocialStore.getState().isOpen, false);
    });

    it('switches active tabs among direct, groups, and add_friend', () => {
      assert.equal(useSocialStore.getState().activeTab, 'direct');

      useSocialStore.getState().setActiveTab('groups');
      assert.equal(useSocialStore.getState().activeTab, 'groups');

      useSocialStore.getState().setActiveTab('add_friend');
      assert.equal(useSocialStore.getState().activeTab, 'add_friend');

      useSocialStore.getState().setActiveTab('direct');
      assert.equal(useSocialStore.getState().activeTab, 'direct');
    });

    it('selects friend and clears unread counter for that friend', () => {
      useSocialStore.setState({
        unreadDirect: { 'p-kaelen-202': 3 },
      });

      useSocialStore.getState().selectFriend('p-kaelen-202');
      assert.equal(useSocialStore.getState().selectedFriendId, 'p-kaelen-202');
      assert.equal(useSocialStore.getState().unreadDirect['p-kaelen-202'], 0);
    });

    it('selects group and clears unread counter for that group', () => {
      useSocialStore.setState({
        unreadGroups: { 'grp-demo-1': 5 },
      });

      useSocialStore.getState().selectGroup('grp-demo-1');
      assert.equal(useSocialStore.getState().selectedGroupId, 'grp-demo-1');
      assert.equal(useSocialStore.getState().unreadGroups['grp-demo-1'], 0);
    });
  });

  describe('2. Direct Messaging & Unread Math', () => {
    it('records outgoing direct messages in directMessages store', () => {
      useSocialStore.getState().sendDirectMessage('p-aria-101', 'Greetings Aria!');

      const messages = useSocialStore.getState().directMessages['p-aria-101'];
      assert.ok(messages && messages.length === 1);
      assert.equal(messages[0].content, 'Greetings Aria!');
      assert.equal(messages[0].recipient_id, 'p-aria-101');
      assert.equal(messages[0].message_type, 'direct');
    });

    it('increments unreadDirect when receiving direct message while closed', () => {
      useSocialStore.setState({ isOpen: false, unreadDirect: {} });

      const incomingMsg: ChatMessageDto = {
        id: 'msg-rec-1',
        message_type: 'direct',
        sender_id: 'p-kaelen-202',
        sender_name: 'Kaelen',
        recipient_id: 'me',
        content: 'Are you ready for the dungeon?',
        created_at: new Date().toISOString(),
      };

      useSocialStore.getState().handleSocialMessage({
        type: 'DIRECT_MSG_RECEIVED',
        message: incomingMsg,
      });

      const state = useSocialStore.getState();
      assert.equal(state.unreadDirect['p-kaelen-202'], 1);
      assert.equal(state.directMessages['p-kaelen-202']?.length, 1);
      assert.equal(state.directMessages['p-kaelen-202'][0].content, 'Are you ready for the dungeon?');

      // Second message increments counter to 2
      useSocialStore.getState().handleSocialMessage({
        type: 'DIRECT_MSG_RECEIVED',
        message: { ...incomingMsg, id: 'msg-rec-2', content: 'Second ping' },
      });
      assert.equal(useSocialStore.getState().unreadDirect['p-kaelen-202'], 2);
    });

    it('does not increment unreadDirect when user is actively viewing that conversation', () => {
      useSocialStore.setState({
        isOpen: true,
        activeTab: 'direct',
        selectedFriendId: 'p-aria-101',
        unreadDirect: { 'p-aria-101': 0 },
      });

      const incomingMsg: ChatMessageDto = {
        id: 'msg-rec-3',
        message_type: 'direct',
        sender_id: 'p-aria-101',
        sender_name: 'Aria',
        recipient_id: 'me',
        content: 'Watching the stream now.',
        created_at: new Date().toISOString(),
      };

      useSocialStore.getState().handleSocialMessage({
        type: 'DIRECT_MSG_RECEIVED',
        message: incomingMsg,
      });

      assert.equal(useSocialStore.getState().unreadDirect['p-aria-101'], 0);
      assert.equal(useSocialStore.getState().directMessages['p-aria-101']?.length, 1);
    });

    it('deduplicates incoming messages by ID', () => {
      const incomingMsg: ChatMessageDto = {
        id: 'msg-dedup-1',
        message_type: 'direct',
        sender_id: 'p-aria-101',
        sender_name: 'Aria',
        recipient_id: 'me',
        content: 'Test deduplication',
        created_at: new Date().toISOString(),
      };

      useSocialStore.getState().handleSocialMessage({
        type: 'DIRECT_MSG_RECEIVED',
        message: incomingMsg,
      });
      useSocialStore.getState().handleSocialMessage({
        type: 'DIRECT_MSG_RECEIVED',
        message: incomingMsg,
      });

      const messages = useSocialStore.getState().directMessages['p-aria-101'];
      assert.equal(messages?.length, 1);
    });
  });

  describe('3. Group Messaging & Operations', () => {
    it('creates a new group and sets it as active group', () => {
      useSocialStore.getState().createGroup('Mystic Raiders', ['p-aria-101', 'p-kaelen-202']);

      const groups = useSocialStore.getState().groups;
      const created = groups.find((g) => g.name === 'Mystic Raiders');
      assert.ok(created);
      assert.equal(useSocialStore.getState().selectedGroupId, created.id);
      assert.ok(created.members.length >= 2);
    });

    it('invites a friend to an existing group', () => {
      useSocialStore.getState().inviteToGroup('grp-demo-1', 'p-zephyr-999');

      const group = useSocialStore.getState().groups.find((g) => g.id === 'grp-demo-1');
      assert.ok(group);
      assert.ok(group.members.some((m) => m.user_id === 'p-zephyr-999'));
    });

    it('sends and stores group messages', () => {
      useSocialStore.getState().sendGroupMessage('grp-demo-1', 'Rally at the fountain!');

      const messages = useSocialStore.getState().groupMessages['grp-demo-1'];
      assert.ok(messages && messages.length === 1);
      assert.equal(messages[0].content, 'Rally at the fountain!');
      assert.equal(messages[0].group_id, 'grp-demo-1');
    });

    it('handles GROUP_MSG_RECEIVED and increments unread count when not viewing', () => {
      useSocialStore.setState({ isOpen: false, unreadGroups: {} });

      const groupMsg: ChatMessageDto = {
        id: 'gmsg-1',
        message_type: 'group',
        sender_id: 'p-aria-101',
        sender_name: 'Aria',
        group_id: 'grp-demo-1',
        content: 'Boss incoming in 5 minutes!',
        created_at: new Date().toISOString(),
      };

      useSocialStore.getState().handleSocialMessage({
        type: 'GROUP_MSG_RECEIVED',
        message: groupMsg,
      });

      assert.equal(useSocialStore.getState().unreadGroups['grp-demo-1'], 1);
      assert.equal(useSocialStore.getState().groupMessages['grp-demo-1']?.length, 1);
    });
  });

  describe('4. Friend Requests & Relationship Acceptance', () => {
    it('creates outgoing friend request upon sendFriendRequest', () => {
      useSocialStore.getState().sendFriendRequest('p-valkyrie-505');

      const outgoing = useSocialStore.getState().pendingOutgoing;
      assert.ok(outgoing.some((r) => r.to_user_id === 'p-valkyrie-505' && r.status === 'pending'));
    });

    it('ingests incoming friend request via FRIEND_REQUEST_RECEIVED', () => {
      const newReq: FriendRequestDto = {
        id: 'req-test-99',
        from_user_id: 'p-shadow-404',
        from_user_name: 'ShadowMage',
        to_user_id: 'me',
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      useSocialStore.getState().handleSocialMessage({
        type: 'FRIEND_REQUEST_RECEIVED',
        request: newReq,
      });

      const incoming = useSocialStore.getState().pendingIncoming;
      assert.ok(incoming.some((r) => r.id === 'req-test-99'));
    });

    it('accepts friend request: removes from pending and appends to confirmed friends', () => {
      const reqId = 'req-demo-1';
      assert.ok(useSocialStore.getState().pendingIncoming.some((r) => r.id === reqId));

      useSocialStore.getState().acceptFriendRequest(reqId);

      // Removed from pending
      assert.equal(
        useSocialStore.getState().pendingIncoming.some((r) => r.id === reqId),
        false
      );

      // Added to friends list
      const friends = useSocialStore.getState().friends;
      const acceptedFriend = friends.find((f) => f.user_id === 'p-zephyr-303');
      assert.ok(acceptedFriend);
      assert.equal(acceptedFriend.is_online, true);
    });

    it('declines friend request: removes from pending without adding to friends', () => {
      const reqId = 'req-demo-1';
      useSocialStore.getState().declineFriendRequest(reqId);

      assert.equal(
        useSocialStore.getState().pendingIncoming.some((r) => r.id === reqId),
        false
      );
      assert.equal(
        useSocialStore.getState().friends.some((f) => f.user_id === 'p-zephyr-303'),
        false
      );
    });

    it('updates friend online/offline status via FRIEND_STATUS_UPDATE', () => {
      useSocialStore.setState({
        friends: [
          { user_id: 'p-aria-101', username: 'Aria', is_online: true },
          { user_id: 'p-kaelen-202', username: 'Kaelen', is_online: false },
        ],
      });

      useSocialStore.getState().handleSocialMessage({
        type: 'FRIEND_STATUS_UPDATE',
        user_id: 'p-kaelen-202',
        is_online: true,
      });

      const kaelen = useSocialStore.getState().friends.find((f) => f.user_id === 'p-kaelen-202');
      assert.equal(kaelen?.is_online, true);
    });
  });

  describe('5. Chat History Synchronization', () => {
    it('syncs direct chat history into directMessages', () => {
      const history: ChatMessageDto[] = [
        {
          id: 'hist-1',
          message_type: 'direct',
          sender_id: 'p-aria-101',
          sender_name: 'Aria',
          recipient_id: 'me',
          content: 'Archived message 1',
          created_at: new Date().toISOString(),
        },
        {
          id: 'hist-2',
          message_type: 'direct',
          sender_id: 'me',
          sender_name: 'You',
          recipient_id: 'p-aria-101',
          content: 'Archived message 2',
          created_at: new Date().toISOString(),
        },
      ];

      useSocialStore.getState().handleSocialMessage({
        type: 'CHAT_HISTORY_SYNC',
        target_type: 'direct',
        target_id: 'p-aria-101',
        messages: history,
      });

      const msgs = useSocialStore.getState().directMessages['p-aria-101'];
      assert.equal(msgs.length, 2);
      assert.equal(msgs[0].content, 'Archived message 1');
      assert.equal(msgs[1].content, 'Archived message 2');
    });

    it('syncs group chat history into groupMessages', () => {
      const history: ChatMessageDto[] = [
        {
          id: 'ghist-1',
          message_type: 'group',
          sender_id: 'p-kaelen-202',
          sender_name: 'Kaelen',
          group_id: 'grp-demo-1',
          content: 'Group log 1',
          created_at: new Date().toISOString(),
        },
      ];

      useSocialStore.getState().handleSocialMessage({
        type: 'CHAT_HISTORY_SYNC',
        target_type: 'group',
        target_id: 'grp-demo-1',
        messages: history,
      });

      const msgs = useSocialStore.getState().groupMessages['grp-demo-1'];
      assert.equal(msgs.length, 1);
      assert.equal(msgs[0].content, 'Group log 1');
    });
  });
});
