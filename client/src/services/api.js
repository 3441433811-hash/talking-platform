import axios from 'axios'

const BACKEND_URL = import.meta.env.VITE_API_URL || ''
const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  timeout: 10000,
})

// 请求拦截：自动附加 token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：处理 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

// Auth
export const register = (data) => api.post('/auth/register', data)
export const login = (data) => api.post('/auth/login', data)
export const getMe = () => api.get('/auth/me')

// Rooms
export const getRooms = () => api.get('/rooms')
export const getRoom = (id) => api.get(`/rooms/${id}`)
export const createRoom = (data) => api.post('/rooms', data)
export const updateRoom = (id, data) => api.put(`/rooms/${id}`, data)
export const deleteRoom = (id) => api.delete(`/rooms/${id}`)
export const joinRoom = (id, data) => api.post(`/rooms/${id}/join`, data)

// Messages
export const getMessages = (roomId) => api.get(`/rooms/${roomId}/messages`)

export default api
