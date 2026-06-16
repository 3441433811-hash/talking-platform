# VoiceHub 产品需求设计文档

> 版本: 1.0 | 更新日期: 2026-06-16

---

## 1. 产品概述

VoiceHub 是一款基于浏览器的实时语音聊天 Web 应用，支持多人语音通话、屏幕共享、公屏文字消息和 AI 语音/文字对话。无需安装客户端，打开浏览器即可使用。

**核心价值**：低延迟、零安装的多人语音协作空间，内置 AI 助手。

### 1.1 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React + Vite |
| 状态管理 | Zustand |
| 后端框架 | Node.js + Express |
| 实时通信 | Socket.IO |
| 音视频传输 | WebRTC (Mesh 架构) |
| 数据库 | PostgreSQL (Neon) + 内存回退 |
| AI 接口 | DeepSeek API (SSE 流式) |
| 部署 | Vercel (前端) + Render (后端) |

### 1.2 部署环境

| 组件 | 平台 | 地址 |
|------|------|------|
| 前端 | Vercel | `https://voicehub-lake.vercel.app` |
| 后端 | Render | `https://talking-platform.onrender.com` |
| 数据库 | Neon | PostgreSQL Serverless |
| TURN 中继 | Metered.ca + Twilio | 免费额度 |

---

## 2. 目标用户与使用场景

### 2.1 目标用户

- **远程协作团队** — 需要快速语音沟通，不想安装 Zoom/腾讯会议
- **在线教育** — 老师屏幕共享课件，学生语音提问
- **朋友闲聊** — 低门槛语音房间，分享链接即可加入
- **AI 辅助讨论** — 在语音讨论中随时 @AI 获取信息

### 2.2 典型使用场景

| 场景 | 流程 |
|------|------|
| 临时语音会议 | 创建房间 → 分享短码/链接 → 多人加入 → 语音通话 + 屏幕共享 |
| 私密讨论 | 创建私密房间 + 密码 → 仅持有密码者加入 |
| AI 问答 | @AI 提问 → 流式文字回复 → 语音朗读回复 |
| 移动端通话 | 手机浏览器打开 → 点击麦克风授权 → 加入语音 |

---

## 3. 功能需求

### 3.1 用户系统

| ID | 功能 | 描述 | 优先级 |
|----|------|------|--------|
| F-01 | 注册 | 邮箱 + 用户名 + 密码注册，密码 bcrypt 加密存储 | P0 |
| F-02 | 登录 | 邮箱 + 密码，返回 JWT token | P0 |
| F-03 | Token 鉴权 | JWT 存 localStorage，axios 拦截器自动携带，Socket.IO auth.token 传递 | P0 |
| F-04 | 会话持久 | 刷新页面后 JWT 仍有效，自动恢复登录态 | P1 |

### 3.2 房间管理

| ID | 功能 | 描述 | 优先级 |
|----|------|------|--------|
| F-05 | 创建房间 | 设置名称、公开/私密、访问码（私密时）、密码（可选） | P0 |
| F-06 | 房间大厅 | 公开房间列表显示名称+人数；私密房间仅房主可见 | P0 |
| F-07 | 房间短码 | 6 位字符短码替代 UUID，方便分享加入 | P1 |
| F-08 | 私密房间 | `is_public=false`，通过短码+访问码加入 | P0 |
| F-09 | 密码房间 | bcrypt 密码验证（REST + Socket 双重校验）；密码记忆 | P1 |
| F-10 | 编辑房间 | 修改名称、公开/私密切换 | P2 |
| F-11 | 删除房间 | 房主可删除，级联删除消息+AI上下文，广播踢出在线用户 | P1 |

### 3.3 实时语音通话

