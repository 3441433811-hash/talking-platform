// WebRTC 管理器 — 处理多人语音通话（Mesh 架构）
// 每个远程用户维护一个 RTCPeerConnection，通过 Socket.IO 信令交换 SDP/ICE

import { sendAnswer, sendOffer, sendIceCandidate } from './socket'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
    this.screenStream = null                      // 本地屏幕共享流
    this.isSharingScreen = false                  // 是否正在共享
    this.peers = new Map()                        // userId → RTCPeerConnection
    this.remoteStreams = new Map()                // userId → MediaStream (音频)
    this.remoteScreenStreams = new Map()          // userId → MediaStream (屏幕)
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
    // 获取本地麦克风
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })

    // 监听信令事件
    window.addEventListener('webrtc-offer', this._boundOffer)
    window.addEventListener('webrtc-answer', this._boundAnswer)
    window.addEventListener('webrtc-ice', this._boundIce)
    window.addEventListener('webrtc-user-joined', this._boundUserJoined)
    window.addEventListener('webrtc-user-left', this._boundUserLeft)
    window.addEventListener('webrtc-screen-start', this._boundScreenShareStart)
    window.addEventListener('webrtc-screen-stop', this._boundScreenShareStop)

    // 设置音频分析
    await this._setupAudioAnalyser('local', this.localStream)

    // 检测本地说话状态
    this._startSpeakingDetection('local', this.localStream)

    console.log('[WebRTC] 本地媒体已就绪')
    return this.localStream
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

    // 如果已有连接，先关闭旧的
    if (this.peers.has(peerId)) {
      this._removePeer(peerId)
    }

    try {
      await this._createPeerConnection(peerId)
      const pc = this.peers.get(peerId)
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      // 发送 Answer
      sendAnswer(fromId, pc.localDescription)
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

  // 收到远程屏幕共享开始通知
  _handleScreenShareStart(e) {
    const { userId } = e.detail
    console.log('[WebRTC] 远程用户开始屏幕共享:', userId)
    // 屏幕流通过 ontrack 事件自动接收（视频轨）
  }

  // 收到远程屏幕共享停止通知
  _handleScreenShareStop(e) {
    const { userId } = e.detail
    console.log('[WebRTC] 远程用户停止屏幕共享:', userId)
    this.remoteScreenStreams.delete(userId)
    if (this.onScreenShare) {
      this.onScreenShare(null, null, false)
    }
  }

  // 开始本地屏幕共享
  async startScreenShare() {
    if (this.isSharingScreen) return null

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },
        audio: false,
      })

      this.screenStream = stream
      this.isSharingScreen = true

      // 添加到所有已有 PeerConnection
      const videoTrack = stream.getVideoTracks()[0]
      this.peers.forEach((pc) => {
        if (pc.connectionState === 'connected') {
          pc.addTrack(videoTrack, stream)
        }
      })

      // 用户通过浏览器 UI 停止共享时自动清理
      videoTrack.onended = () => {
        this.stopScreenShare()
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
      // 从所有 PeerConnection 中移除
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
      const [remoteStream] = event.streams
      if (!remoteStream) return

      const isVideo = event.track.kind === 'video'

      if (isVideo) {
        // 屏幕共享视频流
        console.log('[WebRTC] 收到远程屏幕流:', peerId)
        this.remoteScreenStreams.set(peerId, remoteStream)
        if (this.onScreenShare) {
          this.onScreenShare(peerId, remoteStream, false)
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

  // ==================== 音频控制 ====================

  // 开关麦克风
  toggleMic(enabled) {
    if (!this.localStream) return
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = enabled
    })
  }

  // 开关扬声器（静音所有远程音频元素）
  toggleSpeaker(enabled) {
    const audioEls = document.querySelectorAll('audio[data-peer]')
    audioEls.forEach((el) => {
      el.muted = !enabled
    })
  }

  // ==================== 音量检测（说话状态） ====================

  async _setupAudioAnalyser(peerId, stream) {
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
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
