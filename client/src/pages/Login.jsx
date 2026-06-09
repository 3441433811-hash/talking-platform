import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register, getMe } from '../services/api'
import useStore from '../store/useStore'

export default function Login() {
  const [isRegister, setIsRegister] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setUser = useStore((s) => s.setUser)

  // 尝试自动登录
  useState(() => {
    const token = localStorage.getItem('token')
    if (token) {
      getMe()
        .then((res) => {
          setUser(res.data.user)
          navigate('/lobby')
        })
        .catch(() => localStorage.removeItem('token'))
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const fn = isRegister ? register : login
      const payload = isRegister
        ? { username: form.username, email: form.email, password: form.password }
        : { email: form.email, password: form.password }
      const res = await fn(payload)
      localStorage.setItem('token', res.data.token)
      setUser(res.data.user)
      navigate('/lobby')
    } catch (err) {
      setError(err.response?.data?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>🎙️ VoiceHub</h1>
        <p style={styles.subtitle}>{isRegister ? '创建账号' : '登录到语音聊天'}</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          {isRegister && (
            <input
              style={styles.input}
              placeholder="用户名"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          )}
          <input
            style={styles.input}
            type="email"
            placeholder="邮箱"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="密码"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={6}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>
        </form>
        <p style={styles.toggle} onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
        </p>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a0a1a 100%)',
  },
  card: {
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 20,
    padding: 48,
    width: 400,
    maxWidth: '90vw',
  },
  title: { color: '#fff', textAlign: 'center', marginBottom: 8, fontSize: 28 },
  subtitle: { color: '#a0a0b8', textAlign: 'center', marginBottom: 32, fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  input: {
    padding: '12px 16px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.05)',
    color: '#fff',
    fontSize: 16,
    outline: 'none',
  },
  btn: {
    padding: '14px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #6c63ff, #3b82f6)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  },
  error: { color: '#ff4757', fontSize: 14, textAlign: 'center' },
  toggle: { color: '#6c63ff', textAlign: 'center', marginTop: 20, cursor: 'pointer', fontSize: 14 },
}
