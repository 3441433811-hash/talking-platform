import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createWebRTCManager,
  destroyWebRTCManager,
  getWebRTCManager,
} from '../services/webrtc'
import { startScreenShare as notifyScreenShareStart, stopScreenShare as notifyScreenShareStop } from '../services/socket'
import useStore from '../store/useStore'

// ── Web Audio API 播放器（通用音频输出，不依赖 <audio>/<video>）───
// 手机浏览器的 autoplay 策略只限制 HTMLMediaElement，
// Web Audio API 只要 AudioContext 被用户手势 resume 后就能直接输出到扬声器。
// 同时解决 iOS 听筒/扬声器路由问题：AudioContext.destination 默认走扬声器。

let playbackCtx = null
let ctxResumed = false

function getPlaybackCtx() {
  if (!playbackCtx) {
    playbackCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return playbackCtx
}

function resumePlaybackCtx() {
  const ctx = getPlaybackCtx()
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => {
      ctxResumed = true
      console.log('[Audio] AudioContext 已通过用户手势恢复')
    }).catch(() => {})
  } else {
    ctxResumed = true
  }
}

// 全局：任何用户交互都恢复 AudioContext（持久监听）
document.addEventListener('click', resumePlaybackCtx)
document.addEventListener('touchstart', resumePlaybackCtx, { passive: true })

export default function useWebRTC(roomId) {
  const user = useStore((s) => s.user)
  const setSpeaking = useStore((s) => s.setSpeaking)
  const setScreenSharer = useStore((s) => s.setScreenSharer)

  const [micOn, setMicOn] = useState(true)
  const [speakerOn, setSpeakerOn] = useState(true)
  const [peerCount, setPeerCount] = useState(0)
  const [isSharing, setIsSharing] = useState(false)
  const [screenStream, setScreenStream] = useState(null)
  const audioNodes = useRef(new Map())  // peerId → { source, gain }
  const micOnRef = useRef(true)
  const speakerOnRef = useRef(true)
  micOnRef.current = micOn
  speakerOnRef.current = speakerOn

  // 远程音频流到达 — 直接走 Web Audio API，不创建 HTML 元素
  const handleRemoteStream = useCallback((peerId, stream) => {
    // 清理旧节点
    const old = audioNodes.current.get(peerId)
    if (old) {
      try { old.source.disconnect() } catch {}
      try { old.gain.disconnect() } catch {}
      audioNodes.current.delete(peerId)
    }

    const ctx = getPlaybackCtx()
    try {
      const source = ctx.createMediaStreamSource(stream)
      const gain = ctx.createGain()
      gain.gain.value = speakerOnRef.current ? 1 : 0
      source.connect(gain)
      gain.connect(ctx.destination)

      audioNodes.current.set(peerId, { source, gain })

      // 如果 AudioContext 还 suspended，尝试恢复（已有用户手势时直接成功）
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }

      console.log('[Audio] Web Audio 播放器已连接, peer:', peerId, 'state:', ctx.state)
    } catch (err) {
      console.error('[Audio] Web Audio 连接失败:', peerId, err)
    }
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
      audioNodes.current.forEach(({ source, gain }) => {
        try { source.disconnect() } catch {}
        try { gain.disconnect() } catch {}
      })
      audioNodes.current.clear()
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
    const next = !speakerOn
    setSpeakerOn(next)
    // 更新所有 Web Audio 增益节点
    audioNodes.current.forEach(({ gain }) => {
      gain.gain.value = next ? 1 : 0
    })
    // 同时处理 HTML 元素（屏幕共享视频等）
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
