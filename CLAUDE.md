# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

VoiceHub — 语音聊天 Web 应用，支持多人实时语音通话、屏幕共享、公屏消息、AI 文字/语音对话。
前后端分离：React + Vite 前端，Node.js + Express + Socket.IO 后端，WebRTC Mesh 音视频传输，DeepSeek API 流式 AI。

## 启动方式

```bash
# 终端 1：后端（端口 7897）
cd server
cp .env.example .env   # 编辑填入 DEEPSEEK_API_KEY，并确保 PORT=7897
npm run dev            # node --watch src/index.js

# 终端 2：前端（端口 5173，代理 /api 和 /socket.io 到 7897）
cd client
npm run dev            # vite
# 若 5173 被占用会自动换端口（5174, 5175...），代理目标不变
```

**构建和 Lint**：
```bash
cd client
npm run build          # vite build → dist/
npm run lint           # eslint .
npm run preview        # vite preview（预览构建产物）
```

**⚠️ `.env.example` 陷阱**：`.env.example` 中 `PORT=3001` 是模板默认值，实际开发**必须改为 `PORT=7897`**（与 `vite.config.js` 的 proxy target 一致），否则前端代理不到后端。

**无数据库** — 用户/房间/消息存储在内存中（`server/src/models/index.js` 导出 `users`/`rooms`/`messages` 数组），重启丢失。

**注意**：如果开发过程中杀死并重启了后端，所有已注册账号都会丢失，需重新注册。多次启动/停止可能导致旧进程残留端口（`netstat -ano | grep LISTENING`），需要手动 `taskkill` 清理。

## 架构

```
client/src/
├── App.jsx              # React Router（/ → /lobby → /room/:id）
├── pages/
│   ├── Login.jsx        # 登录/注册（邮箱+密码）
│   ├── Lobby.jsx        # 房间大厅 → 创建/加入房间
│   └── Room.jsx         # 核心页面：三栏布局 + 底部控制栏 + 语音AI
├── services/
│   ├── api.js           # axios REST（JWT 自动附带，baseURL: /api）
│   ├── socket.js        # Socket.IO 客户端 + 事件发送函数
│   └── webrtc.js        # WebRTCManager 单例，Mesh 通话 + 屏幕共享
├── hooks/
│   ├── useSocket.js     # Socket 连接 + 事件监听 → CustomEvent 转发 + Store 更新
│   └── useWebRTC.js     # 封装 WebRTCManager，mic/speaker/screenShare 控制
└── store/useStore.js    # Zustand 全局状态
```

```
server/src/
├── index.js             # Express + Socket.IO 入口，连接/房间管理
├── middleware/auth.js   # JWT 鉴权（REST + Socket.IO）
├── routes/
│   ├── auth.js          # 注册/登录/me（bcrypt + JWT）
│   └── rooms.js         # 房间 CRUD + 消息历史（内存存储）
├── socket/
│   ├── signaling.js     # WebRTC 信令转发（offer/answer/ice/screen）
│   └── chat.js          # 公屏消息 + AI 流式对话（DeepSeek SSE 解析）
├── models/index.js      # 内存数据存储（users/rooms/messages 数组）— 预留数据库迁移
└── services/ai.js       # AI 服务预留扩展接口（当前为空桩，AI 逻辑在 chat.js 中）
```

## 核心数据流

### 语音通话（WebRTC Mesh）
1. `useSocket` 在 `user-joined` 时派发 `webrtc-user-joined` CustomEvent
2. `WebRTCManager._handleUserJoined` → 创建 `RTCPeerConnection`（含本地音轨）→ createOffer → sendOffer
3. 接收方 `_handleOffer` → 创建 PC → setRemoteDescription → createAnswer → sendAnswer
4. Socket.IO 转发 `offer/answer/ice-candidate`；服务端广播至整个房间（忽略 targetId 参数）
5. 远程音轨到达 → `ontrack` → 创建 `Audio` 元素播放；音量检测 → `onSpeaking` 回调

