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

## 启动方式

```bash
# 终端 1：后端（端口 7897）
cd server
cp .env.example .env   # 编辑填入 DEEPSEEK_API_KEY 和 DATABASE_URL，PORT=7897
npm run dev            # node --watch src/index.js

# 终端 2：前端（端口 5173，代理 /api 和 /socket.io 到 7897）
cd client
npm run dev            # vite
```

**本地开发需要 PostgreSQL**：在 `server/.env` 中设 `DATABASE_URL`（可用 Neon 开发分支或本地 PG）。
如果需要免数据库开发，设置 `DATABASE_URL=skip` 会导致启动失败；临时可注释 `db.init()` 回退到内存模式。

**构建和 Lint**：
```bash
cd client
npm run build          # vite build → dist/
npm run lint           # eslint .
```

## 架构

```
client/src/
├── App.jsx              # React Router（/ → /lobby → /room/:id）
├── pages/
│   ├── Login.jsx        # 登录/注册（邮箱+密码）
│   ├── Lobby.jsx        # 房间大厅 → 创建/加入房间
│   └── Room.jsx         # 核心页面：三栏布局 + 底部控制栏 + 语音AI
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
├── index.js             # Express + Socket.IO 入口，初始化 DB，房间/连接管理
├── db.js                # PostgreSQL 持久化层（pg），CRUD: users/rooms/messages/ai_context
├── middleware/auth.js   # JWT 鉴权（REST + Socket.IO）
├── routes/
│   ├── auth.js          # 注册/登录/me（bcrypt + JWT + db.js）
│   └── rooms.js         # 房间 CRUD + 消息历史（db.js）
├── socket/
│   ├── signaling.js     # WebRTC 信令转发（offer/answer/ice/screen）
│   └── chat.js          # 公屏消息 + AI 流式对话（DeepSeek SSE 解析）+ db.js 持久化
└── models/index.js      # 遗留文件，已不再使用（数据已迁移到 db.js → Neon PG）
```

**数据持久化**：所有数据通过 `server/src/db.js` 存入 Neon PostgreSQL。`models/index.js` 的内存数组已被废弃。`ai_context` 表存储 AI 对话上下文，重启不丢。

## 核心数据流

### 语音通话（WebRTC Mesh）
1. `useSocket` 在 `user-joined` 时派发 `webrtc-user-joined` CustomEvent
2. `WebRTCManager._handleUserJoined` → 创建 `RTCPeerConnection`（含本地音轨）→ createOffer → sendOffer
3. 接收方 `_handleOffer` → 创建 PC → setRemoteDescription → createAnswer → sendAnswer
4. Socket.IO 转发 `offer/answer/ice-candidate`；服务端广播至整个房间
5. 远程音轨到达 → `ontrack` → `onRemoteStream` 回调 → `useWebRTC.js` 创建 `<audio>` 元素播放

### 屏幕共享（WebRTC 重协商）
**重要：屏幕共享使用同一个音频 PC 进行重协商，不是独立 PC。**

共享方：
1. `startScreenShare(onStop)` → `getDisplayMedia` 获取屏幕流
2. 遍历已有 PC：`pc.addTrack(videoTrack, stream)` 把视频轨加到现有连接
3. `pc.createOffer()` + `setLocalDescription(offer)` 触发重协商

接收方：
1. `_handleOffer` → **复用已有 PC**（不销毁重建！）
2. `ontrack` 触发（视频轨）→ `_showScreenVideo()` 创建原始 DOM `<video>` 挂载到 `document.body`（`position: fixed` 居中）
3. React 主区域仅显示 `📺 XXX 正在共享屏幕` 占位文本

### AI 对话（流式 + 语音）
- **文字**：`@AI xxx` → Socket.IO `ai-query` → 服务端 `callAIStream` 逐 chunk 解析 SSE
- **语音**：`SpeechRecognition`（Web Speech API）→ 转文字 → `aiQuery()` → `ai-done` 时 `SpeechSynthesis` 朗读
- AI 回复仅朗读本地语音触发的（`voicePendingRef` 控制）

