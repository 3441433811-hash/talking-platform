// 可复用的主布局组件（预留给后续使用）
export default function Layout({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 50%, #0a0a1a 100%)',
      color: '#e8e8f0',
    }}>
      {children}
    </div>
  )
}