| ID | 功能 | 描述 | 优先级 |
|----|------|------|--------|
| F-12 | Mesh 多人通话 | 每个成员之间建立 P2P 连接，全双工音频 | P0 |
| F-13 | 麦克风开关 | 静音/取消静音，支持移动端手势触发获取麦克风 | P0 |
| F-14 | 扬声器开关 | 静音所有远程音频 | P1 |
| F-15 | 说话状态检测 | AudioContext AnalyserNode 实时音量检测，显示谁在说话 | P2 |
| F-16 | 连接状态显示 | UI 显示 WebRTC 连接数（🔗=N） | P1 |
| F-17 | 移动端适配 | iOS Safari / Android Chrome 兼容；触摸设备跳过初始 getUserMedia | P0 |

### 3.4 屏幕共享

| ID | 功能 | 描述 | 优先级 |
|----|------|------|--------|
| F-18 | 屏幕共享 | `getDisplayMedia` 获取屏幕流，通过已有音频 PC 重协商发送 | P1 |
| F-19 | 远程观看 | 接收端 ontrack → 创建 `<video>` 元素挂载 body（fixed 定位） | P1 |
| F-20 | 停止共享 | 浏览器 UI 关闭自动停止；手动按钮停止 | P1 |
| F-21 | 分辨率控制 | 最高 1920×1080，帧率 15fps，防止 TURN 带宽瓶颈 | P2 |

### 3.5 公屏消息

| ID | 功能 | 描述 | 优先级 |
|----|------|------|--------|
| F-22 | 文字消息 | 房间内实时文字聊天 | P1 |
| F-23 | 系统消息 | 加入/离开/屏幕共享开始停止等自动通知 | P1 |
| F-24 | 消息历史 | 存储在数据库，加入房间时加载最近消息 | P2 |

### 3.6 AI 对话

| ID | 功能 | 描述 | 优先级 |
|----|------|------|--------|
| F-25 | 文字 AI | `@AI <问题>` 触发，DeepSeek SSE 流式返回 | P2 |
| F-26 | 语音 AI | Web Speech API 语音识别 → AI 查询 → SpeechSynthesis 朗读回复 | P2 |
| F-27 | 上下文记忆 | AI 对话上下文存数据库，支持连续对话 | P3 |

---

## 4. 系统架构

### 4.1 架构图

```
┌──────────────────────────────────────────────────────┐
│                      客户端 (浏览器)                   │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  React UI │  │ Zustand  │  │  WebRTCManager     │  │
│  │  (页面/   │  │  Store   │  │  (Mesh P2P 通话)   │  │
│  │   组件)   │  │          │  │  - RTCPeerConnection│  │
│  └─────┬────┘  └────┬─────┘  │  - 屏幕共享重协商    │  │
│        │            │        └─────────┬──────────┘  │
│        │    ┌───────┴──────┐           │              │
│        └────►  CustomEvent  ◄───────────┘              │
│             │  (桥接层)     │                          │
│             └───────┬──────┘                          │
│                     │                                  │
│             ┌───────┴──────┐                          │
│             │   Socket.IO  │  ◄── REST API (axios) ── │
│             │   客户端       │                          │
│             └───────┬──────┘                          │
└─────────────────────┼────────────────────────────────┘
                      │ HTTPS / WSS
┌─────────────────────┼────────────────────────────────┐
│              服务端 (Render)                           │
│             ┌───────┴──────┐                          │
│             │   Socket.IO  │  ◄── Express 路由        │
│             │   服务器       │      (auth, rooms)       │
│             └───────┬──────┘                          │
│     ┌───────────────┼───────────────┐                 │
│     │               │               │                 │
│  ┌──┴──┐    ┌───────┴──────┐   ┌───┴────┐           │
│  │信令  │    │  聊天/AI     │   │ 鉴权   │           │
│  │转发  │    │  (DeepSeek)  │   │ (JWT)  │           │
│  └─────┘    └───────┬──────┘   └───┬────┘           │
│                     │               │                 │
│              ┌──────┴──────┐        │                 │
│              │    数据库    │◄───────┘                 │
│              │  (Neon PG)  │                          │
│              └─────────────┘                          │
└──────────────────────────────────────────────────────┘

                      WebRTC P2P (Mesh)
┌──────────────────────────────────────────────────────┐
│  客户端A ◄────────── 音视频 RTP ──────────► 客户端B   │
│  客户端A ◄────────── 音视频 RTP ──────────► 客户端C   │
│  客户端B ◄────────── 音视频 RTP ──────────► 客户端C   │
│              (通过 STUN/TURN 穿越 NAT)                │
└──────────────────────────────────────────────────────┘
```