## 关键约定

### WebRTC / 音视频
- **信令顺序**：`start()` **必须先注册 `window.addEventListener('webrtc-*')`，再调用 `getUserMedia`**。如果顺序反了，移动端 `getUserMedia` 失败会导致事件监听器永不注册，远程 offer/screen 全部丢失。
- **移动端麦克风**：`start()` 检测 `isTouchDevice`，移动端**跳过**初始 `getUserMedia`。麦克风由用户点击按钮时通过 `retryMic()` 获取。`retryMic()` 必须在 user gesture 回调中**同步**调用 `navigator.mediaDevices.getUserMedia()`（不能用 async IIFE 包裹，否则 iOS/Android 手势令牌丢失）。
- **音频播放**：远程音频用 `<audio>` 元素 + `srcObject` 播放（兼容所有手机浏览器）。不用 Web Audio API 做输出 — iOS Safari 中 `MediaStreamSource` 从远程 WebRTC 流无法出声。`flushAudios()` 在每次 click/touch 时重试播放。
- **屏幕视频渲染**：原始 DOM `<video>` → `document.body`，`opacity: 0` → `loadedmetadata` → `opacity: 1`。**绝对不要**在 React JSX 中渲染 `<video>` 或用 `width` 固定宽度。
- **`ontrack` 降级**：`event.streams[0] || new MediaStream([event.track])`，切勿跳过空 streams。
- **TURN**: `client/src/services/webrtc.js` 中 ICE_SERVERS 含 Google STUN + Metered.ca + Twilio TURN。

### 数据 / API
- **鉴权**：JWT 存 `localStorage`，axios 拦截器自动附带 `Authorization: Bearer`，Socket.IO 在 `auth.token` 传递
- **api.js / socket.js**：生产环境用 `import.meta.env.VITE_API_URL` 指向 Render 后端；本地开发为空，走 Vite proxy
- **数据库**：所有 CRUD 通过 `server/src/db.js`（`pg` 模块）。函数均为 async，调用方必须 `await`。表：`users`, `rooms`, `messages`, `ai_context`

### 其他
- **单例模式**：`WebRTCManager` 全局单例，`createWebRTCManager`/`getWebRTCManager`/`destroyWebRTCManager`
- **CustomEvent 桥接**：Socket 事件 → `useSocket.js` dispatch CustomEvent → `WebRTCManager` 监听
- **成员去重**：`useStore.addMember` / `setMembers` 按 `id` 去重
- **AI API**：DeepSeek（`OPENAI_BASE_URL=https://api.deepseek.com/v1`，模型 `deepseek-chat`）

## 常见问题排查

### 移动端听不到声音
1. 确认底部 🔗 数字 > 0（WebRTC 连接已建立）— 如果为 0，检查 `start()` 中信令监听是否先于 `getUserMedia` 注册
2. 点一下屏幕任意位置 → `flushAudios()` 触发 `audio.play()`
3. 确认扬声器未静音（底部 🔊 按钮）
4. Android：检查 Chrome 站点设置中麦克风权限

### 移动端麦克风不工作
1. 底部按钮初始为 🔇，**点一下**请求权限 → 允许后变 🎤
2. Android Chrome：地址栏 🔒 → 权限 → 麦克风 → 允许
3. 确认 `start()` 移动端跳过了初始 `getUserMedia`（console 日志 "移动端：跳过初始麦克风获取"）

### 屏幕共享黑屏/黑杠
1. Console 检查 `[WebRTC] ontrack: VIDEO` 日志
2. 确认 `_handleOffer` 复用已有 PC（日志 "复用已有 PC 处理重协商"）
3. 黑色横杠 = CSS `width` 固定宽度改为 `max-width: 70vw` + `max-height: 75vh`

### 本地开发后端连接失败
- `server/.env` 中 `PORT=7897`（不是 3001）+ `DATABASE_URL` 指向 Neon PG
- 端口残留：`netstat -ano | grep -E "517[0-9]|7897"` → `taskkill //F //PID xxx`
