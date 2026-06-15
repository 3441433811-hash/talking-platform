// PostgreSQL 持久化层 — 替代内存数组存储
// 使用 pg (node-postgres)，连接 Neon / Supabase / Railway PG 等

const { Pool } = require('pg')

let pool = null
let useMemory = false

// 内存回退
const memUsers = []
const memRooms = []
const memMessages = []
const memAIContext = new Map()

function init(databaseUrl) {
  const url = databaseUrl || process.env.DATABASE_URL
  if (!url) {
    console.warn('[DB] DATABASE_URL 未设置，使用内存存储（重启后数据丢失）')
    useMemory = true
    return Promise.resolve()
  }

  pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
  })

  // 启动时建表
  return pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT,
      max_users INTEGER DEFAULT 10,
      owner_id TEXT NOT NULL,
      member_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS access_code TEXT;
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS short_code TEXT;

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      type TEXT DEFAULT 'text',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

    CREATE TABLE IF NOT EXISTS ai_context (
      room_id TEXT PRIMARY KEY,
      messages_json TEXT NOT NULL
    );
  `).then(() => {
    console.log('[DB] PostgreSQL 已连接')
  }).catch((err) => {
    console.error('[DB] 连接失败:', err.message)
    throw err
  })
}

function getPool() {
  if (useMemory) return null
  if (!pool) throw new Error('DB 未初始化，请先调用 init()')
  return pool
}

// ==================== Users ====================

async function createUser({ id, username, email, passwordHash, createdAt }) {
  if (useMemory) {
    const user = { id, username, email, password_hash: passwordHash, created_at: createdAt }
    memUsers.push(user)
    return { id, username, email, createdAt }
  }
  await getPool().query(
    'INSERT INTO users (id, username, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
    [id, username, email, passwordHash, createdAt]
  )
  return { id, username, email, createdAt }
}

async function getUserByEmail(email) {
  if (useMemory) return memUsers.find(u => u.email === email) || null
  const res = await getPool().query('SELECT * FROM users WHERE email = $1', [email])
  return res.rows[0] || null
}

async function getUserById(id) {
  if (useMemory) return memUsers.find(u => u.id === id) || null
  const res = await getPool().query('SELECT * FROM users WHERE id = $1', [id])
  return res.rows[0] || null
}

function makeShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉容易混淆的 0/O/1/I
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

// ==================== Rooms ====================

async function createRoom({ id, name, passwordHash, maxUsers, ownerId, createdAt, isPublic, accessCode }) {
  const shortCode = makeShortCode()
  if (useMemory) {
    const room = { id, name, password_hash: passwordHash || null, max_users: maxUsers || 10, owner_id: ownerId, member_count: 0, created_at: createdAt, is_public: isPublic !== false, access_code: accessCode || null, short_code: shortCode }
    memRooms.push(room)
    return { id, name, hasPassword: !!passwordHash, maxUsers: maxUsers || 10, ownerId, memberCount: 0, createdAt, isPublic: room.is_public, hasAccessCode: !!accessCode, shortCode }
  }
  await getPool().query(
    'INSERT INTO rooms (id, name, password_hash, max_users, owner_id, member_count, created_at, is_public, access_code, short_code) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)',
    [id, name, passwordHash || null, maxUsers || 10, ownerId, createdAt, isPublic !== false, accessCode || null, shortCode]
  )
  return { id, name, hasPassword: !!passwordHash, maxUsers: maxUsers || 10, ownerId, memberCount: 0, createdAt, isPublic: isPublic !== false, hasAccessCode: !!accessCode, shortCode }
}

async function getRoomById(id) {
  if (useMemory) return memRooms.find(r => r.id === id) || null
  const res = await getPool().query('SELECT * FROM rooms WHERE id = $1', [id])
  return res.rows[0] || null
}

async function getRoomByShortCode(code) {
  if (useMemory) return memRooms.find(r => r.short_code === code) || null
  const res = await getPool().query('SELECT * FROM rooms WHERE short_code = $1', [code])
  return res.rows[0] || null
}

async function getAllRooms(ownerId) {
  if (useMemory) {
    return [...memRooms]
      .filter(r => r.is_public !== false || (ownerId && r.owner_id === ownerId))
      .reverse()
  }
  if (ownerId) {
    const res = await getPool().query(
      'SELECT * FROM rooms WHERE is_public IS NOT FALSE OR owner_id = $1 ORDER BY created_at DESC',
      [ownerId]
    )
    return res.rows
  }
  const res = await getPool().query('SELECT * FROM rooms WHERE is_public IS NOT FALSE ORDER BY created_at DESC')
  return res.rows
}

async function updateRoom(id, { name, isPublic, accessCode }) {
  if (useMemory) {
    const room = memRooms.find(r => r.id === id)
    if (!room) return null
    if (name !== undefined) room.name = name
    if (isPublic !== undefined) room.is_public = isPublic
    if (accessCode !== undefined) room.access_code = accessCode || null
    return {
      id: room.id,
      name: room.name,
      password_hash: room.password_hash,
      max_users: room.max_users,
      owner_id: room.owner_id,
      member_count: room.member_count,
      created_at: room.created_at,
      is_public: room.is_public,
      access_code: room.access_code,
    }
  }
  const setClauses = []
  const values = [id]
  let idx = 2
  if (name !== undefined) { setClauses.push(`name = $${idx++}`); values.push(name) }
  if (isPublic !== undefined) { setClauses.push(`is_public = $${idx++}`); values.push(isPublic) }
  if (accessCode !== undefined) { setClauses.push(`access_code = $${idx++}`); values.push(accessCode || null) }
  if (setClauses.length === 0) {
    const r = await getRoomById(id)
    return r ? { ...r } : null
  }
  const res = await getPool().query(
    `UPDATE rooms SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values
  )
  return res.rows[0] || null
}

