// 公屏消息 & AI 对话处理模块（流式响应）

const { v4: uuidv4 } = require('uuid')
const db = require('../db')

// 房间 AI 上下文缓存（启动时从 DB 加载）
const aiContexts = new Map()

// 房间 AI 开关状态（临时状态，重启后默认开启即可）
const aiEnabledMap = new Map()

// AI 系统提示词
const DEFAULT_SYSTEM_PROMPT = `你是一个语音聊天室中的 AI 助手，名叫"小V"。请遵守以下规则：
1. 用中文简洁回答，每次回复控制在 300 字以内
2. 语气友善活泼，适当使用 emoji
3. 如果用户问编程问题，给出可运行的代码示例
4. 如果用户不知道你是谁，介绍自己是 VoiceHub 的 AI 助手
5. 不要编造你不知道的信息`

// 从 DB 加载指定房间的 AI 上下文到内存缓存
async function loadAIContext(roomId) {
  if (aiContexts.has(roomId)) return
  const saved = await db.getAIContext(roomId)
  if (saved) {
    aiContexts.set(roomId, saved)
  } else {
    aiContexts.set(roomId, [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    ])
  }
}

// 持久化 AI 上下文到 DB
async function saveAIContext(roomId) {
  const ctx = aiContexts.get(roomId)
  if (ctx) {
    await db.setAIContext(roomId, ctx)
  }
}

function setupChat(io, socket, roomUsers) {
  // ==================== 公屏消息 ====================
  socket.on('send-message', async ({ roomId, content, type = 'text' }) => {
    try {
      const msg = await db.createMessage({
        id: uuidv4(),
        roomId,
        userId: socket.data.userId,
        username: socket.user?.username || '未知用户',
        type,
        content,
        createdAt: new Date().toISOString(),
      })
      io.to(roomId).emit('new-message', msg)
    } catch (err) {
      console.error('[Chat] 保存消息失败:', err.message)
    }
  })

  // ==================== AI 对话（流式） ====================
  socket.on('ai-query', async ({ roomId, content }) => {
    // 检查 AI 开关
    if (aiEnabledMap.has(roomId) && !aiEnabledMap.get(roomId)) {
      socket.emit('error-msg', { message: 'AI 功能已关闭' })
      return
    }

    // 处理特殊命令
    if (content.trim() === '/clear') {
      aiContexts.set(roomId, [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }])
      await db.deleteAIContext(roomId)
      const sysMsg = await db.createMessage({
        id: uuidv4(), roomId, type: 'system',
        content: '🧹 AI 上下文已清除，开始全新对话',
        createdAt: new Date().toISOString(),
      })
      io.to(roomId).emit('new-message', sysMsg)
      return
    }

    if (content.trim() === '/help') {
      const helpMsg = await db.createMessage({
        id: uuidv4(), roomId, type: 'ai',
        content: '📖 **AI 命令帮助**\n• `@AI 你的问题` — 向 AI 提问\n• `@AI /clear` — 清除对话上下文\n• `@AI /help` — 显示此帮助',
        username: '小V', createdAt: new Date().toISOString(),
      })
      io.to(roomId).emit('new-message', helpMsg)
      return
    }

    // 发送用户消息（持久化）
    const userMsg = await db.createMessage({
      id: uuidv4(), roomId,
      userId: socket.data.userId,
      type: 'text',
      content: `@AI ${content}`,
      username: socket.user?.username || '未知用户',
      createdAt: new Date().toISOString(),
    })
    io.to(roomId).emit('new-message', userMsg)

    // 通知前端 AI 开始思考
    const aiMsgId = uuidv4()
    io.to(roomId).emit('ai-typing', { id: aiMsgId, typing: true })

    // 加载 AI 上下文（首次从 DB 加载）
    await loadAIContext(roomId)
    const ctx = aiContexts.get(roomId)
    ctx.push({ role: 'user', content })

    // 调用 AI API（流式）
    try {
      let fullReply = ''
      await callAIStream(ctx, (chunk) => {
        fullReply += chunk
        io.to(roomId).emit('ai-chunk', { id: aiMsgId, chunk, content: fullReply })
      })

      // 保存对话历史
      ctx.push({ role: 'assistant', content: fullReply })
      if (ctx.length > 21) ctx.splice(1, 2) // 保留系统提示 + 最近10轮
      await saveAIContext(roomId)

      // 通知 AI 完成
      io.to(roomId).emit('ai-done', { id: aiMsgId, content: fullReply })

      // 保存完整 AI 回复
      await db.createMessage({
        id: aiMsgId, roomId, type: 'ai',
        content: fullReply,
        username: '小V', createdAt: new Date().toISOString(),
      })
    } catch (err) {
      console.error('[AI] 调用失败:', err.message)
      io.to(roomId).emit('ai-typing', { id: aiMsgId, typing: false })
      socket.emit('error-msg', { message: 'AI 调用失败，请检查 API Key 配置' })
    }
  })

  // ==================== AI 开关 ====================
  socket.on('toggle-ai', async ({ roomId, enabled }) => {
    aiEnabledMap.set(roomId, enabled)
    const msg = await db.createMessage({
      id: uuidv4(), roomId, type: 'system',
      content: enabled ? '🤖 AI 助手已开启（@AI 提问）' : '🤖 AI 助手已关闭',
      createdAt: new Date().toISOString(),
    })
    io.to(roomId).emit('new-message', msg)
  })
}

// ==================== 流式调用 AI API ====================
async function callAIStream(messages, onChunk) {
  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1'

  if (!apiKey || apiKey === 'sk-your-deepseek-api-key') {
    const fallback = '⚠️ AI 服务未配置。请在 `server/.env` 中设置 OPENAI_API_KEY（DeepSeek API Key）。\n\n> 申请地址：https://platform.deepseek.com'
    // 模拟流式输出
    for (let i = 0; i < fallback.length; i += 3) {
      onChunk(fallback.slice(i, i + 3))
      await sleep(20)
    }
    return fallback
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'deepseek-chat',
      messages,
      max_tokens: 500,
      stream: true,
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI API Error: ${res.status} ${err}`)
  }

  // 解析 SSE 流
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) onChunk(content)
      } catch {
        // 跳过解析失败的 chunk
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = setupChat
