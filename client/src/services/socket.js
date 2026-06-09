import { io } from 'socket.io-client'

let socket = null

export function getSocket() {
  if (!socket) {
    socket = io('/', {
      autoConnect: false,
      auth: (cb) => {
        cb({ token: localStorage.getItem('token') })
      },
    })
  }
  return socket
}

export function connectSocket() {
  const s = getSocket()
  if (!s.connected) s.connect()
  return s
}

export function disconnectSocket() {
  if (socket?.connected) socket.disconnect()
  socket = null
}

// 发送 WebRTC 信令
export function sendOffer(targetId, sdp) {
  socket?.emit('offer', { targetId, sdp })
}

export function sendAnswer(targetId, sdp) {
  socket?.emit('answer', { targetId, sdp })
}

export function sendIceCandidate(targetId, candidate) {
  socket?.emit('ice-candidate', { targetId, candidate })
}

// 房间操作
export function joinRoom(roomId, userId) {
  socket?.emit('join-room', { roomId, userId })
}

export function leaveRoom(roomId) {
  socket?.emit('leave-room', { roomId })
}

// 屏幕共享
export function startScreenShare(roomId) {
  socket?.emit('share-screen-start', { roomId })
}

export function stopScreenShare(roomId) {
  socket?.emit('share-screen-stop', { roomId })
}

// 公屏消息
export function sendMessage(roomId, content, type = 'text') {
  socket?.emit('send-message', { roomId, content, type })
}

// AI 对话
export function aiQuery(roomId, content) {
  socket?.emit('ai-query', { roomId, content })
}
