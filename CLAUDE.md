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
# 终端 1：后端
cd server
cp .env.example .env   # 编辑填入 DEEPSEEK_API_KEY，DATABASE_URL 可留空（自动用内存存储）
PORT=3001 node src/index.js   # 用 3001 而非 7897 — 7897 常被 verge-mihomo 占用
```

**本地开发无需 PostgreSQL**：`server/src/db.js` 已内置内存回退 — 如果 `DATABASE_URL` 未设置，自动使用内存数组存储（重启后数据丢失）。需要持久化时才设 `DATABASE_URL` 指向 Neon PG。

```bash
# 终端 2：前端（端口 5173，代理到后端端口）
cd client
# 先确认 vite.config.js 中 proxy target 与后端端口一致
npx vite --host            # --host 允许局域网访问（手机测试）
```

**构建和部署**：
```bash
cd client
npm run build              # vite build → dist/
npx vercel --prod --yes --force   # 从根目录部署，--force 清除构建缓存
npm run lint               # eslint .
```

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
│   └── Room.jsx         # 核心页面：桌面三栏 / 移动端单栏Tab切换 + 底部控制栏 + 语音AI
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

**⚠️ WebRTC Mesh Glare**：双方同时 `_handleUserJoined` 会导致双方都发 offer，signalingState 冲突 → `setRemoteDescription` 抛错 → ICE 虽然连通但 `ontrack` 永不触发（🔗>0 但没声音）。当前通过让双方都发 offer + catch 错误来容忍，不是完美方案。如需修复，应实现 polite/impolite 模式（user ID 小的一方回退自己的 offer）。

### 移动端响应式布局（Room.jsx）
- `isMobile = window.innerWidth < 768`，监听 resize
- 移动端：单栏 + 三个 Tab（👥 成员 / 🎙️ 通话 / 💬 聊天）+ 底部控制栏
- 桌面端：保持三栏布局不变
- `mobileTab` 状态控制当前显示面板

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
- **AudioContext 陷阱**：`_setupAudioAnalyser` 中 **绝不 `await audioContext.resume()`** — iOS/Android 上非手势上下文调用 `resume()` 可能永不 resolve。改为 `resume().catch(()=>{})` 然后检查 `state`，若仍 suspended 就 `return` 跳过 analyser 创建。说话检测非核心功能，不能因此阻塞音频。
- **retryMic() 非阻塞链**：`.then()` 回调不能是 `async`，内部不可 `await`。peer 重协商用 `.then().catch()` 链，确保 `setMicOn(true)` 在 `getUserMedia` 成功后立即触发。
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
- **Socket 重连**：`useSocket` 中 socket 已连接时需直接发 `join-room`（不能只依赖 `connect` 事件，刷新页面后它不触发）
- **数据库回退**：`server/src/db.js` — 无 `DATABASE_URL` 时自动用内存存储（`useMemory` 标志），所有 CRUD 函数均已适配双模式
- **useWebRTC 版本**：当前 `useWebRTC.js` 基于 commit `5183494`（micOn 默认 `true`，旧版 toggleMic 逻辑）。后续提交 `7a489f6` 将 micOn 改为 `false` 导致桌面端需点两次才能开麦，已回退。
- **Vercel 部署**：从项目根目录执行 `npx vercel --prod --yes --force`。`--force` 跳过构建缓存（修改未生效时必用）。vercel.json 在根目录，`buildCommand: cd client && npm install && npm run build`。

## 常见问题排查

### 🔗=0（WebRTC 连接未建立）
1. 确认 Socket.IO 已连接且 `join-room` 已发出 — 检查控制台 `[Socket] connected` 和 `[Socket] join-room` 日志
2. 刷新页面后 socket 可能已连接但 `connect` 事件不触发 → `useSocket.js` 现已加上 `socket.connected` 检查
3. 检查 `VITE_API_URL` 是否指向正确的后端（Vercel 环境变量已加密存储）

### 🔗>0 但听不到声音（ontrack 未触发）
1. 这通常是 **WebRTC Glare**：双方同时发 offer，`setRemoteDescription` 因 signalingState 冲突而失败
2. Console 检查 `[WebRTC] 设置远程描述失败` 错误
3. 当前通过 catch 容忍错误，ICE 连通但媒体轨道未协商。长远需 polite/impolite 模式

### 移动端听不到声音
1. 确认底部 🔗 数字 > 0
2. 点一下屏幕任意位置 → `flushAudios()` 触发 `audio.play()`
3. 确认扬声器未静音（底部 🔊 按钮）
4. Android：检查 Chrome 站点设置中麦克风权限

### 移动端麦克风不工作
1. `retryMic()` 仅在被调用时获取麦克风（移动端 `start()` 跳过初始 getUserMedia）
2. Android Chrome：地址栏 🔒 → 权限 → 麦克风 → 允许
3. 如果 `retryMic()` 返回 null：检查 console 是否有 `[WebRTC] 麦克风重试失败`，`NotAllowedError` 会弹窗提示
4. 当前 `useWebRTC.js` micOn 默认为 `true`，点一次关、再点一次才开（旧版逻辑）

### 屏幕共享黑屏/黑杠
1. Console 检查 `[WebRTC] ontrack: VIDEO` 日志
2. 确认 `_handleOffer` 复用已有 PC（日志 "复用已有 PC 处理重协商"）
3. 黑色横杠 = CSS `width` 固定宽度改为 `max-width: 70vw` + `max-height: 75vh`

### 本地开发后端连接失败
- 端口 7897 常被 `verge-mihomo.exe` 占用 → 改用其他端口（如 3001）
- `vite.config.js` proxy target 需与后端端口一致
- 端口残留：`netstat -ano | grep -E "517[0-9]|7897|3001"` → `taskkill //F //PID xxx`
- 无 DATABASE_URL 也可启动（自动用内存存储）
