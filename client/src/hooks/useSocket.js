import { useEffect } from 'react'
import { connectSocket, disconnectSocket, getSocket } from '../services/socket'
import useStore from '../store/useStore'

export default function useSocket(roomId) {
  const {
    setMembers,
    addMember,
    removeMember,
    setSpeaking,
    addMessage,
    setScreenSharer,
    setCurrentRoom,
  } = useStore()

  useEffect(() => {
    const socket = connectSocket()

    socket.on('connect', () => {
      console.log('[Socket] connected:', socket.id)
      if (roomId) {
        const user = useStore.getState().user
        socket.emit('join-room', { roomId, userId: user?.id })
      }
    })

    // 信令转发
    socket.on('offer', (data) => {
      const event = new CustomEvent('webrtc-offer', { detail: data })
      window.dispatchEvent(event)
    })
    socket.on('answer', (data) => {
      const event = new CustomEvent('webrtc-answer', { detail: data })
      window.dispatchEvent(event)
    })
    socket.on('ice-candidate', (data) => {
      const event = new CustomEvent('webrtc-ice', { detail: data })
      window.dispatchEvent(event)
    })

    // 成员管理 + WebRTC 事件转发
    socket.on('user-joined', ({ userId, userInfo }) => {
      addMember({ id: userId, ...userInfo })
      addMessage({ type: 'system', content: `${userInfo?.username || userId} 加入了房间`, id: Date.now().toString() })
      // 通知 WebRTC 管理器：有新用户加入，需要创建 PeerConnection
      window.dispatchEvent(new CustomEvent('webrtc-user-joined', { detail: { userId, userInfo } }))
    })
    socket.on('user-left', ({ userId }) => {
      removeMember(userId)
      addMessage({ type: 'system', content: `${userId} 离开了房间`, id: Date.now().toString() })
      // 通知 WebRTC 管理器：用户离开，关闭对应 PeerConnection
      window.dispatchEvent(new CustomEvent('webrtc-user-left', { detail: { userId } }))
    })
    socket.on('user-list-update', ({ users }) => {
      setMembers(users)
    })

    // 说话状态
    socket.on('voice-state', ({ userId, speaking }) => {
      setSpeaking(userId, speaking)
    })

    // 消息
    socket.on('new-message', (msg) => {
      addMessage(msg)
    })

    // AI 流式响应
    const setAiTyping = useStore.getState().setAiTyping
    const setAiStream = useStore.getState().setAiStream
    const appendAiStream = useStore.getState().appendAiStream
    const clearAiStream = useStore.getState().clearAiStream

    socket.on('ai-typing', ({ id, typing }) => {
      if (typing) {
        setAiTyping(true)
        setAiStream(id, '')
      } else {
        clearAiStream()
      }
    })

    socket.on('ai-chunk', ({ id, content }) => {
      setAiStream(id, content)
    })

    socket.on('ai-done', ({ id, content }) => {
      addMessage({ type: 'ai', content, id, username: '小V', createdAt: new Date().toISOString() })
      clearAiStream()
    })

    // 屏幕共享
    socket.on('screen-share-start', ({ userId }) => {
      setScreenSharer(userId)
      addMessage({ type: 'system', content: `${userId} 开始屏幕共享`, id: Date.now().toString() })
    })
    socket.on('screen-share-stop', ({ userId }) => {
      setScreenSharer(null)
      addMessage({ type: 'system', content: `${userId} 停止屏幕共享`, id: Date.now().toString() })
    })

    // 房间信息
    socket.on('room-info', ({ room }) => {
      setCurrentRoom(room)
    })

    // 错误处理
    socket.on('error-msg', ({ message }) => {
      console.error('[Socket] error:', message)
    })

    return () => {
      if (roomId) {
        socket.emit('leave-room', { roomId })
      }
      socket.off('offer')
      socket.off('answer')
      socket.off('ice-candidate')
      socket.off('user-joined')
      socket.off('user-left')
      socket.off('user-list-update')
      socket.off('voice-state')
      socket.off('new-message')
      socket.off('ai-typing')
      socket.off('ai-chunk')
      socket.off('ai-done')
      socket.off('screen-share-start')
      socket.off('screen-share-stop')
      socket.off('room-info')
      socket.off('error-msg')
    }
  }, [roomId])
}
