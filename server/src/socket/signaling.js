// WebRTC 信令处理模块
// 负责转发 Offer / Answer / ICE Candidate 以及屏幕共享事件

function setupSignaling(io, socket) {
  // 按 userId 查找房间内指定 socket
  function findSocketByUserId(userId) {
    const roomSockets = io.sockets.adapter.rooms.get(socket.data.roomId)
    if (!roomSockets) return null
    for (const sid of roomSockets) {
      const s = io.sockets.sockets.get(sid)
      if (s?.data?.userId === userId) return s
    }
    return null
  }

  // Offer 转发 — 按 targetId (userId) 精准路由
  socket.on('offer', ({ targetId, sdp }) => {
    const payload = { fromId: socket.id, userId: socket.data.userId, sdp }
    const target = findSocketByUserId(targetId)
    if (target) {
      target.emit('offer', payload)
    } else {
      // fallback: 目标不在房间时广播（兼容旧客户端或 targetId 为 socketId 的情况）
      socket.to(socket.data.roomId).emit('offer', payload)
    }
    console.log(`[Signaling] Offer: ${socket.data.userId} -> ${targetId || 'broadcast'}`)
  })

  // Answer 转发 — 按 targetId (userId) 精准路由
  socket.on('answer', ({ targetId, sdp }) => {
    const payload = { fromId: socket.id, userId: socket.data.userId, sdp }
    const target = findSocketByUserId(targetId)
    if (target) {
      target.emit('answer', payload)
    } else {
      socket.to(socket.data.roomId).emit('answer', payload)
    }
  })

  // ICE Candidate 转发 — 按 targetId (userId) 精准路由
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    const payload = { fromId: socket.id, userId: socket.data.userId, candidate }
    const target = findSocketByUserId(targetId)
    if (target) {
      target.emit('ice-candidate', payload)
    } else {
      socket.to(socket.data.roomId).emit('ice-candidate', payload)
    }
  })

  // 屏幕共享开始
  socket.on('share-screen-start', ({ roomId }) => {
    socket.to(roomId).emit('screen-share-start', { userId: socket.data.userId })
    console.log(`[Signaling] ${socket.data.userId} 开始屏幕共享`)
  })

  // 屏幕共享停止
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
