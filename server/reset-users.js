// 清理旧用户 + 创建两个新账号
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('❌ 请设置 DATABASE_URL')
  process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 })

async function main() {
  try {
    // 1. 列出旧用户
    const { rows: oldUsers } = await pool.query('SELECT id, username, email FROM users')
    console.log(`📋 找到 ${oldUsers.length} 个旧用户:`)
    oldUsers.forEach(u => console.log(`   - ${u.username} (${u.email})`))

    // 2. 级联删除
    if (oldUsers.length > 0) {
      await pool.query('DELETE FROM messages')
      await pool.query('DELETE FROM ai_context')
      await pool.query('DELETE FROM rooms')
      await pool.query('DELETE FROM users')
      console.log(`\n🗑️  已删除全部 ${oldUsers.length} 个用户及关联数据`)
    }

    // 3. 创建两个新账号
    const accounts = [
      { username: 'Alice', email: 'alice@voicehub.test', password: '123456' },
      { username: 'Bob', email: 'bob@voicehub.test', password: '123456' },
    ]

    for (const acc of accounts) {
      const hash = await bcrypt.hash(acc.password, 10)
      const id = uuidv4()
      const now = new Date().toISOString()
      await pool.query(
        'INSERT INTO users (id, username, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
        [id, acc.username, acc.email, hash, now]
      )
      console.log(`✅ 已创建: ${acc.username} / ${acc.email} / ${acc.password}`)
    }

    console.log('\n🎉 完成！现在可以用上面两个账号登录了')
  } catch (err) {
    console.error('❌ 出错:', err.message)
  } finally {
    await pool.end()
  }
}

main()