### 4.2 前端架构

```
client/src/
├── App.jsx              # React Router (/ → /lobby → /room/:id)
├── pages/
│   ├── Login.jsx        # 登录/注册页面
│   ├── Lobby.jsx        # 房间大厅 — 房间列表 + 创建/加入
│   └── Room.jsx         # 核心页面 — 三栏布局/移动端Tab + 控制栏
├── components/
│   └── Layout.jsx       # 全局背景容器
├── services/
│   ├── api.js           # axios REST 客户端
│   ├── socket.js        # Socket.IO 客户端单例
│   └── webrtc.js        # WebRTCManager 单例 — Mesh通话+屏幕共享
├── hooks/
│   ├── useSocket.js     # Socket 连接 + 事件转发 (CustomEvent)
│   └── useWebRTC.js     # WebRTC 封装 — 音频播放/mic/speaker/screenShare
└── store/
    └── useStore.js      # Zustand 全局状态
```

**关键设计模式**：
- **单例模式**：`WebRTCManager`、Socket.IO 客户端全局唯一
- **CustomEvent 桥接**：Socket 事件 → CustomEvent → WebRTCManager 方法，解耦 Socket 层和 WebRTC 层
- **命令式 DOM**：屏幕共享 `<video>` 元素直接操作 DOM（挂载 document.body），避开 React reconciliation

### 4.3 后端架构

```
server/src/
├── index.js             # Express + Socket.IO 入口，房间/连接管理
├── db.js                # PostgreSQL + 内存双模式持久化
├── middleware/
│   └── auth.js          # JWT 鉴权中间件
├── routes/
│   ├── auth.js          # 注册/登录/me 接口
│   └── rooms.js         # 房间 CRUD + 消息历史（工厂函数 (io) => router）
├── socket/
│   ├── signaling.js     # WebRTC 信令转发 (offer/answer/ICE)
│   └── chat.js          # 公屏消息 + AI 流式对话
└── services/
    └── ai.js            # AI 服务预留
```

---

## 5. 数据模型

### 5.1 数据库表结构

#### users
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | VARCHAR | 用户名 |
| email | VARCHAR | 邮箱（唯一） |
| password_hash | VARCHAR | bcrypt 哈希 |
| created_at | TIMESTAMP | 注册时间 |

#### rooms
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR | 房间名称 |
| owner_id | UUID | 房主用户 ID |
| is_public | BOOLEAN | 是否公开（默认 true） |
| access_code | VARCHAR | 私密房间访问码 |
| short_code | VARCHAR(6) | 6 位房间短码 |
| password_hash | VARCHAR | 房间密码 bcrypt 哈希（可选） |
| created_at | TIMESTAMP | 创建时间 |

#### messages
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| room_id | UUID | 所属房间（外键） |
| user_id | UUID | 发送者（外键） |
| username | VARCHAR | 发送者用户名（冗余） |
| content | TEXT | 消息内容 |
| type | VARCHAR | 消息类型：text / system / ai |
| created_at | TIMESTAMP | 发送时间 |

#### ai_context
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| room_id | UUID | 所属房间（外键） |
| user_id | UUID | 查询者（外键） |
| role | VARCHAR | 角色：user / assistant |
| content | TEXT | 对话内容 |
| created_at | TIMESTAMP | 时间戳 |

