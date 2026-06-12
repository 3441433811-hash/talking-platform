import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createWebRTCManager,
  destroyWebRTCManager,
  getWebRTCManager,
} from '../services/webrtc'
import { startScreenShare as notifyScreenShareStart, stopScreenShare as notifyScreenShareStop } from '../services/socket'
import useStore from '../store/useStore'

// ── 移动端音频解锁 ────────────────────────────────
// 手机浏览器禁止自动播放。维护待播放队列，每次用户交互都重试。

const pendingAudios = new Set()

function flushAudios() {
  pendingAudios.forEach((el) => {
    if (el.paused || el.muted) {
      el.muted = false
      el.play().then(() => pendingAudios.delete(el)).catch(() => {})
    } else {
      pendingAudios.delete(el)
    }
  })
}

document.addEventListener('click', flushAudios)
document.addEventListener('touchstart', flushAudios, { passive: true })

export default function useWebRTC(roomId) {
  const user = useStore((s) => s.user)
  const setSpeaking = useStore((s) => s.setSpeaking)
  const setScreenSharer = useStore((s) => s.setScreenSharer)

  const [micOn, setMicOn] = useState(false)  // 移动端初始为 false，点了按钮才获取麦克风
  const [speakerOn, setSpeakerOn] = useState(true)
  const [peerCount, setPeerCount] = useState(0)
  const [isSharing, setIsSharing] = useState(false)
  const [screenStream, setScreenStream] = useState(null)
  const audioEls = useRef(new Map())
  const micOnRef = useRef(false)
  const speakerOnRef = useRef(true)
  micOnRef.current = micOn
  speakerOnRef.current = speakerOn

  // 远程音频流到达 — 用 <audio> 元素播放（兼容所有手机浏览器）
  const handleRemoteStream = useCallback((peerId, stream) => {
    // 清理旧
    const old = audioEls.current.get(peerId)
    if (old) {
      old.srcObject = null
      pendingAudios.delete(old)
      old.remove()
      audioEls.current.delete(peerId)
    }

    const audio = document.createElement('audio')
    audio.srcObject = stream
    audio.dataset.peer = peerId
    audio.autoplay = true
    audio.playsInline = true
    audio.muted = !speakerOnRef.current
    // 极小但可见（某些手机浏览器拒绝不可见元素播放）
    audio.style.cssText = 'position:fixed;width:2px;height:2px;top:0;left:0;opacity:0.01'

    document.body.appendChild(audio)
    audioEls.current.set(peerId, audio)

    audio.play().then(() => {
      pendingAudios.delete(audio)
    }).catch(() => {
      pendingAudios.add(audio)
    })
  }, [])

  const handleSpeaking = useCallback((peerId, speaking) => {
    setSpeaking(peerId, speaking)
  }, [setSpeaking])

  const handleScreenShare = useCallback((sharerId, stream, isLocal) => {
    if (stream) {
      setScreenSharer(sharerId)
      setScreenStream(stream)
      if (isLocal) setIsSharing(true)
    } else {
      setScreenSharer(null)
      setScreenStream(null)
      setIsSharing(false)
    }
  }, [setScreenSharer])

  // 初始化
  useEffect(() => {
    if (!user?.id) return
    let mounted = true

    async function init() {
      try {
        const manager = createWebRTCManager({
          userId: user.id,
          onRemoteStream: handleRemoteStream,
          onPeerCountChange: (count) => { if (mounted) setPeerCount(count) },
          onSpeaking: handleSpeaking,
          onScreenShare: handleScreenShare,
        })
        await manager.start()
        if (!mounted) return
        if (!micOnRef.current) manager.toggleMic(false)
        console.log('[useWebRTC] WebRTC 已初始化')
      } catch (err) {
        console.error('[useWebRTC] 初始化失败:', err)
      }
    }

    init()

    return () => {
      mounted = false
      audioEls.current.forEach((el) => {
        el.srcObject = null
        pendingAudios.delete(el)
        el.remove()
      })
      audioEls.current.clear()
      destroyWebRTCManager()
    }
  }, [user?.id])

  const toggleMic = useCallback(async () => {
    const manager = getWebRTCManager()
    if (!manager) return
    // 如果没有本地流，优先获取（不管当前状态）
    if (!manager.localStream) {
      const stream = await manager.retryMic()
      if (stream) setMicOn(true)
      return
    }
    // 已有流，正常切换
    const next = !micOn
    setMicOn(next)
    manager.toggleMic(next)
  }, [micOn])

  const toggleSpeaker = useCallback(() => {
    const next = !speakerOn
    setSpeakerOn(next)
    audioEls.current.forEach((el) => { el.muted = !next })
    getWebRTCManager()?.toggleSpeaker(next)
  }, [speakerOn])

  const toggleScreenShare = useCallback(async () => {
    const manager = getWebRTCManager()
    if (!manager) return

    if (manager.isSharingScreen) {
      manager.stopScreenShare()
      if (roomId) notifyScreenShareStop(roomId)
    } else {
      const stream = await manager.startScreenShare(() => {
        if (roomId) notifyScreenShareStop(roomId)
      })
      if (stream && roomId) {
        notifyScreenShareStart(roomId)
      }
    }
  }, [roomId])

  return {
    micOn,
    speakerOn,
    peerCount,
    isSharing,
    screenStream,
    toggleMic,
    toggleSpeaker,
    toggleScreenShare,
  }
}