### 屏幕共享（WebRTC 重协商）
**重要：屏幕共享使用同一个音频 PC 进行重协商，不是独立 PC。**

共享方：
1. `startScreenShare(onStop)` → `getDisplayMedia` 获取屏幕流
2. 遍历已有 PC：`pc.addTrack(videoTrack, stream)` 把视频轨加到现有连接
3. `pc.createOffer()` + `setLocalDescription(offer)` 触发重协商
4. 直接通过 `getSocket().emit('offer', { targetId, sdp })` 发送 offer
5. `videoTrack.onended` → `stopScreenShare()` + `onStop()` 回调（通知远端）

接收方：
1. `_handleOffer` → **复用已有 PC**（不销毁重建！），调用 `pc.setRemoteDescription(offer)` + `createAnswer()`
2. `ontrack` 触发（视频轨）→ `_showScreenVideo()` 创建原始 DOM `<video>` 挂载到 `document.body`
3. 同时通过 `onScreenShare` 回调更新 React 状态（Zustand `screenSharer`）
4. Room.jsx 主区域仅显示 `📺 XXX 正在共享屏幕` 占位文本，不渲染 React `<video>`

**屏幕共享视频渲染**：
- 视频由 `_showScreenVideo()` 直接创建原始 DOM `<video>` 元素，`position: fixed` + `transform: translate(-50%, -50%)` 居中
- 挂载到 `document.body`，完全脱离 React 管控，避免 React reconciliation 移除视频
- `_hideScreenVideo(peerId)` 清理：`srcObject = null` → `remove()`

**信令通知链路**：
- `useWebRTC(roomId)` 接收 `roomId` 参数
- 开始共享：`notifyScreenShareStart(roomId)` → socket → 服务端 → `screen-share-start`
- 停止共享：`notifyScreenShareStop(roomId)` → socket → 服务端 → `screen-share-stop`
- `startScreenShare(onStop)` 的 `onStop` 回调用于浏览器 UI 停止时的通知

### AI 对话（流式 + 语音）
- **文字**：用户输入 `@AI xxx` → Socket.IO `ai-query` → 服务端 `callAIStream` 逐 chunk 解析 SSE → `ai-typing`/`ai-chunk`/`ai-done`
- **语音**：`SpeechRecognition`（Web Speech API）→ 转文字 → `aiQuery()` 发送 → `ai-done` 时用 `SpeechSynthesis` 朗读
- AI 回复仅朗读由本地语音触发的（`voicePendingRef` 控制）

### Socket 连接生命周期
1. `useSocket(roomId)` → `connectSocket()` → `socket.connect()`
2. `connect` 事件 → `socket.emit('join-room', { roomId, userId })`
3. 服务端 `join-room` → `socket.join(roomId)` + 维护 `roomUsers` Map（roomId → Set\<socketId\>）→ 广播 `user-joined` / `user-list-update`
4. 离开/断开 → `handleLeaveRoom` → `socket.leave(roomId)` + 更新 `roomUsers` → 广播 `user-left` / `user-list-update`

## 关键约定

- **端口**：后端 `7897`，前端 Vite `5173`（被占则自动递增），代理 `/api` 和 `/socket.io` → `localhost:7897`。
  `.env.example` 中 `PORT=3001` 是模板默认值，**实际必须改为 7897**。
