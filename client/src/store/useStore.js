import { create } from 'zustand'

const useStore = create((set) => ({
  // 用户
  user: null,
  setUser: (user) => set({ user }),

  // 房间列表
  rooms: [],
  setRooms: (rooms) => set({ rooms }),

  // 当前房间
  currentRoom: null,
  setCurrentRoom: (room) => set({ currentRoom: room }),

  // 在线成员
  members: [],
  setMembers: (members) => set({ members }),
  addMember: (member) => set((s) => ({ members: [...s.members, member] })),
  removeMember: (userId) => set((s) => ({ members: s.members.filter((m) => m.id !== userId) })),

  // 某成员说话状态
  speakingUsers: {},
  setSpeaking: (userId, speaking) =>
    set((s) => ({ speakingUsers: { ...s.speakingUsers, [userId]: speaking } })),

  // 公屏消息
  messages: [],
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),

  // 屏幕共享状态
  screenSharer: null,
  setScreenSharer: (userId) => set({ screenSharer: userId }),

  // AI 开关
  aiEnabled: true,
  setAiEnabled: (v) => set({ aiEnabled: v }),

  // AI 流式状态
  aiTyping: false,          // AI 是否正在输入
  aiStreamId: null,          // 当前流式消息 ID
  aiStreamContent: '',       // 流式文本（实时更新）
  setAiTyping: (typing) => set({ aiTyping: typing }),
  setAiStream: (id, content) => set({ aiStreamId: id, aiStreamContent: content }),
  appendAiStream: (chunk) => set((s) => ({ aiStreamContent: s.aiStreamContent + chunk })),
  clearAiStream: () => set({ aiTyping: false, aiStreamId: null, aiStreamContent: '' }),

  // 重置
  reset: () =>
    set({
      currentRoom: null,
      members: [],
      messages: [],
      screenSharer: null,
      aiTyping: false,
      aiStreamId: null,
      aiStreamContent: '',
    }),
}))

export default useStore
