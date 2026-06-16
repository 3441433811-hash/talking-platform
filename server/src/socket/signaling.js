// WebRTC 信令处理模块
// 负责转发 Offer / Answer / ICE Candidate 以及屏幕共享事件

// 在房间内按 userId 查找目标的 socket（定向转发）
function findSocketByUserId(io, roomId, userId) {
  const room = io.sockets.adapter.rooms.get(roomId)
  if (!room) return null
  for (const socketId of room) {
    const s = io.sockets.sockets.get(socketId)
    if (s && s.data.userId === userId) {
      return s
    }
  }
  return null
}

// 向目标用户发送信令事件（优先定向；找不到目标时降级广播到房间）
function forwardToTarget(socket, io, eventName, payload) {
  const { targetId } = payload
  const roomId = socket.data.roomId
  if (targetId) {
    const target = findSocketByUserId(io, roomId, targetId)
    if (target) {
      target.emit(eventName, {
        fromId: socket.id,
        userId: socket.data.userId,
        sdp: payload.sdp,
        candidate: payload.candidate,
      })
      return
    }
  }
  // 降级：广播给房间内其他人（目标已离开或未指定 targetId）
  socket.to(roomId).emit(eventName, {
    fromId: socket.id,
    userId: socket.data.userId,
    sdp: payload.sdp,
    candidate: payload.candidate,
  })
}

function setupSignaling(io, socket) {
  // Offer 转发 — 定向到 targetId，避免多 peer 场景 SDP 广播冲突
  socket.on('offer', (payload) => {
    forwardToTarget(socket, io, 'offer', payload)
    console.log(`[Signaling] Offer: ${socket.data.userId} -> ${payload.targetId || 'room ' + socket.data.roomId}`)
  })

  // Answer 转发
  socket.on('answer', (payload) => {
    forwardToTarget(socket, io, 'answer', payload)
  })

  // ICE Candidate 转发
  socket.on('ice-candidate', (payload) => {
    forwardToTarget(socket, io, 'ice-candidate', payload)
  })

  // 屏幕共享开始（通知事件，广播给房间所有人）
  socket.on('share-screen-start', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-start', { userId: socket.data.userId })
    console.log(`[Signaling] ${socket.data.userId} 开始屏幕共享`)
  })

  // 屏幕共享停止（通知事件，广播给房间所有人）
  socket.on('share-screen-stop', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-stop', { userId: socket.data.userId })
    console.log(`[Signaling] ${socket.data.userId} 停止屏幕共享`)
  })

  // 语音状态（正在说话）
  socket.on('voice-state', ({ roomId, speaking }) => {
    socket.to(roomId).emit('voice-state', {
      userId: socket.data.userId,
      speaking,
    })
  })
}

module.exports = setupSignaling
