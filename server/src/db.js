// SQLite 持久化层 — 替代内存数组存储
// 使用 better-sqlite3（同步 API，简单可靠）

const Database = require('better-sqlite3')
const path = require('path')

let db = null

function init(dbPath) {
  const resolvedPath = dbPath || path.join(__dirname, '..', 'voicehub.db')
  db = new Database(resolvedPath)

  // 开启 WAL 模式，支持并发读
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // 建表
  db.exec(`
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
  `)

  console.log('[DB] SQLite 已初始化:', resolvedPath)
  return db
}

function getDb() {
  if (!db) throw new Error('DB 未初始化，请先调用 init()')
  return db
}

// ==================== Users ====================

function createUser({ id, username, email, passwordHash, createdAt }) {
  const stmt = getDb().prepare(
    'INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  stmt.run(id, username, email, passwordHash, createdAt)
  return { id, username, email, createdAt }
}

function getUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(email) || null
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null
}

// ==================== Rooms ====================

function createRoom({ id, name, passwordHash, maxUsers, ownerId, createdAt }) {
  const stmt = getDb().prepare(
    'INSERT INTO rooms (id, name, password_hash, max_users, owner_id, member_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  )
  stmt.run(id, name, passwordHash || null, maxUsers || 10, ownerId, createdAt)
  return { id, name, hasPassword: !!passwordHash, maxUsers: maxUsers || 10, ownerId, memberCount: 0, createdAt }
}

function getRoomById(id) {
  return getDb().prepare('SELECT * FROM rooms WHERE id = ?').get(id) || null
}

function getAllRooms() {
  return getDb().prepare('SELECT * FROM rooms ORDER BY created_at DESC').all()
}

function deleteRoomById(id) {
  return getDb().prepare('DELETE FROM rooms WHERE id = ?').run(id)
}

function incrementMemberCount(roomId) {
  getDb().prepare('UPDATE rooms SET member_count = member_count + 1 WHERE id = ?').run(roomId)
}

function decrementMemberCount(roomId) {
  getDb().prepare('UPDATE rooms SET member_count = MAX(0, member_count - 1) WHERE id = ?').run(roomId)
}

// ==================== Messages ====================

function createMessage({ id, roomId, userId, username, type, content, createdAt }) {
  const stmt = getDb().prepare(
    'INSERT INTO messages (id, room_id, user_id, username, type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  stmt.run(id, roomId, userId || null, username || null, type || 'text', content, createdAt)
  return { id, roomId, userId, username, type, content, createdAt }
}

function getMessagesByRoomId(roomId, limit = 50) {
  return getDb()
    .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(roomId, limit)
    .reverse()
}

// ==================== AI Context ====================

function getAIContext(roomId) {
  const row = getDb().prepare('SELECT messages_json FROM ai_context WHERE room_id = ?').get(roomId)
  return row ? JSON.parse(row.messages_json) : null
}

function setAIContext(roomId, messages) {
  const stmt = getDb().prepare(
    'INSERT OR REPLACE INTO ai_context (room_id, messages_json) VALUES (?, ?)'
  )
  stmt.run(roomId, JSON.stringify(messages))
}

function deleteAIContext(roomId) {
  getDb().prepare('DELETE FROM ai_context WHERE room_id = ?').run(roomId)
}

// ==================== 关闭 ====================

function close() {
  if (db) {
    db.close()
    db = null
  }
}

module.exports = {
  init,
  getDb,
  close,
  // users
  createUser,
  getUserByEmail,
  getUserById,
  // rooms
  createRoom,
  getRoomById,
  getAllRooms,
  deleteRoomById,
  incrementMemberCount,
  decrementMemberCount,
  // messages
  createMessage,
  getMessagesByRoomId,
  // ai context
  getAIContext,
  setAIContext,
  deleteAIContext,
}
