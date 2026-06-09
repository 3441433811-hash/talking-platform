// 数据模型 — 预留数据库迁移接口
// 当前使用内存存储，后续替换为 PostgreSQL/MongoDB

const users = []
const rooms = []
const messages = []

module.exports = { users, rooms, messages }