async function deleteRoomById(id) {
  if (useMemory) {
    const idx = memRooms.findIndex(r => r.id === id)
    if (idx >= 0) memRooms.splice(idx, 1)
    // 级联删除消息和 AI 上下文
    for (let i = memMessages.length - 1; i >= 0; i--) {
      if (memMessages[i].room_id === id) memMessages.splice(i, 1)
    }
    memAIContext.delete(id)
    return
  }
  await getPool().query('DELETE FROM messages WHERE room_id = $1', [id])
  await getPool().query('DELETE FROM ai_context WHERE room_id = $1', [id])
  await getPool().query('DELETE FROM rooms WHERE id = $1', [id])
}

async function incrementMemberCount(roomId) {
  if (useMemory) {
    const room = memRooms.find(r => r.id === roomId)
    if (room) room.member_count++
    return
  }
  await getPool().query('UPDATE rooms SET member_count = member_count + 1 WHERE id = $1', [roomId])
}

async function decrementMemberCount(roomId) {
  if (useMemory) {
    const room = memRooms.find(r => r.id === roomId)
    if (room && room.member_count > 0) room.member_count--
    return
  }
  await getPool().query('UPDATE rooms SET member_count = GREATEST(0, member_count - 1) WHERE id = $1', [roomId])
}

// ==================== Messages ====================

async function createMessage({ id, roomId, userId, username, type, content, createdAt }) {
  if (useMemory) {
    const msg = { id, room_id: roomId, user_id: userId || null, username: username || null, type: type || 'text', content, created_at: createdAt }
    memMessages.push(msg)
    return { id, roomId, userId, username, type, content, createdAt }
  }
  await getPool().query(
    'INSERT INTO messages (id, room_id, user_id, username, type, content, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, roomId, userId || null, username || null, type || 'text', content, createdAt]
  )
  return { id, roomId, userId, username, type, content, createdAt }
}

async function getMessagesByRoomId(roomId, limit = 50) {
  if (useMemory) {
    return memMessages.filter(m => m.room_id === roomId).slice(-limit)
  }
  const res = await getPool().query(
    'SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2',
    [roomId, limit]
  )
  return res.rows.reverse()
}

// ==================== AI Context ====================

async function getAIContext(roomId) {
  if (useMemory) {
    const entry = memAIContext.get(roomId)
    return entry ? JSON.parse(entry) : null
  }
  const res = await getPool().query('SELECT messages_json FROM ai_context WHERE room_id = $1', [roomId])
  return res.rows[0] ? JSON.parse(res.rows[0].messages_json) : null
}

async function setAIContext(roomId, messages) {
  if (useMemory) {
    memAIContext.set(roomId, JSON.stringify(messages))
    return
  }
  await getPool().query(
    'INSERT INTO ai_context (room_id, messages_json) VALUES ($1, $2) ON CONFLICT (room_id) DO UPDATE SET messages_json = $2',
    [roomId, JSON.stringify(messages)]
  )
}

async function deleteAIContext(roomId) {
  if (useMemory) {
    memAIContext.delete(roomId)
    return
  }
  await getPool().query('DELETE FROM ai_context WHERE room_id = $1', [roomId])
}

// ==================== 关闭 ====================

async function close() {
  if (pool) {
    await pool.end()
    pool = null
  }
  if (useMemory) {
    memUsers.length = 0
    memRooms.length = 0
    memMessages.length = 0
    memAIContext.clear()
    useMemory = false
  }
}

module.exports = {
  init,
  getPool,
  close,
  createUser,
  getUserByEmail,
  getUserById,
  createRoom,
  getRoomById,
  getRoomByShortCode,
  getAllRooms,
  updateRoom,
  deleteRoomById,
  incrementMemberCount,
  decrementMemberCount,
  createMessage,
  getMessagesByRoomId,
  getAIContext,
  setAIContext,
  deleteAIContext,
}
