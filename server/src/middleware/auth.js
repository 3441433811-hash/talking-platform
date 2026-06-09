const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'voicehub-dev-secret'

// Express REST API JWT 中间件
function authMiddleware(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录' })
  }
  try {
    const token = header.split(' ')[1]
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ message: 'Token 无效或已过期' })
  }
}

// Socket.IO 鉴权中间件
function setupSocketAuth(socket, next) {
  const token = socket.handshake.auth?.token
  if (!token) {
    return next(new Error('未登录'))
  }
  try {
    socket.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    next(new Error('Token 无效'))
  }
}

module.exports = { authMiddleware, setupSocketAuth, JWT_SECRET }
