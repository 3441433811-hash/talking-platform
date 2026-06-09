# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

VoiceHub — 语音聊天 Web 应用，支持多人实时语音通话、屏幕共享、公屏消息、AI 对话。
前后端分离：React + Vite 前端，Node.js + Express + Socket.IO 后端，WebRTC 音视频传输，DeepSeek API 流式 AI。

## 启动方式

```bash
# 终端 1：后端（端口 3001）
cd server
cp .env.example .env   # 编辑填入 DeepSeek API Key
npm run dev            # node --watch src/index.js

# 终端 2：前端（端口 5173，代理 /api 和 /socket.io 到 3001）
cd client
npm run dev            # vite --host
```

无需数据库 — 数据存储在内存中，重启丢失。

## 架构

```
client/src/
├── App.jsx              # React Router（/ → /lobby → /room/:id）
├── pages/
│   ├── Login.jsx        # 登录/注册，毛玻璃深色 UI
│   ├── Lobby.jsx        # 房间大厅 → 创建/加入房间
│   └── Room.jsx         # 核心页面：三栏布局 + 底部控制栏
├── services/
│   ├── api.js           # axios REST 封装（JWT 自动附带）
│   ├── socket.js        # Socket.IO 客户端 + 事件发送函数
│   └── webrtc.js        # WebRTCManager 类（单例），Mesh 多人通话核心
├── hooks/
│   ├── useSocket.js     # Socket 连接 + 事件监听 → 转发到 Store 和 WebRTC
│   └── useWebRTC.js     # 封装 WebRTCManager，暴露 mic/speaker/screenShare 控制
└── store/useStore.js    # Zustand 全局状态
```

```
server/src/
├── index.js             # Express + Socket.IO 入口，连接处理
├── middleware/auth.js   # JWT 鉴权（REST 中间件 + Socket.IO 中间件）
├── routes/
│   ├── auth.js          # 注册/登录/me
│   └── rooms.js         # 房间 CRUD + 消息历史
└── socket/
    ├── signaling.js     # WebRTC 信令转发（offer/answer/ice/screen）
    └── chat.js          # 公屏消息广播 + AI 流式对话（SSE 解析）
```

## 核心数据流

### 语音通话（WebRTC Mesh）
1. `useSocket` 在 `user-joined` 时派发 `webrtc-user-joined` CustomEvent
2. `WebRTCManager._handleUserJoined` → 为每个新用户创建 `RTCPeerConnection` + Offer
3. 通过 Socket.IO `offer/answer/ice-candidate` 事件交换信令
4. 远程音轨到达 → `Audio` 元素播放；视频轨（屏幕共享）→ 回调给 React 绑定 `<video>`
5. 每个连接独立检测音量 → `onSpeaking` 回调更新 UI 说话状态

### AI 对话（流式）
1. 用户输入 `@AI xxx` → Socket.IO `ai-query` 事件
2. 服务端 `chat.js` 调用 OpenAI 兼容 API（`stream: true`），逐 chunk 解析 SSE
3. 通过 `ai-typing` → `ai-chunk`（逐字）→ `ai-done` 三个事件推送前端
4. 前端 Store 实时更新 `aiStreamContent`，Room 组件渲染打字机效果

## 关键约定

- **WebRTC STUN** 使用 Google 免费服务，无 TURN 服务器 → 同局域网或公网 IP 用户可直连，NAT 严格时可能失败
- **前后端代理**：Vite 配置 `/api` → `localhost:3001`，`/socket.io` → `localhost:3001`（含 WebSocket 升级）
- **用户认证**：JWT 存在 `localStorage`，axios 拦截器自动附带，Socket.IO 在 `auth.token` 中传递
- **`.env` 在 `.gitignore` 中**，模板文件 `.env.example` 不含真实 Key
- **AI 默认 DeepSeek**：`OPENAI_BASE_URL=https://api.deepseek.com/v1`，模型 `deepseek-chat`
- **房间数据**：REST API 和 Socket.IO 各自维护独立的内存存储，未统一

## 待完善

- [ ] 数据库持久化（当前内存存储，服务重启丢失）
- [ ] TURN 服务器（复杂 NAT 环境下 P2P 穿透失败时的中继）
- [ ] 图片/文件消息
- [ ] 房主管理（踢人、禁言）
- [ ] CI/CD 部署方案
