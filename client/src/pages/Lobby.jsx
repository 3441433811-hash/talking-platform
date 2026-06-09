import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRooms, createRoom, getMe } from '../services/api'
import useStore from '../store/useStore'

export default function Lobby() {
  const { user, setUser, rooms, setRooms } = useStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newRoom, setNewRoom] = useState({ name: '', password: '', maxUsers: 10 })
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) {
      getMe().then((res) => setUser(res.data.user)).catch(() => navigate('/'))
    }
    fetchRooms()
  }, [])

  const fetchRooms = async () => {
    try {
      const res = await getRooms()
      setRooms(res.data.rooms)
    } catch (err) { console.error(err) }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const res = await createRoom(newRoom)
      navigate(`/room/${res.data.room.id}`)
    } catch (err) { console.error(err) }
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    setUser(null)
    navigate('/')
  }

  return (
    <div style={styles.container}>
      {/* 顶部 */}
      <header style={styles.header}>
        <h1 style={styles.logo}>🎙️ VoiceHub</h1>
        <div style={styles.userArea}>
          <span style={styles.username}>👤 {user?.username}</span>
          <button style={styles.logoutBtn} onClick={handleLogout}>退出</button>
        </div>
      </header>

      {/* 内容 */}
      <main style={styles.main}>
        <div style={styles.topBar}>
          <h2>房间大厅</h2>
          <button style={styles.createBtn} onClick={() => setShowCreate(!showCreate)}>
            + 创建房间
          </button>
        </div>

        {/* 创建房间表单 */}
        {showCreate && (
          <form style={styles.createForm} onSubmit={handleCreate}>
            <input style={styles.input} placeholder="房间名称" required
              value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} />
            <input style={styles.input} placeholder="密码（可选）"
              value={newRoom.password} onChange={(e) => setNewRoom({ ...newRoom, password: e.target.value })} />
            <button type="submit" style={styles.submitBtn}>创建</button>
          </form>
        )}

        {/* 房间列表 */}
        <div style={styles.roomGrid}>
          {rooms.map((room) => (
            <div key={room.id} style={styles.roomCard} onClick={() => navigate(`/room/${room.id}`)}>
              <h3>{room.name}</h3>
              <p>👥 {room.memberCount || 0} 人在线</p>
              {room.password && <span style={styles.lock}>🔒 密码保护</span>}
            </div>
          ))}
          {rooms.length === 0 && <p style={styles.empty}>暂无房间，点击上方按钮创建一个吧</p>}
        </div>
      </main>
    </div>
  )
}

const styles = {
  container: { minHeight: '100vh', background: 'linear-gradient(135deg, #0a0a1a, #1a1a3e)', color: '#e8e8f0' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 32px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  logo: { fontSize: 22, margin: 0 },
  userArea: { display: 'flex', alignItems: 'center', gap: 16 },
  username: { fontSize: 14, color: '#a0a0b8' },
  logoutBtn: { padding: '6px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#a0a0b8', cursor: 'pointer' },
  main: { maxWidth: 900, margin: '0 auto', padding: 32 },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  createBtn: { padding: '10px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #6c63ff, #3b82f6)', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  createForm: { display: 'flex', gap: 12, marginBottom: 24, padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  input: { flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none' },
  submitBtn: { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#6c63ff', color: '#fff', cursor: 'pointer' },
  roomGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
  roomCard: { padding: 24, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, cursor: 'pointer', transition: 'all 0.2s' },
  lock: { fontSize: 12, color: '#ffc048' },
  empty: { color: '#6b6b80', textAlign: 'center', gridColumn: '1/-1', padding: 60 },
}