- **鉴权**：JWT 存 `localStorage`，axios 拦截器自动附带 `Authorization: Bearer`，Socket.IO 在 `auth.token` 传递
- **WebRTC**：STUN 用 Google 免费服务，无 TURN → 严格 NAT 可能失败
- **单例模式**：`WebRTCManager` 全局单例，通过 `createWebRTCManager`/`getWebRTCManager`/`destroyWebRTCManager` 管理
- **CustomEvent 桥接**：Socket 事件 → `useSocket.js` dispatch CustomEvent（`webrtc-*`）→ `WebRTCManager` 监听处理。屏幕共享的 `webrtc-screen-start/stop` 也需 dispatch
- **屏幕共享**：将屏幕视频轨添加到**现有音频 PC**（不是独立 PC），通过 `pc.addTrack()` + `createOffer()` 触发重协商。接收方 `_handleOffer` **复用已有 PC** 处理重协商，不销毁重建
- **屏幕视频渲染**：原始 DOM `<video>` → `document.body`，React 只显示占位文本。**绝对不要**在 `[data-main-area]` 内追加视频或让 React 渲染 `<video>`，会导致 reconciliation 冲突或黑屏
- **`ontrack` 处理**：`event.streams` 在 Chrome renegotiation 场景下可能为空数组，必须降级处理：
  ```js
  const remoteStream = event.streams[0] || new MediaStream([event.track])
  ```
  切勿 `if (!remoteStream) return` 直接跳过 — 这会导致屏幕视频永远不渲染
- **屏幕视频 CSS**：必须设置 `min-width` 和 `min-height`，否则视频 track 元数据加载前元素高度塌陷为 0（只剩一条边框线）
- **成员去重**：`useStore.addMember` 和 `setMembers` 按 `id` 去重
- **音频持久化**：`micOnRef` / `speakerOnRef` 保持重连后开关状态
- **AI API**：DeepSeek（`OPENAI_BASE_URL=https://api.deepseek.com/v1`，模型 `deepseek-chat`），`.env` 在 `.gitignore` 中

## 常见问题排查

### 屏幕共享黑屏
1. **Console 检查 `ontrack` 日志**：确认 `[WebRTC] ontrack: VIDEO` 出现，并检查 `streamsCount` 和 `trackState`
2. 如果 `streamsCount: 0` → `event.streams` 为空，确认降级方案 `new MediaStream([event.track])` 已生效
3. 确认 `_handleOffer` 复用了已有 PC（检查 console 日志 `复用已有 PC 处理重协商`）
4. 检查视频元素是否在 `document.body` 下且 `position: fixed` 未被遮挡
5. 确认视频 track `readyState === 'live'`（console 日志会输出）
6. 确认播放了：video 有 `muted` 属性且调用了 `play()`
7. 如果视频元素存在但高度为 0（只剩一条紫色边框线），说明 `min-height` 缺失

### 登录/注册"操作失败"
- 后端服务是否在 7897 端口运行
- Vite 代理是否正常（直接 `curl localhost:5173/api` 验证）
- 旧进程残留 → `netstat -ano | grep -E "517[0-9]|7897"` → `taskkill //F //PID xxx`
- 重启后端后用户数据丢失，需重新注册

### 端口冲突
```bash
# 查端口占用
netstat -ano | grep -E "517[0-9]|7897" | grep LISTENING
# 杀进程
taskkill //F //PID <PID>
```

### 前端代理不到后端（404 / ECONNREFUSED）
- 确认 `server/.env` 中 `PORT=7897`（不是 3001）
- 确认 Vite dev server 的 proxy target 是 `http://localhost:7897`

### 移动端 / 局域网访问
- **音频输出**：手机浏览器阻止自动播放，需先点击页面解锁 AudioContext
- **麦克风**：移动端访问局域网 IP（`http://192.168.x.x`）不是安全上下文，`getUserMedia` 会被拒绝 → 需 HTTPS 或 localhost
- **外网隧道**：localtunnel、Cloudflare Tunnel、serveo、localhost.run 在国内均被 GFW 拦截（400 Bad Request），需自备 VPS 中转
- **Vercel**：OAuth 页面在国内无法打开，需梯子

## 待完善

- [ ] 数据库持久化
- [ ] TURN 服务器
- [ ] 屏幕共享视频自适应窗口大小（当前固定 70vw 居中，未处理侧栏响应式变化）
- [ ] 移动端 HTTPS 支持（mkcert / 正式证书）
- [ ] 图片/文件消息
- [ ] 房主管理（踢人、禁言）
- [ ] `.env.example` 端口改为 7897
