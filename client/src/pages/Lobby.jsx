import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRooms, createRoom, getMe, joinRoom } from '../services/api'
import useStore from '../store/useStore'

export default function Lobby() {
  const { user, setUser, rooms, setRooms } = useStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newRoom, setNewRoom] = useState({ name: '', password: '', maxUsers: 10, isPublic: true, accessCode: '' })
  const [joinModal, setJoinModal] = useState(null)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [showDirectJoin, setShowDirectJoin] = useState(false)
  const [directRoomId, setDirectRoomId] = useState('')
  const [directCode, setDirectCode] = useState('')
  const [directError, setDirectError] = useState('')
  const navigate = useNavigate()

  // 记住已通过验证的房间密码/访问码
  const getSavedCodes = () => {
    try { return JSON.parse(localStorage.getItem('room_codes') || '{}') } catch (_) { return {} }
  }
  const saveRoomCode = (roomId, code) => {
    const codes = getSavedCodes()
    codes[roomId] = code
    localStorage.setItem('room_codes', JSON.stringify(codes))
  }

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

  const handleRoomClick = (room) => {
    if (room.hasPassword || (!room.isPublic && room.hasAccessCode)) {
      // 检查是否已保存过密码
      const saved = getSavedCodes()[room.id]
      if (saved) {
        navigate(`/room/${room.id}`, { state: { code: saved } })
      } else {
        setJoinModal(room)
        setJoinCode('')
        setJoinError('')
      }
    } else {
      navigate(`/room/${room.id}`)
    }
  }

  const handleJoinSubmit = async (e) => {
    e.preventDefault()
    if (!joinCode.trim()) return
    try {
      // hasPassword 房间用 password，access_code 房间用 accessCode
      const body = joinModal.hasPassword
        ? { password: joinCode }
        : { accessCode: joinCode }
      await joinRoom(joinModal.id, body)
      saveRoomCode(joinModal.id, joinCode)
      navigate(`/room/${joinModal.id}`, { state: { code: joinCode } })
    } catch (err) {
      setJoinError(err.response?.data?.message || '验证失败')
    }
  }

  const handleDirectJoin = async (e) => {
    e.preventDefault()
    const id = directRoomId.trim()
    const code = directCode.trim()
    if (!id) return setDirectError('请输入房间 ID')
    try {
      await joinRoom(id, { accessCode: code, password: code })
      saveRoomCode(id, code)
      navigate(`/room/${id}`, { state: { code } })
    } catch (err) {
      setDirectError(err.response?.data?.message || '加入失败，请检查 ID 和访问码')
    }
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
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={styles.createBtn} onClick={() => { setShowCreate(!showCreate); setShowDirectJoin(false) }}>
              + 创建房间
            </button>
            <button style={styles.directJoinBtn} onClick={() => { setShowDirectJoin(!showDirectJoin); setShowCreate(false); setDirectError('') }}>
              🔒 加入私密房间
            </button>
          </div>
        </div>

        {/* 加入私密房间表单 */}
        {showDirectJoin && (
          <form style={styles.createForm} onSubmit={handleDirectJoin}>
            <input style={styles.input} placeholder="房间短码 (如 ABC123)" value={directRoomId}
              onChange={(e) => { setDirectRoomId(e.target.value); setDirectError('') }} />
            <input style={styles.input} placeholder="访问码（如有）" value={directCode}
              onChange={(e) => { setDirectCode(e.target.value); setDirectError('') }} />
            <button type="submit" style={styles.submitBtn}>加入</button>
            {directError && <p style={styles.error}>{directError}</p>}
          </form>
        )}

        {/* 创建房间表单 */}
        {showCreate && (
          <form style={styles.createForm} onSubmit={handleCreate}>
            <input style={styles.input} placeholder="房间名称" required
              value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} />
            <div style={styles.toggleRow}>
              <label style={styles.toggleLabel}>
                <input type="checkbox" checked={!newRoom.isPublic}
                  onChange={(e) => setNewRoom({ ...newRoom, isPublic: !e.target.checked })} />
                🔒 私密房间
              </label>
            </div>
            {!newRoom.isPublic && (
              <input style={styles.input} placeholder="访问码（可选，留空则无需码）"
                value={newRoom.accessCode} onChange={(e) => setNewRoom({ ...newRoom, accessCode: e.target.value })} />
            )}
            <input style={styles.input} placeholder="密码（可选）"
              value={newRoom.password} onChange={(e) => setNewRoom({ ...newRoom, password: e.target.value })} />
            <button type="submit" style={styles.submitBtn}>创建</button>
          </form>
        )}

        {/* 房间列表 */}
        <div style={styles.roomGrid}>
          {rooms.map((room) => (
            <div key={room.id} style={styles.roomCard} onClick={() => handleRoomClick(room)}>
              <div style={styles.roomCardHeader}>
                <h3>{room.name}</h3>
                {(!room.isPublic || room.hasAccessCode) && <span style={styles.lock}>🔒</span>}
              </div>
              <p>👥 {room.memberCount || 0} 人在线</p>
              {!room.isPublic && <span style={styles.privateTag}>私密</span>}
            </div>
          ))}
          {rooms.length === 0 && <p style={styles.empty}>暂无房间，点击上方按钮创建一个吧</p>}
        </div>

        {/* 私密房间加入弹窗 */}
        {joinModal && (
          <div style={styles.modalOverlay} onClick={() => setJoinModal(null)}>
            <form style={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleJoinSubmit}>
              <h3>{joinModal.hasPassword ? '🔒 需要密码' : '🔒 加入私密房间'}</h3>
              <p style={styles.modalRoomName}>{joinModal.name}</p>
              <input style={styles.input} placeholder={joinModal.hasPassword ? '输入房间密码' : '输入房间访问码'} autoFocus
                value={joinCode} onChange={(e) => { setJoinCode(e.target.value); setJoinError('') }} />
              {joinError && <p style={styles.error}>{joinError}</p>}
              <div style={styles.modalBtns}>
                <button type="button" style={styles.modalCancelBtn} onClick={() => setJoinModal(null)}>取消</button>
                <button type="submit" style={styles.submitBtn}>加入</button>
              </div>
            </form>
          </div>
        )}
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
  directJoinBtn: { padding: '10px 24px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: '#e8e8f0', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  createForm: { display: 'flex', gap: 12, marginBottom: 24, padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  input: { flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none' },
  submitBtn: { padding: '10px 20px', borderRadius: 8, border: 'none', background: '#6c63ff', color: '#fff', cursor: 'pointer' },
  roomGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 },
  roomCard: { padding: 24, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, cursor: 'pointer', transition: 'all 0.2s' },
  roomCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  lock: { fontSize: 16, color: '#ffc048' },
  privateTag: { fontSize: 11, color: '#ff6b6b', background: 'rgba(255,107,107,0.1)', padding: '2px 8px', borderRadius: 4 },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  toggleLabel: { fontSize: 13, color: '#a0a0b8', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1a1a3e', borderRadius: 16, padding: 28, width: 360, border: '1px solid rgba(255,255,255,0.1)' },
  modalRoomName: { color: '#6c63ff', fontSize: 16, fontWeight: 600, marginBottom: 16, marginTop: 4 },
  modalBtns: { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 },
  modalCancelBtn: { padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#a0a0b8', cursor: 'pointer' },
  error: { color: '#ff4757', fontSize: 13, marginTop: 8 },
  empty: { color: '#6b6b80', textAlign: 'center', gridColumn: '1/-1', padding: 60 },
}
