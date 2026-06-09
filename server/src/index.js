require('dotenv').config()
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const cors = require('cors')

const authRoutes = require('./routes/auth')
const roomRoutes = require('./routes/rooms')
const { setupSocketAuth } = require('./middleware/auth')
const setupSignaling = require('./socket/signaling')
const setupChat = require('./socket/chat')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

const PORT = process.env.PORT || 3001

// 中间件
app.use(cors())
app.use(express.json())

// REST API 路由
app.use('/api/auth', authRoutes)
app.use('/api/rooms', roomRoutes)

// 健康检查
app.get('/api', (req, res) => {
  res.json({ ok: true, message: 'VoiceHub Server Running' })
})

// Socket.IO 鉴权中间件
io.use(setupSocketAuth)

// Socket.IO 连接处理
const roomUsers = new Map() // roomId -> Set<socketId>

io.on('connection', (socket) => {
  console.log(`[Socket] 用户连接: ${socket.id} (${socket.user?.username})`)

  // 加入房间（语音 + 信令）
  socket.on('join-room', ({ roomId, userId }) => {
    socket.join(roomId)
    socket.data.roomId = roomId
    socket.data.userId = userId

    // 记录房间成员
    if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Set())
    roomUsers.get(roomId).add(socket.id)

    // 广播成员更新
    const members = []
    roomUsers.get(roomId).forEach((sid) => {
      const s = io.sockets.sockets.get(sid)
      if (s) members.push({ id: s.data.userId || sid, username: s.user?.username })
    })
    io.to(roomId).emit('user-list-update', { users: members })

    // 通知其他人
    socket.to(roomId).emit('user-joined', {
      userId: socket.data.userId,
      userInfo: { username: socket.user?.username, id: socket.data.userId },
    })

    console.log(`[Socket] ${socket.user?.username} 加入房间 ${roomId}`)
  })

  // 退出房间
  socket.on('leave-room', ({ roomId }) => {
    handleLeaveRoom(socket, roomId)
  })

  // 断开连接
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId
    if (roomId) handleLeaveRoom(socket, roomId)
    console.log(`[Socket] 用户断开: ${socket.id}`)
  })

  // WebRTC 信令
  setupSignaling(io, socket)

  // 公屏消息 & AI
  setupChat(io, socket, roomUsers)
})

function handleLeaveRoom(socket, roomId) {
  socket.leave(roomId)
  if (roomUsers.has(roomId)) {
    roomUsers.get(roomId).delete(socket.id)
    if (roomUsers.get(roomId).size === 0) roomUsers.delete(roomId)
  }

  socket.to(roomId).emit('user-left', { userId: socket.data.userId })

  const members = []
  if (roomUsers.has(roomId)) {
    roomUsers.get(roomId).forEach((sid) => {
      const s = io.sockets.sockets.get(sid)
      if (s) members.push({ id: s.data.userId || sid, username: s.user?.username })
    })
  }
  io.to(roomId).emit('user-list-update', { users: members })
}

server.listen(PORT, () => {
  console.log(`[Server] VoiceHub 运行在 http://localhost:${PORT}`)
})
