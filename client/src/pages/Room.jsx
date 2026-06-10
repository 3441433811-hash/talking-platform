import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRoom, getMessages } from '../services/api'
import useSocket from '../hooks/useSocket'
import useWebRTC from '../hooks/useWebRTC'
import { sendMessage, leaveRoom, aiQuery, getSocket } from '../services/socket'
import useStore from '../store/useStore'

export default function Room() {
  const { id: roomId } = useParams()
  const navigate = useNavigate()
  useSocket(roomId)
  const { micOn, speakerOn, peerCount, isSharing, toggleMic, toggleSpeaker, toggleScreenShare } = useWebRTC(roomId)

  const {
    user, currentRoom, setCurrentRoom,
    members, messages, screenSharer, aiEnabled, setAiEnabled,
    aiTyping, aiStreamContent, aiStreamId,
    reset,
  } = useStore()

  const [input, setInput] = useState('')
  const [voiceAiOn, setVoiceAiOn] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceText, setVoiceText] = useState('')
  const [ttsMuted, setTtsMuted] = useState(false)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const chatEndRef = useRef(null)
  const voicePendingRef = useRef(false)
  const recognitionRef = useRef(null)
  const synthRef = useRef(window.speechSynthesis)

  // 加载房间信息和历史消息
  useEffect(() => {
    getRoom(roomId).then((res) => setCurrentRoom(res.data.room)).catch(() => navigate('/lobby'))
    getMessages(roomId).then((res) => useStore.getState().setMessages(res.data.messages || []))
    return () => reset()
  }, [roomId])

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // --- 语音识别初始化 ---
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'zh-CN'
    recognitionRef.current = rec

    rec.onresult = (event) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) final += t
        else interim += t
      }
      if (interim) setVoiceText(interim)
      if (final) {
        setVoiceText('')
        voicePendingRef.current = true
        aiQuery(roomId, final.trim())
      }
    }

    rec.onerror = (event) => {
      console.error('[VoiceAI] Speech error:', event.error)
      if (event.error === 'not-allowed') {
        setVoiceText('麦克风权限未授权')
      }
      setVoiceListening(false)
    }

    rec.onend = () => {
      setVoiceListening(false)
      // 语音AI仍开启时自动重新开始
      if (voiceAiOnRef?.current) {
        setTimeout(() => {
          try { rec.start(); setVoiceListening(true) } catch (_) {}
        }, 300)
      }
    }

    return () => {
      try { rec.abort() } catch (_) {}
    }
  }, [roomId])

  // 保持 ref 同步
  const voiceAiOnRef = useRef(voiceAiOn)
  voiceAiOnRef.current = voiceAiOn

  // --- AI 回复 TTS ---
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleAiDone = ({ content }) => {
      if (voicePendingRef.current) {
        voicePendingRef.current = false
        if (!ttsMuted && content) speakText(content)
      }
    }

    socket.on('ai-done', handleAiDone)
    return () => { socket.off('ai-done', handleAiDone) }
  }, [ttsMuted, roomId])

  // --- TTS 语音合成 ---
  const speakText = useCallback((text) => {
    const synth = synthRef.current
    if (!synth) return

    synth.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'zh-CN'
    utter.rate = 1.1
    utter.pitch = 1.0

    const voices = synth.getVoices()
    const zh = voices.find(v => v.lang.startsWith('zh'))
    if (zh) utter.voice = zh

    utter.onstart = () => setVoiceSpeaking(true)
    utter.onend = () => setVoiceSpeaking(false)
    utter.onerror = () => setVoiceSpeaking(false)
    synth.speak(utter)
  }, [])

  // --- 语音 AI 开关 ---
  const toggleVoiceAI = useCallback(() => {
    const next = !voiceAiOn
    setVoiceAiOn(next)
    if (next) {
      const rec = recognitionRef.current
      if (rec) {
        try { rec.start(); setVoiceListening(true) } catch (_) {}
      }
    } else {
      const rec = recognitionRef.current
      if (rec) try { rec.abort() } catch (_) {}
      setVoiceListening(false)
      setVoiceText('')
      if (synthRef.current) synthRef.current.cancel()
      setVoiceSpeaking(false)
    }
  }, [voiceAiOn])

  const handleSend = (e) => {
    e.preventDefault()
    if (!input.trim()) return
    if (input.startsWith('@AI') || input.startsWith('@ai')) {
      aiQuery(roomId, input.replace(/^@AI\s*/i, ''))
    } else {
      sendMessage(roomId, input)
    }
    setInput('')
  }

  const handleLeave = () => {
    leaveRoom(roomId)
    reset()
    navigate('/lobby')
  }

  // AI 开关切换
  const handleAiToggle = (enabled) => {
    setAiEnabled(enabled)
    getSocket()?.emit('toggle-ai', { roomId, enabled })
  }

  return (
    <div style={styles.wrapper}>
      {/* 顶部栏 */}
      <header style={styles.topBar}>
        <span style={styles.roomName}>📻 {currentRoom?.name || roomId}</span>
        <span style={styles.roomId}>ID: {roomId?.slice(0, 8)}</span>
        <button style={styles.leaveBtn} onClick={handleLeave}>📞 离开</button>
      </header>

      <div style={styles.body}>
        {/* 左侧：成员列表 */}
        <aside style={styles.sidebar}>
          <h3>👥 在线成员 ({members.length})</h3>
          {members.map((m) => (
            <div key={m.id} style={styles.member}>
              <span>{m.speaking ? '🟢' : '⚪'}</span>
              <span>{m.username || m.id?.slice(0, 6)}</span>
              {m.micMuted && <span>🔇</span>}
            </div>
          ))}
        </aside>

        {/* 中间：主内容区 */}
        <main style={styles.mainArea} data-main-area>
          {isSharing || screenSharer ? (
            <div style={styles.placeholder}>
              <span style={{ fontSize: 48 }}>📺</span>
              <p style={{ color: '#6c63ff', marginTop: 8 }}>
                {isSharing ? '你正在共享屏幕' : `${screenSharer} 正在共享屏幕`}
              </p>
            </div>
          ) : voiceAiOn ? (
            <div style={styles.voiceAiPanel}>
              {voiceListening ? (
                <>
                  <div style={styles.voiceMicIcon}>🎤</div>
                  <div className="voice-pulse" style={styles.voicePulseRing}></div>
                  <p style={styles.voiceLabel}>正在听...</p>
                  {voiceText && <p style={styles.voiceLiveText}>{voiceText}</p>}
                </>
              ) : aiTyping && voicePendingRef.current ? (
                <>
                  <div style={styles.voiceMicIcon}>🤔</div>
                  <p style={styles.voiceLabel}>思考中...</p>
                  {aiStreamContent && <p style={styles.voiceLiveText}>{aiStreamContent}</p>}
                </>
              ) : voiceSpeaking ? (
                <>
                  <div style={styles.voiceMicIcon}>🔊</div>
                  <div className="voice-speaking" style={styles.voiceSpeakBar}></div>
                  <p style={styles.voiceLabel}>AI 正在说...</p>
                </>
              ) : (
                <>
                  <div style={styles.voiceMicIcon}>🤖</div>
                  <p style={styles.voiceLabel}>语音 AI 已开启</p>
                  <p style={styles.voiceHint}>对着麦克风说话，AI 会用语音回复你</p>
                </>
              )}
            </div>
          ) : (
            <div style={styles.placeholder}>
              <div style={styles.voiceWave}>
                <span style={{ fontSize: 48 }}>🎙️</span>
              </div>
              <p>语音通话中 · {members.length} 人</p>
            </div>
          )}
        </main>

        {/* 右侧：公屏聊天 */}
        <aside style={styles.chatPanel}>
          <div style={styles.chatHeader}>
            <h3>💬 公屏消息</h3>
            <label style={styles.aiToggle}>
              <input type="checkbox" checked={aiEnabled} onChange={(e) => handleAiToggle(e.target.checked)} />
              🤖 AI
            </label>
          </div>
          <div style={styles.chatMessages}>
            {messages.map((msg, i) => (
              <div key={msg.id || i} style={{
                ...styles.msgItem,
                ...(msg.type === 'system' ? styles.msgSystem : {}),
                ...(msg.type === 'ai' ? styles.msgAi : {}),
              }}>
                {msg.username && <strong style={{
                  ...styles.msgUser,
                  ...(msg.type === 'ai' ? styles.aiUser : {}),
                }}>{msg.username}: </strong>}
                {msg.content}
              </div>
            ))}
            {/* AI 流式输出（实时打字效果） */}
            {aiTyping && aiStreamContent && (
              <div style={styles.msgAi}>
                <strong style={{ ...styles.msgUser, ...styles.aiUser }}>🤖 小V: </strong>
                <span>{aiStreamContent}</span>
                <span style={styles.cursor}>|</span>
              </div>
            )}
            {/* AI 思考中（还没出字） */}
            {aiTyping && !aiStreamContent && (
              <div style={styles.msgAi}>
                <strong style={{ ...styles.msgUser, ...styles.aiUser }}>🤖 小V: </strong>
                <span style={styles.typingDots}>思考中<span className="dot1">.</span><span className="dot2">.</span><span className="dot3">.</span></span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <form style={styles.chatInput} onSubmit={handleSend}>
            <input
              style={styles.msgInput}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={aiEnabled ? '发消息 或 @AI 提问（/help 查看帮助）...' : '输入消息...'}
            />
            <button style={styles.sendBtn} type="submit">发送</button>
          </form>
        </aside>
      </div>

      {/* 底部控制栏 */}
      <footer style={styles.controlBar}>
        <button style={{ ...styles.ctrlBtn, background: micOn ? 'rgba(255,255,255,0.1)' : '#ff4757' }}
          onClick={toggleMic} title={micOn ? '关闭麦克风' : '打开麦克风'}>
          {micOn ? '🎤' : '🔇 静音'}
        </button>
        <button style={{ ...styles.ctrlBtn, background: speakerOn ? 'rgba(255,255,255,0.1)' : '#ff4757' }}
          onClick={toggleSpeaker} title={speakerOn ? '关闭扬声器' : '打开扬声器'}>
          {speakerOn ? '🔊' : '🔇 静音'}
        </button>
        <button style={{ ...styles.ctrlBtn, background: isSharing ? '#6c63ff' : 'rgba(255,255,255,0.1)' }}
          onClick={toggleScreenShare}>
          📺 {isSharing ? '停止' : '共享屏幕'}
        </button>
        <button
          style={{
            ...styles.ctrlBtn,
            background: voiceAiOn ? '#6c63ff' : 'rgba(255,255,255,0.08)',
            width: 'auto',
            padding: '0 16px',
            fontSize: 14,
            fontWeight: 600,
          }}
          onClick={toggleVoiceAI}
          title="🤖 语音 AI 对话"
        >
          🤖 {voiceAiOn ? '语音AI·开' : '语音AI'}
        </button>
        {voiceAiOn && (
          <button
            style={{
              ...styles.ctrlBtn,
              background: ttsMuted ? '#ff4757' : 'rgba(255,255,255,0.08)',
              width: 44,
              height: 44,
              fontSize: 18,
            }}
            onClick={() => setTtsMuted(!ttsMuted)}
            title={ttsMuted ? '开启 AI 语音回复' : '静音 AI 语音回复'}
          >
            {ttsMuted ? '🔇' : '🔊'}
          </button>
        )}
        <span style={{ ...styles.peerBadge }} title="P2P 连接数">
          🔗 {peerCount}
        </span>
      </footer>
    </div>
  )
}

const styles = {
  wrapper: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a1a', color: '#e8e8f0', fontFamily: 'system-ui, sans-serif' },
  topBar: { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(10,10,26,0.9)' },
  roomName: { fontWeight: 700, fontSize: 18 },
  roomId: { color: '#6b6b80', fontSize: 12, flex: 1 },
  leaveBtn: { padding: '6px 16px', borderRadius: 8, border: 'none', background: '#ff4757', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: { width: 200, padding: 16, borderRight: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto' },
  member: { display: 'flex', gap: 8, padding: '6px 0', fontSize: 14, alignItems: 'center' },
  mainArea: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  placeholder: { textAlign: 'center', color: '#6b6b80' },
  voiceWave: { marginBottom: 16 },
  screenLabel: { color: '#6c63ff', fontSize: 14 },
  chatPanel: { width: 320, display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.08)' },
  chatHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  aiToggle: { fontSize: 12, color: '#a0a0b8', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
  chatMessages: { flex: 1, overflowY: 'auto', padding: 12 },
  msgItem: { padding: '6px 0', fontSize: 14, lineHeight: 1.6 },
  msgSystem: { color: '#6b6b80', fontSize: 12, textAlign: 'center' },
  msgAi: { color: '#00d4ff', background: 'rgba(0,212,255,0.05)', borderRadius: 8, padding: '6px 10px', margin: '4px 0' },
  msgUser: { color: '#6c63ff' },
  aiUser: { color: '#00d4ff' },
  cursor: { display: 'inline-block', color: '#00d4ff', animation: 'blink 1s step-end infinite', fontWeight: 300, marginLeft: 2 },
  typingDots: { color: '#a0a0b8', fontStyle: 'italic' },
  chatInput: { display: 'flex', padding: 10, borderTop: '1px solid rgba(255,255,255,0.08)', gap: 8 },
  msgInput: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', outline: 'none', fontSize: 14 },
  sendBtn: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6c63ff', color: '#fff', cursor: 'pointer', fontWeight: 600 },
  controlBar: { display: 'flex', justifyContent: 'center', gap: 16, padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(10,10,26,0.95)' },
  ctrlBtn: { width: 50, height: 50, borderRadius: 14, border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' },
  peerBadge: { padding: '8px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: '#a0a0b8', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 },
  // 语音 AI 样式
  voiceAiPanel: { textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, position: 'relative' },
  voiceMicIcon: { fontSize: 64, lineHeight: 1, animation: 'voicePulse 2s ease-in-out infinite' },
  voicePulseRing: { position: 'absolute', top: 0, width: 80, height: 80, borderRadius: '50%', border: '2px solid #6c63ff', opacity: 0.6, animation: 'voiceRipple 1.5s ease-out infinite' },
  voiceLabel: { color: '#e8e8f0', fontSize: 18, fontWeight: 600, marginTop: 8 },
  voiceHint: { color: '#6b6b80', fontSize: 14 },
  voiceLiveText: { color: '#00d4ff', fontSize: 16, maxWidth: 400, lineHeight: 1.5, minHeight: 24, fontStyle: 'italic' },
  voiceSpeakBar: { width: 200, height: 4, background: '#6c63ff', borderRadius: 2, opacity: 0.8 },
}
