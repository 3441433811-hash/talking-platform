import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Lobby from './pages/Lobby'
import Room from './pages/Room'
import useStore from './store/useStore'

function ProtectedRoute({ children }) {
  const user = useStore((s) => s.user)
  const token = localStorage.getItem('token')
  if (!user && !token) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/lobby" element={
          <ProtectedRoute><Lobby /></ProtectedRoute>
        } />
        <Route path="/room/:id" element={
          <ProtectedRoute><Room /></ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
