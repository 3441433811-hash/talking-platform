# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

VoiceHub — 语音聊天 Web 应用，支持多人实时语音通话、屏幕共享、公屏消息、AI 文字/语音对话。
前后端分离：React + Vite 前端，Node.js + Express + Socket.IO 后端，WebRTC Mesh 音视频传输，DeepSeek API 流式 AI。

## 生产部署

| 组件 | 平台 | URL |
|------|------|-----|
| 前端 | Vercel | `https://voicehub-lake.vercel.app` |
| 后端 | Render | `https://talking-platform.onrender.com` |
| 数据库 | Neon (PostgreSQL) | 见 Render 环境变量 `DATABASE_URL` |
| TURN | Metered.ca + Twilio | 免费中继 |

- **GitHub Actions** `.github/workflows/keepalive.yml` 每 5 分钟 ping Render，防止免费实例休眠
- 前端 `VITE_API_URL` 指向 Render 后端；本地开发为空字符串，走 Vite proxy
- Render 自动部署（GitHub push → main）；Vercel 手动部署 `npx vercel --prod --yes --force`

## 启动方式

```bash
# 终端 1：后端
cd server
cp .env.example .env   # 编辑填入 OPENAI_API_KEY，DATABASE_URL 可留空（自动用内存存储）
PORT=3001 node src/index.js   # 用 3001 而非 7897 — 7897 常被 verge-mihomo 占用

# 终端 2：前端（端口 5173，代理到后端端口）
cd client
npx vite --host            # --host 允许局域网访问（手机测试）

# 构建和部署
cd client && npm run build      # vite build → dist/
npx vercel --prod --yes --force   # 从根目录部署，--force 跳过构建缓存
npm run lint               # eslint .
```

**本地开发无需 PostgreSQL**：`server/src/db.js` 已内置内存回退 — 如果 `DATABASE_URL` 未设置，自动使用内存数组存储（重启后数据丢失）。

## 架构

```
client/src/
├── App.jsx              # React Router（/ 登录 → /lobby 大厅 → /room/:id 房间）
├── pages/
│   ├── Login.jsx        # 登录/注册（邮箱+密码）
│   ├── Lobby.jsx        # 房间大厅 → 创建/加入房间
│   └── Room.jsx         # 核心页面：桌面三栏 / 移动端单栏Tab切换 + 底部控制栏 + 语音AI
├── components/
│   └── Layout.jsx       # 全局背景布局容器（深蓝渐变）
├── services/
│   ├── api.js           # axios REST（baseURL: import.meta.env.VITE_API_URL + '/api'）
│   ├── socket.js        # Socket.IO 客户端（连接地址同上）
│   └── webrtc.js        # WebRTCManager 单例，Mesh 通话 + 屏幕共享
├── hooks/
│   ├── useSocket.js     # Socket 连接 + 事件监听 → CustomEvent 转发 + Store 更新
│   └── useWebRTC.js     # 封装 WebRTCManager，音频播放/mic/speaker/screenShare
└── store/useStore.js    # Zustand 全局状态
```

```
server/src/
├── index.js             # Express + Socket.IO 入口，初始化 DB，房间/连接管理，join-room 访问控制
├── db.js                # PostgreSQL + 内存双模式持久化，表：users/rooms/messages/ai_context
├── middleware/auth.js   # JWT 鉴权（REST + Socket.IO）
├── routes/
│   ├── auth.js          # 注册/登录/me（bcrypt + JWT + db.js）
│   └── rooms.js         # 工厂函数 (io) => router，房间 CRUD + 消息历史
├── socket/
│   ├── signaling.js     # WebRTC 信令转发
│   └── chat.js          # 公屏消息 + AI 流式对话（DeepSeek SSE 解析）
└── services/ai.js       # 预留

server/                   # 根目录一次性脚本（均需 DATABASE_URL 环境变量）
├── backfill-codes.js     # 给旧房间补上 short_code
├── cleanup-rooms.js      # 删除生产数据库所有房间
└── reset-users.js        # 清空用户数据，创建测试账号 Alice/Bob（密码 123456）
```

**数据库表**：`users`, `rooms`（含 `is_public`, `access_code`, `short_code`, `password_hash`）, `messages`, `ai_context`
**routes/rooms.js** 是工厂函数 `(io) => router`，可在路由中通过 `io.to(roomId).emit(...)` 广播事件。

**Zustand Store 字段**（`useStore`）：`user`, `rooms[]`, `currentRoom`, `members[]`（含 `micMuted` 属性标记远端静音）, `messages[]`, `speakingUsers{}`, `screenSharer`, `aiEnabled`, `aiTyping`/`aiStreamId`/`aiStreamContent`（AI 流式状态）, `reset()`。

## 核心数据流

### 房间管理（编辑/公开私密/删除）

- **编辑名称**：PUT /:id → db.updateRoom → 广播 `room-info` 给房间所有人
- **公开/私密切换**：`is_public=false` 的房间不在大厅列表（`getAllRooms` 仅返回公开+房主自己的私密房间）；私密房间通过 `short_code` + `access_code` 加入
- **房间短码**：每个房间创建时自动生成 6 位短码（`short_code`），用于分享加入；API 支持短码查找房间
- **密码房间**：点击时弹出密码输入框，REST 验证 + socket join-room 双重校验 bcrypt 密码
- **删除房间**：级联删除 messages + ai_context，广播 `room-deleted` 踢出所有在线用户
- **记住密码**：验证通过后存入 localStorage `room_codes`，下次自动跳过弹窗；密码变更后自动清除

