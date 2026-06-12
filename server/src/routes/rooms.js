const { Router } = require('express')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')
const { authMiddleware } = require('../middleware/auth')
const db = require('../db')

const router = Router()

// 获取房间列表
router.get('/', authMiddleware, (req, res) => {
  const rows = db.getAllRooms()
  const list = rows.map((r) => ({
    id: r.id,
    name: r.name,
    hasPassword: !!r.password_hash,
    memberCount: r.member_count || 0,
    ownerId: r.owner_id,
    createdAt: r.created_at,
  }))
  res.json({ rooms: list })
})

// 获取房间详情
router.get('/:id', authMiddleware, (req, res) => {
  const room = db.getRoomById(req.params.id)
  if (!room) return res.status(404).json({ message: '房间不存在' })
  res.json({
    room: {
      id: room.id,
      name: room.name,
      hasPassword: !!room.password_hash,
      ownerId: room.owner_id,
      createdAt: room.created_at,
    },
  })
})

// 创建房间
router.post('/', authMiddleware, async (req, res) => {
  const { name, password, maxUsers } = req.body
  if (!name) return res.status(400).json({ message: '请输入房间名称' })

  let passwordHash = null
  if (password) {
    passwordHash = await bcrypt.hash(password, 10)
  }

  const room = db.createRoom({
    id: uuidv4(),
    name,
    passwordHash,
    maxUsers: maxUsers || 10,
    ownerId: req.user.id,
    createdAt: new Date().toISOString(),
  })

  // 系统消息
  db.createMessage({
    id: uuidv4(),
    roomId: room.id,
    type: 'system',
    content: `房间 "${name}" 已创建`,
    createdAt: new Date().toISOString(),
  })

  res.status(201).json({ room })
})

// 加入房间（密码验证）
router.post('/:id/join', authMiddleware, async (req, res) => {
  const room = db.getRoomById(req.params.id)
  if (!room) return res.status(404).json({ message: '房间不存在' })
  if (room.password_hash) {
    if (!req.body.password) return res.status(403).json({ message: '请输入房间密码' })
    const valid = await bcrypt.compare(req.body.password, room.password_hash)
    if (!valid) return res.status(403).json({ message: '房间密码错误' })
  }
  res.json({ ok: true })
})

// 删除房间（仅房主）
router.delete('/:id', authMiddleware, (req, res) => {
  const room = db.getRoomById(req.params.id)
  if (!room) return res.status(404).json({ message: '房间不存在' })
  if (room.owner_id !== req.user.id) {
    return res.status(403).json({ message: '只有房主可以删除房间' })
  }
  db.deleteRoomById(req.params.id)
  res.json({ ok: true })
})

// 获取房间消息历史
router.get('/:id/messages', authMiddleware, (req, res) => {
  const msgs = db.getMessagesByRoomId(req.params.id, 50).map((m) => ({
    id: m.id,
    type: m.type,
    content: m.content,
    username: m.username,
    createdAt: m.created_at,
  }))
  res.json({ messages: msgs })
})

module.exports = router
