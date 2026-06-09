const { Router } = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const { authMiddleware, JWT_SECRET } = require('../middleware/auth')

const router = Router()

// 简易内存用户存储（后续替换为数据库）
const users = []

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body
    if (!username || !email || !password) {
      return res.status(400).json({ message: '请填写所有字段' })
    }
    if (users.find((u) => u.email === email)) {
      return res.status(400).json({ message: '该邮箱已注册' })
    }

    const hash = await bcrypt.hash(password, 10)
    const user = { id: uuidv4(), username, email, password: hash, createdAt: new Date() }
    users.push(user)

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

// 登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = users.find((u) => u.email === email)
    if (!user) return res.status(400).json({ message: '邮箱或密码错误' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(400).json({ message: '邮箱或密码错误' })

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' })
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } })
  } catch (err) {
    res.status(500).json({ message: '服务器错误' })
  }
})

// 当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  const user = users.find((u) => u.id === req.user.id)
  if (!user) return res.status(404).json({ message: '用户不存在' })
  res.json({ user: { id: user.id, username: user.username, email: user.email } })
})

module.exports = router
