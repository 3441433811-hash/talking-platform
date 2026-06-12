const { Router } = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { authMiddleware, JWT_SECRET } = require('../middleware/auth')
const db = require('../db')

const router = Router()

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body
    if (!username || !email || !password) {
      return res.status(400).json({ message: '请填写所有字段' })
    }
    if (db.getUserByEmail(email)) {
      return res.status(400).json({ message: '该邮箱已注册' })
    }

    const hash = await bcrypt.hash(password, 10)
    const id = uuidv4()
    const createdAt = new Date().toISOString()
    const user = db.createUser({ id, username, email, passwordHash: hash, createdAt })

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
  } catch (err) {
    console.error('[Auth] 注册失败:', err)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = db.getUserByEmail(email)
    if (!user) return res.status(400).json({ message: '邮箱或密码错误' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(400).json({ message: '邮箱或密码错误' })

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
  } catch (err) {
    console.error('[Auth] 登录失败:', err)
    res.status(500).json({ message: '服务器错误' })
  }
})

// 当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.id)
  if (!user) return res.status(404).json({ message: '用户不存在' })
  res.json({ user: { id: user.id, username: user.username, email: user.email } })
})

module.exports = router