### Lobby 大厅流程
- 房间卡片：公开房间显示名称+人数，私密房间显示 🔒，"加入私密房间"面板支持短码+访问码直接加入
- 创建表单：名称 + 公开/私密切换 + 访问码（私密时）+ 密码（可选）
- `handleRoomClick`：检查 `hasPassword` / 私密 → 弹窗；已存密码 → 直接进入

### 语音通话（WebRTC Mesh）
1. `useSocket` 在 `user-joined` 时派发 `webrtc-user-joined` CustomEvent
2. `WebRTCManager._handleUserJoined` → 创建 `RTCPeerConnection`（含本地音轨）→ createOffer → sendOffer
3. 接收方 `_handleOffer` → 创建 PC → setRemoteDescription → createAnswer → sendAnswer
4. Socket.IO 转发 `offer/answer/ice-candidate`；服务端广播至整个房间
5. 远程音轨到达 → `ontrack` → `onRemoteStream` 回调 → `useWebRTC.js` 创建 `<audio>` 元素播放

**⚠️ WebRTC Mesh Glare**：双方同时发 offer 会冲突，当前 catch 容忍。长远需 polite/impolite 模式。

### 移动端响应式布局（Room.jsx）
- `isMobile = window.innerWidth < 768`，监听 resize
- 移动端：单栏 + 三个 Tab + 底部控制栏；桌面端：三栏布局

### 屏幕共享（WebRTC 重协商）
- 使用同一音频 PC 重协商，不是独立 PC
- 接收方 `ontrack` → 原始 DOM `<video>` 挂载 `document.body`（fixed 定位居中）
- **绝对不要**在 React JSX 中渲染 `<video>` 或用固定 width

### AI 对话（流式 + 语音）
- **文字**：`@AI xxx` → Socket.IO `ai-query` → 服务端 DeepSeek SSE 逐 chunk 解析
- **语音**：`SpeechRecognition`（Web Speech API）→ `aiQuery()` → `ai-done` 时 `SpeechSynthesis` 朗读

## 关键约定

### WebRTC / 音视频
- **信令顺序**：先注册 `window.addEventListener('webrtc-*')`，再调用 `getUserMedia`
- **移动端麦克风**：`start()` 检测 `isTouchDevice`，跳过初始 `getUserMedia`；`retryMic()` 必须在 user gesture 回调中**同步**调用
- **音频播放**：`<audio>` + `srcObject`（不用 Web Audio API 做输出）
- **AudioContext 陷阱**：绝不 `await audioContext.resume()`，改用 `resume().catch(()=>{})`
- **retryMic() 非阻塞链**：`.then()` 回调不能是 `async`，内部不可 `await`
- **麦克风开关循环**：关麦后再开麦，不能仅设 `track.enabled = true`（浏览器 sender 可能停滞）。需用 `sender.replaceTrack(null)` → `sender.replaceTrack(audioTrack)` 强制重启编码管道，再加 `toggleMic(true)` 双保险。参见 `retryMic()` 早期返回分支。
- **TURN**: ICE_SERVERS 含 Google STUN + Metered.ca + Twilio TURN

### 数据 / API
- **鉴权**：JWT 存 `localStorage`，axios 拦截器自动附带 `Authorization: Bearer`，Socket.IO 在 `auth.token` 传递
- **数据库**：所有 CRUD 通过 `server/src/db.js`，函数均为 async，调用方必须 `await`
- **数据库回退**：无 `DATABASE_URL` 时自动用内存存储（`useMemory` 标志），所有 CRUD 函数均已适配双模式

### Socket 事件
| 事件 | 方向 | 用途 |
|------|------|------|
| `join-room` | client→server | 加入房间，携带 `{ roomId, userId, code }`（code 用于密码/访问码验证） |
| `room-info` | server→client | 房间信息更新（编辑名称/设置后广播） |
| `room-deleted` | server→client | 房间被删除，客户端自动 reset + 跳转大厅 |
| `error-msg` | server→client | 错误消息（密码错误、房间不存在等） |

### 其他
- **单例模式**：`WebRTCManager` 全局单例；**CustomEvent 桥接**：Socket → CustomEvent → WebRTCManager
- **AI API**：DeepSeek（`OPENAI_BASE_URL=https://api.deepseek.com/v1`，模型 `deepseek-chat`）
- **Vercel 部署**：`npx vercel --prod --yes --force`，vercel.json 在根目录
- **useWebRTC**：`micOn` 默认 `true`（旧版逻辑，点一次关、再点一次开）

## 常见问题排查

### 房间相关
- **私密房间消失**：`getAllRooms(ownerId)` 公开房间+房主自己的私密房间可见；确认当前登录账号是否为房主
- **房间不存在**：使用短码而非完整 UUID 加入；确认房间未被删除
- **密码无效**：密码 bcrypt 验证在 REST 和 Socket 两层都有；错误密码会清除 localStorage 中的 `room_codes`

### 🔗=0（WebRTC 连接未建立）
1. 确认 Socket.IO 已连接且 `join-room` 已发出
2. 刷新页面后 `connect` 事件不触发 → `useSocket.js` 已加上 `socket.connected` 检查

### 🔗>0 但听不到声音
1. WebRTC Glare：双方同时发 offer → 长远需 polite/impolite 模式
2. 移动端：点屏幕触发 `flushAudios()`，确认扬声器未静音

### 本地开发后端连接失败
- 端口 7897 常被 `verge-mihomo.exe` 占用 → 改用 3001
- `vite.config.js` proxy target 需与后端端口一致
