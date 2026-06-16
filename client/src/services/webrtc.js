// WebRTC 管理器 — 处理多人语音通话（Mesh 架构）
// 每个远程用户维护一个 RTCPeerConnection，通过 Socket.IO 信令交换 SDP/ICE

import { sendAnswer, sendOffer, sendIceCandidate, getSocket } from './socket'

const ICE_SERVERS = {
  iceServers: [
    // Google STUN（NAT 类型检测 + 直连尝试）
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Metered.ca 免费 TURN（全球多区域）
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    // Twilio 免费 TURN（亚洲区域可用）
    {
      urls: [
        'turn:global.turn.twilio.com:3478?transport=udp',
        'turn:global.turn.twilio.com:3478?transport=tcp',
        'turn:global.turn.twilio.com:443?transport=tcp',
      ],
      username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6ca97b50e6e3340a1bf4fca0f685',
      credential: 'iMF4v7n0KJFJZmGbbrAqksGGQvWyL6PqIbMrAHSIbaY=',
    },
  ],
}

const PC_CONFIG = {
  ...ICE_SERVERS,
  iceCandidatePoolSize: 0,
}

class WebRTCManager {
  constructor({ userId, onRemoteStream, onPeerCountChange, onSpeaking, onScreenShare }) {
    this.userId = userId                          // 本地用户 ID
    this.onRemoteStream = onRemoteStream          // 远程流回调 (userId, stream)
    this.onPeerCountChange = onPeerCountChange    // 连接数变化 (count)
    this.onSpeaking = onSpeaking                  // 说话状态 (userId, isSpeaking)
    this.onScreenShare = onScreenShare            // 屏幕共享回调 (sharerUserId, stream, isLocal)

    this.localStream = null                       // 本地麦克风流
    this._retryingMic = null                      // retryMic 防并发锁
    this.screenStream = null                      // 本地屏幕共享流
    this.isSharingScreen = false                  // 是否正在共享
    this.peers = new Map()                        // userId → RTCPeerConnection
    this.remoteStreams = new Map()                // userId → MediaStream (音频)
    this.remoteScreenStreams = new Map()          // userId → MediaStream (屏幕)
    this.screenVideos = new Map()                 // userId → HTMLVideoElement
    this.audioContext = null                      // 用于音量检测
    this.analysers = new Map()                    // userId → AnalyserNode

    this._boundOffer = this._handleOffer.bind(this)
    this._boundAnswer = this._handleAnswer.bind(this)
    this._boundIce = this._handleIce.bind(this)
    this._boundUserJoined = this._handleUserJoined.bind(this)
    this._boundUserLeft = this._handleUserLeft.bind(this)
    this._boundScreenShareStart = this._handleScreenShareStart.bind(this)
    this._boundScreenShareStop = this._handleScreenShareStop.bind(this)
  }

  // ==================== 初始化 ====================

