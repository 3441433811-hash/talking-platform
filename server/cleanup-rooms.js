// 一次性脚本：连接生产数据库，删除所有房间
// 用法：DATABASE_URL="postgres://..." node cleanup-rooms.js

const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ 请设置 DATABASE_URL 环境变量')
  console.error('   Render Dashboard → talking-platform → Environment → DATABASE_URL')
  console.error('   然后运行: DATABASE_URL="postgres://..." node cleanup-rooms.js')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 })

async function main() {
  try {
    // 查看现有房间
    const { rows: rooms } = await pool.query('SELECT id, name, owner_id FROM rooms')
    console.log(`📋 找到 ${rooms.length} 个房间:`)
    rooms.forEach(r => console.log(`   - ${r.name} (id: ${r.id?.slice(0, 8)}, owner: ${r.owner_id?.slice(0, 8)})`))

    if (rooms.length === 0) {
      console.log('✅ 没有房间需要删除')
      await pool.end()
      return
    }

    // 级联删除
    const roomIds = rooms.map(r => r.id)
    for (const id of roomIds) {
      await pool.query('DELETE FROM messages WHERE room_id = $1', [id])
      await pool.query('DELETE FROM ai_context WHERE room_id = $1', [id])
      await pool.query('DELETE FROM rooms WHERE id = $1', [id])
    }

    console.log(`\n🗑️  已删除 ${rooms.length} 个房间（含消息和 AI 上下文）`)
    console.log('✅ 完成')
  } catch (err) {
    console.error('❌ 出错:', err.message)
  } finally {
    await pool.end()
  }
}

main()