### 5.2 前端状态模型 (Zustand Store)

```typescript
interface AppState {
  user: { id, username, email } | null
  rooms: Room[]
  currentRoom: Room | null
  members: Member[]           // 含 micMuted 属性标记远端静音
  messages: Message[]
  speakingUsers: Record<string, boolean>
  screenSharer: string | null
  aiEnabled: boolean
  aiTyping: boolean
  aiStreamId: string | null
  aiStreamContent: string
  reset(): void
}
```

---

## 6. API 设计

### 6.1 REST API

Base URL: `/api`

#### 认证

| 方法 | 路径 | 请求体 | 响应 | 鉴权 |
|------|------|--------|------|------|
| POST | `/auth/register` | `{ username, email, password }` | `{ token, user }` | 无 |
| POST | `/auth/login` | `{ email, password }` | `{ token, user }` | 无 |
| GET | `/auth/me` | - | `{ user }` | JWT |

#### 房间

| 方法 | 路径 | 请求体 | 响应 | 鉴权 |
|------|------|--------|------|------|
| GET | `/rooms` | - | `{ rooms[] }` | JWT |
| POST | `/rooms` | `{ name, is_public, access_code?, password? }` | `{ room }` | JWT |
| GET | `/rooms/:id` | - | `{ room }` | JWT |
| PUT | `/rooms/:id` | `{ name?, is_public? }` | `{ room }` | JWT (owner) |
| DELETE | `/rooms/:id` | - | `{ success }` | JWT (owner) |
| POST | `/rooms/:id/verify-password` | `{ password }` | `{ valid }` | JWT |
| POST | `/rooms/:id/messages` | `{ content, type }` | `{ message }` | JWT |
| GET | `/rooms/:id/messages` | `?limit=50` | `{ messages[] }` | JWT |

### 6.2 Socket.IO 事件

#### 客户端 → 服务端

| 事件 | 载荷 | 说明 |
|------|------|------|
| `join-room` | `{ roomId, userId, code? }` | 加入房间（code 用于密码/访问码验证） |
| `leave-room` | `{ roomId }` | 离开房间 |
| `offer` | `{ targetId, sdp }` | WebRTC Offer SDP |
| `answer` | `{ targetId, sdp }` | WebRTC Answer SDP |
| `ice-candidate` | `{ targetId, candidate }` | WebRTC ICE 候选 |
| `send-message` | `{ roomId, content, type }` | 发送公屏消息 |
| `ai-query` | `{ roomId, content }` | AI 查询 |
| `share-screen-start` | `{ roomId }` | 开始屏幕共享 |
| `share-screen-stop` | `{ roomId }` | 停止屏幕共享 |
| `voice-state` | `{ roomId, speaking }` | 说话状态 |

#### 服务端 → 客户端

| 事件 | 载荷 | 说明 |
|------|------|------|
| `offer` | `{ fromId, userId, sdp }` | 转发 Offer |
| `answer` | `{ fromId, userId, sdp }` | 转发 Answer |
| `ice-candidate` | `{ fromId, userId, candidate }` | 转发 ICE 候选 |
| `user-joined` | `{ userId, userInfo }` | 新用户加入 |
| `user-left` | `{ userId }` | 用户离开 |
| `user-list-update` | `{ users[] }` | 成员列表更新 |
| `new-message` | `{ id, type, content, username, createdAt }` | 新消息 |
| `ai-typing` | `{ id, typing }` | AI 开始/停止生成 |
| `ai-chunk` | `{ id, content }` | AI 流式片段 |
| `ai-done` | `{ id, content }` | AI 回复完成 |
| `screen-share-start` | `{ userId }` | 屏幕共享开始通知 |
| `screen-share-stop` | `{ userId }` | 屏幕共享停止通知 |
| `room-info` | `{ room }` | 房间信息更新 |
| `room-deleted` | - | 房间被删除 |
| `error-msg` | `{ message }` | 错误消息 |
| `voice-state` | `{ userId, speaking }` | 说话状态广播 |

