import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createWebRTCManager,
  destroyWebRTCManager,
  getWebRTCManager,
} from '../services/webrtc'
import { startScreenShare as notifyScreenShareStart, stopScreenShare as notifyScreenShareStop } from '../services/socket'
import useStore from '../store/useStore'

// ── 移动端音频播放辅助 ──────────────────────────────────
// 手机浏览器阻止自动播放，必须等用户手势触发 play()
// iOS Safari 更严格：<audio> 走听筒，<video playsInline> 走扬声器

const pendingAudios = new Set()
let unlocked = false

function unlockAudio() {
  if (unlocked) return
  unlocked = true
  document.removeEventListener('click', unlockAudio)
  document.removeEventListener('touchstart', unlockAudio)
}

// 全局：每次用户交互都重试播放
document.addEventListener('click', () => {
  unlockAudio()
  pendingAudios.forEach((el) => {
    if (el.paused) el.play().then(() => pendingAudios.delete(el)).catch(() => {})
    else pendingAudios.delete(el)
  })
})
document.addEventListener('touchstart', () => {
  unlockAudio()
  pendingAudios.forEach((el) => {
    if (el.paused) el.play().then(() => pendingAudios.delete(el)).catch(() => {})
    else pendingAudios.delete(el)
  })
}, { passive: true })

export default function useWebRTC(roomId) {
  const user = useStore((s) => s.user)
  const setSpeaking = useStore((s) => s.setSpeaking)
  const setScreenSharer = useStore((s) => s.setScreenSharer)

  const [micOn, setMicOn] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [peerCount, setPeerCount] = useState(0)
  const [isSharing, setIsSharing] = useState(false)
  const [screenStream, setScreenStream] = useState(null)
  const audioRefs = useRef(new Map())
  const micOnRef = useRef(true)
  const speakerOnRef = useRef(true)
  micOnRef.current = micOn
  speakerOnRef.current = speakerOn

  // 远程音频流到达
  const handleRemoteStream = useCallback((peerId, stream) => {
    // 清理旧元素
    const old = audioRefs.current.get(peerId)
    if (old) {
      old.srcObject = null
      pendingAudios.delete(old)
      old.remove()
      audioRefs.current.delete(peerId)
    }

    // 用 <video> 而不是 <audio>：iOS Safari 中 video+playsinline 走扬声器，audio 走听筒
    const el = document.createElement('video')
    el.srcObject = stream
    el.dataset.peer = peerId
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
    el.muted = !speakerOnRef.current
    // 隐藏视频元素（只用于音频输出）
    el.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:0;left:0'
    document.body.appendChild(el)

    el.play().then(() => {
      pendingAudios.delete(el)
    }).catch(() => {
      pendingAudios.add(el)
    })

    audioRefs.current.set(peerId, el)
  }, [])

  // 说话状态回调
  const handleSpeaking = useCallback((peerId, speaking) => {
    setSpeaking(peerId, speaking)
  }, [setSpeaking])

  // 屏幕共享回调
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

  // 初始化 WebRTC
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
      audioRefs.current.forEach((el) => {
        el.srcObject = null
        pendingAudios.delete(el)
        el.remove()
      })
      audioRefs.current.clear()
      destroyWebRTCManager()
    }
  }, [user?.id])

  const toggleMic = useCallback(() => {
    const manager = getWebRTCManager()
    const next = !micOn
    setMicOn(next)
    manager?.toggleMic(next)
  }, [micOn])

  const toggleSpeaker = useCallback(() => {
    const manager = getWebRTCManager()
    const next = !speakerOn
    setSpeakerOn(next)
    // 静音所有音频/视频播放元素
    const els = document.querySelectorAll('[data-peer]')
    els.forEach((el) => { el.muted = !next })
    manager?.toggleSpeaker(next)
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
