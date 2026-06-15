const { Router } = require('express')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')
const { authMiddleware } = require('../middleware/auth')
const db = require('../db')

module.exports = (io) => {
  const router = Router()

  // 查找房间：先按 UUID，再按短码
  async function findRoom(idOrCode) {
    let room = await db.getRoomById(idOrCode)
    if (!room) room = await db.getRoomByShortCode(idOrCode)
    return room
  }

// 获取房间列表
router.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await db.getAllRooms(req.user.id)
    const list = rows.map((r) => ({
      id: r.id,
      name: r.name,
      hasPassword: !!r.password_hash,
      isPublic: r.is_public !== false,
      hasAccessCode: !!r.access_code,
      memberCount: r.member_count || 0,
      ownerId: r.owner_id,
      createdAt: r.created_at,
    }))
    res.json({ rooms: list })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

// 获取房间详情
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const room = await findRoom(req.params.id)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    res.json({
      room: {
        id: room.id,
        name: room.name,
        hasPassword: !!room.password_hash,
        isPublic: room.is_public !== false,
        hasAccessCode: !!room.access_code,
        accessCode: room.access_code || null,
        shortCode: room.short_code || null,
        ownerId: room.owner_id,
        createdAt: room.created_at,
      },
    })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

// 创建房间
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, password, maxUsers, isPublic, accessCode } = req.body
    if (!name) return res.status(400).json({ message: '请输入房间名称' })

    let passwordHash = null
    if (password) {
      passwordHash = await bcrypt.hash(password, 10)
    }

    const room = await db.createRoom({
      id: uuidv4(),
      name,
      passwordHash,
      maxUsers: maxUsers || 10,
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
      isPublic: isPublic !== false,
      accessCode: accessCode || null,
    })

    // 系统消息
    await db.createMessage({
      id: uuidv4(),
      roomId: room.id,
      type: 'system',
      content: `房间 "${name}" 已创建`,
      createdAt: new Date().toISOString(),
    })

    res.status(201).json({ room })
  } catch (err) {
    console.error('[Rooms] 创建失败:', err)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 加入房间（密码验证）
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const room = await findRoom(req.params.id)
    if (!room) return res.status(404).json({ message: '房间不存在' })

    // 私密房间检查 access_code
    if (room.is_public === false && room.access_code) {
      if (!req.body.accessCode) return res.status(403).json({ message: '请输入房间访问码' })
      if (req.body.accessCode !== room.access_code) return res.status(403).json({ message: '房间访问码错误' })
    }

    // 密码保护房间检查密码
    if (room.password_hash) {
      if (!req.body.password) return res.status(403).json({ message: '请输入房间密码' })
      const valid = await bcrypt.compare(req.body.password, room.password_hash)
      if (!valid) return res.status(403).json({ message: '房间密码错误' })
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

// 更新房间（仅房主）
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const room = await findRoom(req.params.id)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ message: '只有房主可以编辑房间' })
    }

    const { name, isPublic, accessCode } = req.body
    if (name !== undefined && (!name || !name.trim())) {
      return res.status(400).json({ message: '房间名称不能为空' })
    }

    const updateData = {}
    if (name !== undefined) updateData.name = name.trim()
    if (isPublic !== undefined) updateData.isPublic = isPublic
    if (accessCode !== undefined) updateData.accessCode = accessCode

    const updated = await db.updateRoom(req.params.id, updateData)
    if (!updated) return res.status(500).json({ message: '更新失败' })

    // 广播房间信息更新给房间内所有用户
    io.to(req.params.id).emit('room-info', {
      room: {
        id: updated.id,
        name: updated.name,
        hasPassword: !!updated.password_hash,
        isPublic: updated.is_public !== false,
        hasAccessCode: !!updated.access_code,
        accessCode: updated.access_code || null,
        shortCode: updated.short_code || null,
        ownerId: updated.owner_id,
        createdAt: updated.created_at,
      },
    })

    res.json({
      ok: true,
      room: {
        id: updated.id,
        name: updated.name,
        hasPassword: !!updated.password_hash,
        isPublic: updated.is_public !== false,
        hasAccessCode: !!updated.access_code,
        accessCode: updated.access_code || null,
        shortCode: updated.short_code || null,
        ownerId: updated.owner_id,
        createdAt: updated.created_at,
      },
    })
  } catch (err) {
    console.error('[Rooms] 更新失败:', err)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 删除房间（仅房主）
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const room = await findRoom(req.params.id)
    if (!room) return res.status(404).json({ message: '房间不存在' })
    if (room.owner_id !== req.user.id) {
      return res.status(403).json({ message: '只有房主可以删除房间' })
    }

    // 广播删除事件给房间内所有人，让他们离开
    io.to(req.params.id).emit('room-deleted', { roomId: req.params.id })
    // 断开房间内所有 socket 连接
    const sockets = await io.in(req.params.id).fetchSockets()
    sockets.forEach((s) => {
      s.leave(req.params.id)
      s.data.roomId = null
    })

    await db.deleteRoomById(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

// 获取房间消息历史
router.get('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const msgs = await db.getMessagesByRoomId(req.params.id, 50)
    const list = msgs.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      username: m.username,
      createdAt: m.created_at,
    }))
    res.json({ messages: list })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

  return router
}
