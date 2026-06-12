import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createWebRTCManager,
  destroyWebRTCManager,
  getWebRTCManager,
} from '../services/webrtc'
import { startScreenShare as notifyScreenShareStart, stopScreenShare as notifyScreenShareStop } from '../services/socket'
import useStore from '../store/useStore'

// 全局待播放音频队列 — 移动端必须等用户交互后才能 play()
const pendingAudios = new Set()  // Set<HTMLAudioElement>
let interactionHandlerReady = false

function setupInteractionHandler() {
  if (interactionHandlerReady) return
  interactionHandlerReady = true

  const tryPlayAll = () => {
    if (pendingAudios.size === 0) return
    pendingAudios.forEach((audio) => {
      if (audio.paused) {
        audio.play().then(() => {
          pendingAudios.delete(audio)
        }).catch(() => {})
      } else {
        pendingAudios.delete(audio)
      }
    })
  }

  // 持久监听：每次用户交互都重试待播放音频
  document.addEventListener('click', tryPlayAll)
  document.addEventListener('touchstart', tryPlayAll, { passive: true })
}

setupInteractionHandler()

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

    const audio = new Audio()
    audio.srcObject = stream
    audio.dataset.peer = peerId
    audio.playsInline = true
    audio.muted = !speakerOnRef.current
    document.body.appendChild(audio)

    // 尝试播放：移动端会被拒绝，加入待播放队列等用户交互
    audio.play().then(() => {
      pendingAudios.delete(audio)
    }).catch(() => {
      pendingAudios.add(audio)
    })

    audioRefs.current.set(peerId, audio)
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
        // 应用当前开关状态
        if (!micOnRef.current) manager.toggleMic(false)
        console.log('[useWebRTC] WebRTC 已初始化')
      } catch (err) {
        console.error('[useWebRTC] 初始化失败:', err)
      }
    }

    init()

    return () => {
      mounted = false
      audioRefs.current.forEach((audio) => {
        audio.srcObject = null
        pendingAudios.delete(audio)
        audio.remove()
      })
      audioRefs.current.clear()
      destroyWebRTCManager()
    }
  }, [user?.id])

  // 麦克风开关
  const toggleMic = useCallback(() => {
    const manager = getWebRTCManager()
    const newState = !micOn
    setMicOn(newState)
    manager?.toggleMic(newState)
  }, [micOn])

  // 扬声器开关
  const toggleSpeaker = useCallback(() => {
    const manager = getWebRTCManager()
    const newState = !speakerOn
    setSpeakerOn(newState)
    manager?.toggleSpeaker(newState)
  }, [speakerOn])

  // 屏幕共享开关
  const toggleScreenShare = useCallback(async () => {
    const manager = getWebRTCManager()
    if (!manager) return

    if (manager.isSharingScreen) {
      manager.stopScreenShare()
      if (roomId) notifyScreenShareStop(roomId)
    } else {
      const stream = await manager.startScreenShare(() => {
        // 用户通过浏览器 UI 停止共享时，通知远端
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
