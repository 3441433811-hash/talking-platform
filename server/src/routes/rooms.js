const { Router } = require('express')
const { v4: uuidv4 } = require('uuid')
const { authMiddleware } = require('../middleware/auth')

const router = Router()

// 简易内存房间存储（后续替换为数据库）
const rooms = []
const messages = [] // { id, roomId, userId, type, content, username, createdAt }

// 获取房间列表
router.get('/', authMiddleware, (req, res) => {
  const list = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    hasPassword: !!r.password,
    memberCount: r.memberCount || 0,
    ownerId: r.ownerId,
    createdAt: r.createdAt,
  }))
  res.json({ rooms: list })
})

// 获取房间详情
router.get('/:id', authMiddleware, (req, res) => {
  const room = rooms.find((r) => r.id === req.params.id)
  if (!room) return res.status(404).json({ message: '房间不存在' })
  res.json({
    room: {
      id: room.id,
      name: room.name,
      hasPassword: !!room.password,
      ownerId: room.ownerId,
      createdAt: room.createdAt,
    },
  })
})

// 创建房间
router.post('/', authMiddleware, (req, res) => {
  const { name, password, maxUsers } = req.body
  if (!name) return res.status(400).json({ message: '请输入房间名称' })

  const room = {
    id: uuidv4(),
    name,
    password: password || null,
    maxUsers: maxUsers || 10,
    ownerId: req.user.id,
    memberCount: 0,
    createdAt: new Date(),
  }
  rooms.push(room)

  // 系统消息
  messages.push({
    id: uuidv4(),
    roomId: room.id,
    type: 'system',
    content: `房间 "${name}" 已创建`,
    createdAt: new Date(),
  })

  res.status(201).json({ room })
})

// 加入房间（密码验证）
router.post('/:id/join', authMiddleware, (req, res) => {
  const room = rooms.find((r) => r.id === req.params.id)
  if (!room) return res.status(404).json({ message: '房间不存在' })
  if (room.password && room.password !== req.body.password) {
    return res.status(403).json({ message: '房间密码错误' })
  }
  res.json({ ok: true })
})

// 删除房间（仅房主）
router.delete('/:id', authMiddleware, (req, res) => {
  const idx = rooms.findIndex((r) => r.id === req.params.id)
  if (idx === -1) return res.status(404).json({ message: '房间不存在' })
  if (rooms[idx].ownerId !== req.user.id) {
    return res.status(403).json({ message: '只有房主可以删除房间' })
  }
  rooms.splice(idx, 1)
  res.json({ ok: true })
})

// 获取房间消息历史
router.get('/:id/messages', authMiddleware, (req, res) => {
  const msgs = messages
    .filter((m) => m.roomId === req.params.id)
    .slice(-50) // 最近 50 条
    .map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      username: m.username,
      createdAt: m.createdAt,
    }))
  res.json({ messages: msgs })
})

module.exports = router