---

## 7. WebRTC 通话设计

### 7.1 Mesh 拓扑

每个成员与其他所有成员建立独立的 `RTCPeerConnection`，形成全连接 Mesh。

**连接数**：N 人房间 = N×(N-1) 个 PC（每人维护 N-1 个）。

**ICE 配置**：
- Google STUN（NAT 类型检测 + 直连尝试）
- Metered.ca TURN（免费中继，全球多区域）
- Twilio TURN（免费中继，亚洲区域）

### 7.2 连接建立流程

```
用户A 加入房间
    │
    ▼
Socket 收到 user-joined (用户B)
    │
    ▼
dispatchEvent('webrtc-user-joined')
    │
    ▼
_createPeerConnection(用户B)
    ├── addTrack(本地音频轨)
    ├── onicecandidate → sendIceCandidate
    ├── ontrack → 创建 <audio> 播放
    └── onconnectionstatechange → 管理连接生命周期
    │
    ▼
_createOffer(用户B)
    ├── pc.createOffer()
    ├── pc.setLocalDescription(offer)
    └── sendOffer(用户B, SDP)
    │
    ▼
服务端广播 offer → 用户B
    │
    ▼
用户B _handleOffer
    ├── _createPeerConnection(用户A)
    ├── pc.setRemoteDescription(offer)  ← ontrack 触发
    ├── pc.createAnswer()
    ├── pc.setLocalDescription(answer)
    └── sendAnswer(用户A, SDP)
    │
    ▼
服务端广播 answer → 用户A
    │
    ▼
用户A _handleAnswer
    └── pc.setRemoteDescription(answer)  ← 协商完成，媒体流开始
```

### 7.3 屏幕共享流程

```
共享方 (用户A)
    │
    ▼
getDisplayMedia({ video: 1920x1080@15fps })
    │
    ▼
遍历 this.peers → 对每个远端:
    ├── 等待 signalingState === 'stable'
    ├── pc.addTrack(屏幕视频轨)
    ├── pc.createOffer({ iceRestart: false })
    ├── pc.setLocalDescription(offer)
    └── emit 'offer' via socket
    │
    ▼
emit 'share-screen-start' via socket  ← 通知事件

────────────────────────────────────

接收方 (用户B)
    │
    ▼
收到 'offer' (renegotiation)
    ├── 等待 signalingState === 'stable'
    ├── pc.setRemoteDescription(offer)  ← ontrack 触发
    │       └── 检测到 video track
    │           ├── 创建 <video> 元素挂载 body
    │           ├── 黑色背景 + loadeddata → 移除背景
    │           └── 监听 track mute/unmute (数据流诊断)
    ├── pc.createAnswer()
    ├── pc.setLocalDescription(answer)
    └── sendAnswer
    │
    ▼
收到 'screen-share-start' (通知)
    └── 更新 UI 显示 "XXX 正在共享屏幕"
```

**关键约束**：
- `createOffer` 必须显式 `{ iceRestart: false }`，否则浏览器可能意外触发 ICE 重启导致连接失败
- `addTrack` 必须包在 try-catch 内（跨设备延迟下可能因 signalingState 非 stable 抛异常）
- 接收端 video 元素直接操作 DOM（`document.body.appendChild`），不经过 React
- Server 信令使用广播模式（`socket.to(roomId).emit`），不做定向转发

### 7.4 ICE / NAT 穿越

采用 Trickle ICE 模式：
1. `setLocalDescription` 后自动开始 ICE 候选收集
2. 每个候选通过 `onicecandidate` 事件获取
3. 立即通过 Socket.IO 发送给远端（不等所有候选收集完）
4. 远端 `addIceCandidate` 随时添加

优先级：Host > Srflx (STUN) > Relay (TURN)

---

## 8. 安全设计

