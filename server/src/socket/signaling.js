// WebRTC 信令处理模块
// 负责转发 Offer / Answer / ICE Candidate 以及屏幕共享事件

function setupSignaling(io, socket) {
  // Offer 转发
  socket.on('offer', ({ targetId, sdp }) => {
    socket.to(socket.data.roomId).emit('offer', {
      fromId: socket.id,
      userId: socket.data.userId,
      sdp,
    })
    console.log(`[Signaling] Offer: ${socket.data.userId} -> room ${socket.data.roomId}`)
  })

  // Answer 转发
  socket.on('answer', ({ targetId, sdp }) => {
    socket.to(socket.data.roomId).emit('answer', {
      fromId: socket.id,
      userId: socket.data.userId,
      sdp,
    })
  })

  // ICE Candidate 转发
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    socket.to(socket.data.roomId).emit('ice-candidate', {
      fromId: socket.id,
      userId: socket.data.userId,
      candidate,
    })
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