  async start() {
    // ⚠️ 关键：先注册信令监听，再获取本地媒体。
    // 手机浏览器（iOS Safari、部分安卓）禁止在无用户手势时调用 getUserMedia，
    // 如果先等待 getUserMedia 再注册监听，信令事件（offer/answer/ICE）会被丢掉，
    // 导致手机端无法接收任何远程音频/屏幕流。
    window.addEventListener('webrtc-offer', this._boundOffer)
    window.addEventListener('webrtc-answer', this._boundAnswer)
    window.addEventListener('webrtc-ice', this._boundIce)
    window.addEventListener('webrtc-user-joined', this._boundUserJoined)
    window.addEventListener('webrtc-user-left', this._boundUserLeft)
    window.addEventListener('webrtc-screen-start', this._boundScreenShareStart)
    window.addEventListener('webrtc-screen-stop', this._boundScreenShareStop)

    // 不在初始化时获取麦克风 — 移动端必须由用户手势触发（点按钮）
    // 桌面端可以尝试自动获取
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouchDevice) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        })
        await this._setupAudioAnalyser('local', this.localStream)
        this._startSpeakingDetection('local', this.localStream)
        console.log('[WebRTC] 本地麦克风已就绪')
      } catch (err) {
        console.warn('[WebRTC] 本地麦克风不可用（仅接收模式）:', err.message)
        this.localStream = null
      }
    } else {
      console.log('[WebRTC] 移动端：跳过初始麦克风获取，等待用户点击按钮')
    }

    console.log('[WebRTC] 信令监听已就绪, 本地麦克风:', !!this.localStream)
    return this.localStream
  }

  // 移动端重试获取麦克风（必须在用户手势中同步调用）
  async retryMic() {
    if (this.localStream) {
      const audioTracks = this.localStream.getAudioTracks()
      audioTracks.forEach((t) => { t.enabled = true })
      // 强制重启所有 peer 的 audio sender —— 仅设 enabled=true 有时浏览器不恢复编码
      if (audioTracks.length > 0) {
        const audioTrack = audioTracks[0]
        const ops = []
        for (const pc of this.peers.values()) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
          if (sender) {
            ops.push(
              sender.replaceTrack(null).then(() =>
                sender.replaceTrack(audioTrack)
              ).catch((err) => {
                console.warn('[WebRTC] replaceTrack 恢复失败:', err.message)
              })
            )
          }
        }
        // 等待所有 replaceTrack 完成，避免 hook 中 toggleMic(true) 竞态
        await Promise.allSettled(ops)
      }
      return this.localStream
    }
    if (this._retryingMic) return this._retryingMic

    // 直接调用 getUserMedia（不用 async IIFE），iOS 要求 Promise 在用户手势栈中创建
    const promise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }).then((stream) => {
      this.localStream = stream
      // _setupAudioAnalyser 不再 await resume，不会阻塞
      this._setupAudioAnalyser('local', stream)
      this._startSpeakingDetection('local', stream)
      // peer 重协商不阻塞 Promise 链，避免 setMicOn(true) 迟迟不触发
      for (const [peerId, pc] of this.peers) {
        stream.getTracks().forEach((t) => pc.addTrack(t, stream))
        pc.createOffer().then((offer) =>
          pc.setLocalDescription(offer).then(() =>
            getSocket()?.emit('offer', { targetId: peerId, sdp: pc.localDescription })
          )
        ).catch((err) => {
          console.warn('[WebRTC] 重协商失败:', peerId, err.message)
        })
      }
      console.log('[WebRTC] 麦克风重试成功')
      return this.localStream
    }).catch((err) => {
      console.warn('[WebRTC] 麦克风重试失败:', err.message)
      if (err.name === 'NotAllowedError') {
        alert('无法访问麦克风。请在浏览器设置中允许麦克风权限，然后刷新页面。')
      }
      this._retryingMic = null
      return null
    }).finally(() => {
      if (this._retryingMic === promise) this._retryingMic = null
    })

    this._retryingMic = promise
    return promise
  }

  // ==================== 信令事件处理 ====================

  // 有新用户加入 → 创建 Offer
  async _handleUserJoined(e) {
    const { userId, userInfo } = e.detail
    if (userId === this.userId || this.peers.has(userId)) return

    console.log('[WebRTC] 新用户加入，创建 Offer:', userId)
    await this._createPeerConnection(userId)
    await this._createOffer(userId)
  }

  // 用户离开
  _handleUserLeft(e) {
    const { userId } = e.detail
    this._removePeer(userId)
  }

  // 收到 Offer → 创建 Answer
  async _handleOffer(e) {
    const { fromId, userId, sdp } = e.detail
    const peerId = userId || fromId
    if (peerId === this.userId) return

    console.log('[WebRTC] 收到 Offer，来自:', peerId)

    try {
      // 关键修复：如果已有 PC，复用现有连接处理重协商（屏幕共享添加 track 等场景）
      // 不再销毁旧的 PC，否则会导致 ontrack 事件丢失和 ICE 重连
      if (this.peers.has(peerId)) {
        const pc = this.peers.get(peerId)
        console.log('[WebRTC] 复用已有 PC 处理重协商, signalingState:', pc.signalingState, 'iceState:', pc.iceConnectionState)

        // 处理 glare（双方同时发 offer）：本地正在 offer 时收到对方的 offer
        if (pc.signalingState === 'have-local-offer') {
          console.log('[WebRTC] 检测到 glare，回滚本地 offer 后处理远程 offer')
          await pc.setLocalDescription({ type: 'rollback' })
        }

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          // 使用 userId 而非 socketId 作为路由键（服务端按 userId 精准路由）
          sendAnswer(peerId, pc.localDescription)
          console.log('[WebRTC] 重协商 Answer 已发送:', peerId)
        } catch (err) {
          console.error('[WebRTC] 重协商失败, signalingState:', pc.signalingState, 'error:', err.message)
          // 如果 setRemoteDescription 失败，尝试回滚后重试一次
          if (err.name === 'InvalidStateError' && pc.signalingState !== 'stable') {
            try { await pc.setLocalDescription({ type: 'rollback' }) } catch (_) {}
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(sdp))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              sendAnswer(peerId, pc.localDescription)
              console.log('[WebRTC] 重协商重试成功:', peerId)
            } catch (retryErr) {
              console.error('[WebRTC] 重协商重试也失败:', retryErr.message)
            }
          }
        }
        return
      }

      // 新连接：创建 PeerConnection
      await this._createPeerConnection(peerId)
      const pc = this.peers.get(peerId)
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      sendAnswer(peerId, pc.localDescription)
    } catch (err) {
      console.error('[WebRTC] 处理 Offer 失败:', err)
    }
  }

  // 收到 Answer → 设置远程描述
  async _handleAnswer(e) {
    const { fromId, userId, sdp } = e.detail
    const peerId = userId || fromId
    const pc = this.peers.get(peerId)
    if (!pc) {
      console.warn('[WebRTC] 收到 Answer 但 PeerConnection 不存在:', peerId)
      return
    }

    console.log('[WebRTC] 收到 Answer，来自:', peerId)
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    } catch (err) {
      console.error('[WebRTC] 设置远程描述失败:', err)
    }
  }

  // 收到 ICE Candidate
  async _handleIce(e) {
    const { fromId, userId, candidate } = e.detail
    const peerId = userId || fromId
    const pc = this.peers.get(peerId)
    if (!pc || !candidate) return

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.error('[WebRTC] 添加 ICE 失败:', err)
    }
  }

  // ==================== 屏幕共享 ====================

  // 收到远程屏幕共享开始通知（信令层通知，主要用于日志；实际视频流通过 ontrack 到达）
  _handleScreenShareStart(e) {
    const { userId } = e.detail
    console.log('[WebRTC] 远程用户开始屏幕共享:', userId)
    // 屏幕流通过 ontrack 事件自动接收（视频轨）
  }

  // 收到远程屏幕共享停止通知
  _handleScreenShareStop(e) {
    const { userId } = e.detail
    console.log('[WebRTC] 远程用户停止屏幕共享:', userId)
    this._hideScreenVideo(userId)
    if (this.onScreenShare) {
      this.onScreenShare(null, null, false)
    }
  }

  // 开始本地屏幕共享
  async startScreenShare(onStop) {
    if (this.isSharingScreen) return null

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 10 },
          width: { max: 1280 },
          height: { max: 720 },
        },
        audio: false,
      })

      this.screenStream = stream
      this.isSharingScreen = true

      // 添加到所有已有 PeerConnection 并显式重协商
      const videoTrack = stream.getVideoTracks()[0]
      const skt = getSocket()
      console.log('[WebRTC] 开始屏幕共享, peers:', this.peers.size, 'track readyState:', videoTrack?.readyState)
      for (const [peerId, pc] of this.peers) {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          console.log('[WebRTC] 跳过 peer (state:', pc.connectionState, '):', peerId)
          continue
        }

        // 等待 signalingState 稳定，避免与正在进行的重协商冲突
        const waitStart = Date.now()
        while (pc.signalingState !== 'stable' && Date.now() - waitStart < 5000) {
          console.log('[WebRTC] 等待 stable, current:', pc.signalingState, 'peer:', peerId)
          await new Promise(r => setTimeout(r, 100))
        }
        if (pc.signalingState !== 'stable') {
          console.warn('[WebRTC] 等待 stable 超时, 跳过 peer:', peerId)
          continue
        }

        pc.addTrack(videoTrack, stream)

        // 限制屏幕共享编码带宽（减少 TURN 中继压力）
        try {
          const sender = pc.getSenders().find(s => s.track === videoTrack)
          if (sender) {
            const params = sender.getParameters()
            if (!params.encodings) params.encodings = [{}]
            params.encodings[0].maxBitrate = 1000000 // 1 Mbps
            await sender.setParameters(params)
          }
        } catch (e) {
          console.warn('[WebRTC] setParameters 失败:', e.message)
        }

        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          if (skt?.connected) {
            skt.emit('offer', { targetId: peerId, sdp: pc.localDescription })
          }
          console.log('[WebRTC] 屏幕共享 offer 已发送 to:', peerId, 'signalingState:', pc.signalingState)
        } catch (err) {
          console.error('[WebRTC] 屏幕共享重协商失败:', peerId, err.message)
        }
      }

      // 用户通过浏览器 UI 停止共享时自动清理
      videoTrack.onended = () => {
        console.log('[WebRTC] 屏幕视频 track 结束 (浏览器停止共享)')
        this.stopScreenShare()
        if (onStop) onStop()
      }

      console.log('[WebRTC] 屏幕共享已开始')
      if (this.onScreenShare) {
        this.onScreenShare(this.userId, stream, true)
      }

      return stream
    } catch (err) {
      console.error('[WebRTC] 屏幕共享失败:', err)
      return null
    }
  }

  // 停止本地屏幕共享
  stopScreenShare() {
    if (!this.isSharingScreen || !this.screenStream) return

    const tracks = this.screenStream.getVideoTracks()
    tracks.forEach((track) => {
      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track === track)
        if (sender) pc.removeTrack(sender)
      })
      track.stop()
    })

    this.screenStream = null
    this.isSharingScreen = false

    console.log('[WebRTC] 屏幕共享已停止')
    if (this.onScreenShare) {
      this.onScreenShare(null, null, false)
    }
  }

  // ==================== PeerConnection 管理 ====================

  async _createPeerConnection(peerId) {
    const pc = new RTCPeerConnection(PC_CONFIG)

    // 添加本地音轨
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream)
      })
    }

    // 如果正在共享屏幕，也添加到新连接
    if (this.isSharingScreen && this.screenStream) {
      this.screenStream.getVideoTracks().forEach((track) => {
        pc.addTrack(track, this.screenStream)
      })
    }

    // 处理 ICE Candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate(peerId, event.candidate)
      }
    }

    // 处理远程音轨/屏幕视频轨
    pc.ontrack = (event) => {
      // event.streams 在 renegotiation 场景下可能为空数组（Chrome bug）
      // 降级方案：从 track 手动构造 MediaStream
      const remoteStream = event.streams[0] || new MediaStream([event.track])
      const isVideo = event.track.kind === 'video'

      console.log('[WebRTC] ontrack:', isVideo ? 'VIDEO' : 'AUDIO', 'peer:', peerId,
        'streamsCount:', event.streams.length, 'trackState:', event.track.readyState)

      if (isVideo) {
        // 屏幕共享视频流 — 直接挂载到 body（独立于 React 管控，避免 reconciliation 冲突）
        this.remoteScreenStreams.set(peerId, remoteStream)
        this._showScreenVideo(peerId, remoteStream)

        // 同时通知 React 更新状态（UI 标签等）
        if (this.onScreenShare) {
          this.onScreenShare(peerId, remoteStream, false)
        }

        // track 结束时清理
        event.track.onended = () => {
          console.log('[WebRTC] 屏幕视频 track 结束:', peerId)
          this._hideScreenVideo(peerId)
          if (this.onScreenShare) {
            this.onScreenShare(null, null, false)
          }
        }
      } else {
        // 音频流
        console.log('[WebRTC] 收到远程音轨:', peerId)
        this.remoteStreams.set(peerId, remoteStream)
        this._setupAudioAnalyser(peerId, remoteStream)
        this._startSpeakingDetection(peerId, remoteStream)
        if (this.onRemoteStream) {
          this.onRemoteStream(peerId, remoteStream)
        }
      }
    }

    // 连接状态
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] 连接状态 [${peerId}]:`, pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this._removePeer(peerId)
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this._removePeer(peerId)
      }
    }

    this.peers.set(peerId, pc)
    this._notifyPeerCount()
    return pc
  }

  async _createOffer(peerId) {
    const pc = this.peers.get(peerId)
    if (!pc) return

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      sendOffer(peerId, pc.localDescription)
      console.log('[WebRTC] Offer 已发送给:', peerId)
    } catch (err) {
      console.error('[WebRTC] 创建 Offer 失败:', err)
    }
  }

  _removePeer(peerId) {
    const pc = this.peers.get(peerId)
    if (pc) {
      pc.close()
      this.peers.delete(peerId)
    }
    this.remoteStreams.delete(peerId)
    this._hideScreenVideo(peerId)
    if (this.analysers.has(peerId)) {
      this.analysers.delete(peerId)
    }
    this._notifyPeerCount()
    console.log('[WebRTC] Peer 已移除:', peerId)
  }

  _notifyPeerCount() {
    if (this.onPeerCountChange) {
      this.onPeerCountChange(this.peers.size)
    }
  }

  // ==================== 屏幕视频直接渲染 ====================

  _showScreenVideo(peerId, stream) {
    this._hideScreenVideo(peerId)

    const video = document.createElement('video')
    video.srcObject = stream
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    video.id = `screen-video-${peerId}`
    // 刚好占住中间框（左栏 200px ~ 右栏 320px）
    video.style.cssText = `
      position: fixed;
      top: 50%;
      left: calc((100vw - 120px) / 2);
      transform: translate(-50%, -50%);
      max-width: calc(100vw - 520px);
      min-width: 300px;
      max-height: 75vh;
      min-height: 200px;
      border-radius: 12px;
      border: 2px solid rgba(108, 99, 255, 0.5);
      z-index: 500;
      box-shadow: 0 0 40px rgba(0,0,0,0.6);
      opacity: 0;
      transition: opacity 0.2s ease-in;
    `

    // 视频元数据加载后再显示，避免空白元素闪烁
    video.addEventListener('loadedmetadata', () => {
      video.style.opacity = '1'
    }, { once: true })

    document.body.appendChild(video)
    this.screenVideos.set(peerId, video)

    const playPromise = video.play()
    if (playPromise) {
      playPromise.catch((e) => console.warn('[WebRTC] video.play() 被阻:', e.name))
    }

    const track = stream.getVideoTracks()[0]
    console.log('[WebRTC] 屏幕视频已挂载到主界面, track:', track?.readyState,
      'streamId:', stream.id, 'trackCount:', stream.getVideoTracks().length)
  }

  _hideScreenVideo(peerId) {
    const video = this.screenVideos.get(peerId)
    if (video) {
      video.srcObject = null
      video.remove()
      this.screenVideos.delete(peerId)
      console.log('[WebRTC] 屏幕视频已移除:', peerId)
    }
    this.remoteScreenStreams.delete(peerId)
  }

  // ==================== 音频控制 ====================

  // 开关麦克风
  toggleMic(enabled) {
    if (!this.localStream) return
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = enabled
    })
  }

  // 开关扬声器（静音所有远程音频/视频元素）
  toggleSpeaker(enabled) {
    const els = document.querySelectorAll('[data-peer]')
    els.forEach((el) => {
      el.muted = !enabled
    })
  }

  // ==================== 音量检测（说话状态） ====================

  async _setupAudioAnalyser(peerId, stream) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
        // 移动端 AudioContext 默认 suspended，需用户手势恢复
        if (this.audioContext.state === 'suspended') {
          const resume = () => {
            this.audioContext?.resume().catch(() => {})
            if (this.audioContext?.state === 'running') {
              document.removeEventListener('click', resume)
              document.removeEventListener('touchstart', resume)
            }
          }
          document.addEventListener('click', resume)
          document.addEventListener('touchstart', resume, { passive: true })
        }
      }
      // 移动端 AudioContext 默认 suspended，非手势上下文 resume() 可能永不 resolve
      // 不 await，跳过 analyser 创建（说话检测非核心功能，不能阻塞音频）
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {})
        return
      }
      const source = this.audioContext.createMediaStreamSource(stream)
      const analyser = this.audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      this.analysers.set(peerId, analyser)
    } catch (err) {
      console.warn('[WebRTC] 音频分析器创建失败:', err)
    }
  }

  _startSpeakingDetection(peerId, stream) {
    const analyser = this.analysers.get(peerId)
    if (!analyser) return

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    let speaking = false

    const check = () => {
      if (!this.analysers.has(peerId)) return
      analyser.getByteFrequencyData(dataArray)
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      const isSpeaking = avg > 30 // 阈值

      if (isSpeaking !== speaking) {
        speaking = isSpeaking
        if (this.onSpeaking && peerId !== 'local') {
          this.onSpeaking(peerId, speaking)
        }
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  }

  // ==================== 销毁 ====================

  destroy() {
    // 停止屏幕共享
    if (this.isSharingScreen) {
      this.stopScreenShare()
    }

    // 停止本地流
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }

    // 关闭所有连接
    this.peers.forEach((pc, peerId) => {
      pc.close()
    })
    this.peers.clear()
    this.remoteStreams.clear()
    this.analysers.clear()

    // 关闭音频上下文
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    // 移除事件监听
    window.removeEventListener('webrtc-offer', this._boundOffer)
    window.removeEventListener('webrtc-answer', this._boundAnswer)
    window.removeEventListener('webrtc-ice', this._boundIce)
    window.removeEventListener('webrtc-user-joined', this._boundUserJoined)
    window.removeEventListener('webrtc-user-left', this._boundUserLeft)
    window.removeEventListener('webrtc-screen-start', this._boundScreenShareStart)
    window.removeEventListener('webrtc-screen-stop', this._boundScreenShareStop)

    console.log('[WebRTC] 已销毁')
  }
}

// 单例
let instance = null

export function getWebRTCManager() {
  return instance
}

export function createWebRTCManager(opts) {
  if (instance) instance.destroy()
  instance = new WebRTCManager(opts)
  return instance
}

export function destroyWebRTCManager() {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