### 8.1 认证与授权

| 层面 | 机制 |
|------|------|
| REST API | JWT Bearer Token，axios 拦截器自动附带 |
| Socket.IO | `auth.token` 传递 JWT，中间件验证 |
| 房间操作 | 编辑/删除仅房主可执行 |
| 密码验证 | bcrypt (10 rounds)，REST + Socket 双层校验 |

### 8.2 数据安全

| 项目 | 措施 |
|------|------|
| 密码存储 | bcrypt 哈希，不存明文 |
| JWT 过期 | Token 有过期时间 |
| 密码记忆 | localStorage 存 `room_codes`（非敏感），密码变更后清除 |
| 数据库 | 参数化查询（pg），防 SQL 注入 |

### 8.3 通信安全

| 层面 | 措施 |
|------|------|
| HTTPS/WSS | Vercel + Render 默认启用 |
| WebRTC 加密 | DTLS-SRTP 强制加密 |
| TURN 认证 | 长期凭证（免费服务） |

---

## 9. 非功能性需求

### 9.1 性能

| 指标 | 目标 |
|------|------|
| 首屏加载 | < 3 秒 |
| 语音延迟 | < 200ms（Mesh 直连） |
| AI 首字延迟 | < 2 秒（流式） |
| 屏幕共享帧率 | 15fps |
| 最大并发连接 | 5 人 Mesh（约 20 个 PC） |

### 9.2 兼容性

| 平台 | 支持 |
|------|------|
| Chrome (桌面) | ✅ 完全支持 |
| Chrome (Android) | ✅ 支持 |
| Safari (iOS) | ✅ 支持（需用户手势触发 getUserMedia） |
| Firefox (桌面) | ✅ 基本支持 |
| Safari (桌面) | ⚠️ 部分支持 |

### 9.3 可用性

- **移动端适配**：`window.innerWidth < 768` 触发单栏 Tab 布局
- **无 PostgreSQL 回退**：未设置 `DATABASE_URL` 时自动使用内存存储（开发/测试用）
- **免费实例保活**：GitHub Actions 每 5 分钟 ping Render 后端，防止免费实例休眠

### 9.4 可维护性

- 前后端分离，独立部署
- 数据库双模式（PG + 内存），本地开发零配置
- Render 自动部署（Git push → main）
- Vercel 手动部署（`npx vercel --prod --yes --force`）

---

## 10. 风险与限制

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Mesh 扩展性差 | N>6 时 PC 数量爆发 | 建议转为 SFU 架构（如 mediasoup） |
| TURN 免费额度 | 超出后中继不可用 | 监控用量，准备付费 TURN |
| ICE 重启失败 | 屏幕共享连接断开 | `iceRestart: false` + 不激进入除 peer |
| Render 免费休眠 | 15 分钟无请求后休眠 | GitHub Actions keepalive ping |
| 移动端获取麦克风 | iOS 需用户手势 | `isTouchDevice` 检测 + 按钮触发 `retryMic()` |

---

## 附录 A: 文件清单

```
VoiceHub/
├── CLAUDE.md                 # AI 助手指南
├── docs/
│   └── PRD.md               # 本文档
├── vercel.json               # Vercel 部署配置
├── .github/workflows/
│   └── keepalive.yml         # Render 保活定时任务
├── client/                   # 前端 (React + Vite)
│   ├── vite.config.js
│   ├── src/ (见架构章节)
│   └── dist/                 # 构建产物
└── server/                   # 后端 (Express + Socket.IO)
    ├── src/ (见架构章节)
    └── .env.example
```

## 附录 B: 部署命令

```bash
# 本地开发
cd server && PORT=3001 node src/index.js    # 后端
cd client && npx vite --host                 # 前端

# 部署
cd client && npm run build                   # 构建前端
npx vercel --prod --yes --force              # 部署 Vercel
# 后端：git push → Render 自动部署
```
