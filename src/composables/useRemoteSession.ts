import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { onUnmounted, ref, type Ref } from 'vue'
import { api } from '@/services/api'
import { useAppStore } from '@/stores/app'
import type { ControlCommand, DisplayInfo, SessionState, SignalMessage } from '@/types/remote'

/**
 * 远程会话核心
 *
 * 三级重连（切后台 / 锁屏 / 网络切换后自动恢复）：
 *   L1  连接仍存活        → 什么都不做（短时后台 iOS 会自愈）
 *   L2  ICE 断但 STOMP 在 → ICE Restart，1-3s
 *   L3  STOMP 也断了      → 全量重建，3-8s
 *
 * ⚠️ glare 规避：约定【只有控制端发起 ICE Restart】，受控端只应答。
 *    双方同时发起会导致信令冲突，连接反复失败。
 */
export function useRemoteSession(sessionCode: string) {
  const state = ref<SessionState>('idle')
  const videoRef: Ref<HTMLVideoElement | null> = ref(null)
  const displays = ref<DisplayInfo[]>([])
  const activeDisplayId = ref<number | null>(null)
  const errorMessage = ref('')
  /** 推流画质：与控制端 UI 双向绑定，默认 low（省带宽） */
  const quality = ref<'low' | 'medium' | 'high'>('low')
  /** 推流分辨率：与控制端 UI 双向绑定，默认 480p（最省带宽） */
  const resolution = ref<'480p' | '720p' | '1080p' | 'native'>('480p')

  // 复用全局 SignalingClient（登录后常驻的 STOMP 连接）
  const appStore = useAppStore()
  // 用 getter 保证每次取到最新的 signaling 实例（connectSync 后才被赋值）
  const getSignaling = () => appStore.signaling
  let pc: RTCPeerConnection | null = null
  let dc: RTCDataChannel | null = null

  let retryCount = 0
  let pendingCandidates: RTCIceCandidateInit[] = []
  let remoteSdpSet = false
  let aliveTimer: number | undefined
  let cleanups: Array<() => void> = []
  let destroyed = false

  const MAX_RETRY = 5

  /* ────────────────────────────────────────────────────────────
     工具
     ──────────────────────────────────────────────────────────── */
  function waitFor(cond: () => boolean, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const tick = () => {
        if (destroyed) return reject(new Error('destroyed'))
        if (cond()) return resolve()
        if (Date.now() - start > timeout) return reject(new Error('timeout'))
        setTimeout(tick, 200)
      }
      tick()
    })
  }

  function send(cmd: ControlCommand) {
    if (dc?.readyState === 'open') {
      dc.send(JSON.stringify(cmd))
    }
  }

  /* ────────────────────────────────────────────────────────────
     ICE 服务器
     ──────────────────────────────────────────────────────────── */
  /**
   * 构建 ICE 服务器列表
   *
   * 顺序有讲究：**STUN 先、TURN 后**。
   *
   * 为什么内网也需要 STUN：浏览器默认用 mDNS（xxx.local）隐藏本机 IP，
   * 两端都只有 mDNS 候选时无法配对 —— 表现为「SDP 交换正常但画面始终不出来」。
   * 有了 STUN 才能拿到真实 IP，绕过该限制。这是内网连不上的头号原因。
   *
   * 优先级：后端下发 > 环境变量兜底 > 仅本机候选。
   */
  async function buildIceServers(): Promise<RTCIceServer[]> {
    const servers: RTCIceServer[] = []

    try {
      const cred = await api.getTurnCredentials()
      // STUN 无需凭证，必须单独一项
      if (cred?.stunUrls?.length) {
        servers.push({ urls: cred.stunUrls })
      }
      // TURN 用后端签发的短期凭证（HMAC-SHA1 + TTL），绝不硬编码账号密码
      if (cred?.urls?.length) {
        servers.push({ urls: cred.urls, username: cred.username, credential: cred.credential })
      }
    } catch (e) {
      // 后端接口不可用时，回退到环境变量里的 STUN
      console.warn('[rtc] 获取 ICE 配置失败，回退到环境变量:', e)
      const turnUrl = import.meta.env.VITE_TURN_URL?.trim()
      if (turnUrl) {
        try {
          servers.push({ urls: [`stun:${new URL(turnUrl).host}`] })
        } catch {
          console.warn('[rtc] VITE_TURN_URL 格式不合法，已忽略:', turnUrl)
        }
      }
    }

    if (servers.length === 0) {
      // 合法场景：纯内网直连。但要注意 mDNS 可能导致连不上，
      // 此时应在后端 coturn.stun-urls 配一个 STUN。
      console.info('[rtc] 无 STUN/TURN，仅使用本机候选地址（纯内网直连）')
    }
    return servers
  }

  /* ────────────────────────────────────────────────────────────
     PeerConnection
     ──────────────────────────────────────────────────────────── */
  function createPeer(iceServers: RTCIceServer[]): RTCPeerConnection {
    teardownPeer()

    pendingCandidates = []
    remoteSdpSet = false

    pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (!videoRef.value || !stream) return
      videoRef.value.srcObject = stream
      // iOS 无用户手势时 play() 会 reject；UI 上有"点击继续"兜底
      void videoRef.value.play().catch(() => {})
    }

    // ⚠️ DataChannel 由【offer 方】创建，本端是 answer 方，只能接收。
    //    若两边都在自己 createDataChannel，SDP 里不会出现对应的 m-line，
    //    通道永远不会真正建立（画面正常但发不出任何指令）。
    pc.ondatachannel = (e) => {
      dc = e.channel
      dc.onopen = () => {
        state.value = 'live'
        retryCount = 0
        errorMessage.value = ''
        // 同步当前画质与分辨率：确保受控端与我们一致（默认 low / 480p）
        send({ t: 'q', q: quality.value })
        send({ t: 'rs', r: resolution.value })
      }
      dc.onclose = () => {
        if (state.value === 'live') void onResume()
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        getSignaling()?.publish({ type: 'candidate', candidate: e.candidate.toJSON() })
      }
    }

    pc.oniceconnectionstatechange = () => {
      const s = pc?.iceConnectionState
      // disconnected 可能是瞬时抖动，等 2s 再看，避免无谓的 restart
      if (s === 'disconnected') {
        setTimeout(() => {
          if (pc && pc.iceConnectionState !== 'connected') void doIceRestart()
        }, 2_000)
      }
      if (s === 'failed') void doIceRestart()
    }

    pc.onconnectionstatechange = () => {
      const s = pc?.connectionState
      if (s === 'failed') void doIceRestart()
      if (s === 'connected') {
        state.value = 'live'
        retryCount = 0
      }
    }

    return pc
  }

  function teardownPeer() {
    try {
      dc?.close()
      pc?.close()
    } catch {
      /* 已关闭，忽略 */
    }
    dc = null
    pc = null
  }

  /* ────────────────────────────────────────────────────────────
     信令处理
     ──────────────────────────────────────────────────────────── */
  async function flushCandidates() {
    for (const c of pendingCandidates) {
      try {
        await pc?.addIceCandidate(new RTCIceCandidate(c))
      } catch (e) {
        console.warn('[rtc] addIceCandidate 失败:', e)
      }
    }
    pendingCandidates = []
  }

  async function handleSignal(msg: SignalMessage) {
    if (!pc) return

    switch (msg.type) {
      case 'displays': {
        // 防御：受控端异常时可能下发 null，直接落库会让模板 displays.length 崩
        const list = msg.displays ?? []
        displays.value = list
        activeDisplayId.value = list.find((d) => d.primary)?.id ?? list[0]?.id ?? null
        break
      }

      case 'offer': {
        // 受控端主动发起（它检测到断连后重建），控制端应答
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
        remoteSdpSet = true
        await flushCandidates()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        getSignaling()?.publish({ type: 'answer', sdp: pc.localDescription! })
        break
      }

      case 'answer':
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
        remoteSdpSet = true
        await flushCandidates()
        break

      case 'candidate':
        if (!msg.candidate) break
        if (remoteSdpSet) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
        else pendingCandidates.push(msg.candidate) // 缓存，等 remoteSdp 就绪再灌
        break

      case 'terminated':
        errorMessage.value = msg.reason ?? '受控端已结束会话'
        state.value = 'dead'
        teardownPeer()
        break

      default:
        break
    }
  }

  /* ────────────────────────────────────────────────────────────
     L2：ICE Restart
     ──────────────────────────────────────────────────────────── */
  async function doIceRestart() {
    if (!pc || destroyed) return
    if (state.value === 'recovering' || state.value === 'rebuilding') return

    state.value = 'recovering'
    try {
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      getSignaling()?.publish({ type: 'offer', sdp: pc.localDescription!, restart: true })
      await waitFor(() => pc!.iceConnectionState === 'connected', 8_000)
      state.value = 'live'
      retryCount = 0
      errorMessage.value = ''
    } catch {
      await fullRebuild()
    }
  }

  /* ────────────────────────────────────────────────────────────
     L3：全量重建
     ──────────────────────────────────────────────────────────── */
  async function fullRebuild() {
    if (destroyed || state.value === 'rebuilding') return
    state.value = 'rebuilding'

    teardownPeer()

    try {
      // 复用全局 STOMP 连接，只追加信令订阅
      const sig = getSignaling()
      sig?.unsubscribeSignal()
      sig?.subscribeSignal(sessionCode)
      createPeer(await buildIceServers())
      sig?.publish({ type: 'join', role: 'mobile' })
      await waitFor(() => state.value === 'live', 10_000)
      retryCount = 0
      errorMessage.value = ''
    } catch {
      if (++retryCount <= MAX_RETRY) {
        // 指数退避，上限 15s
        const delay = Math.min(1_000 * 2 ** retryCount, 15_000)
        setTimeout(() => void fullRebuild(), delay)
      } else {
        state.value = 'dead'
        errorMessage.value = '多次重连失败，请检查网络后重试'
      }
    }
  }

  /* ────────────────────────────────────────────────────────────
     恢复入口
     ──────────────────────────────────────────────────────────── */
  async function onResume() {
    if (destroyed) return

    // L1：连接还好好的，什么都不做
    if (state.value === 'live' && pc?.connectionState === 'connected') return

    const net = await Network.getStatus()
    if (!net.connected) {
      state.value = 'dead'
      errorMessage.value = '网络不可用'
      return
    }

    // 先探 STOMP：活着就走廉价的 L2，别一上来就全量重建（L2 1-3s vs L3 3-8s）
    if (getSignaling()?.connected) {
      if (pc) await doIceRestart()
      else await fullRebuild()
    } else {
      await fullRebuild()
    }
  }

  /* ────────────────────────────────────────────────────────────
     生命周期
     ──────────────────────────────────────────────────────────── */
  function registerLifecycleListeners() {
    // ① Capacitor：App 切到前台（覆盖切后台、多任务切换）
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void onResume()
    }).then((h) => cleanups.push(() => void h.remove()))

    // ② Web 标准：覆盖锁屏与浏览器标签切换（appStateChange 不覆盖锁屏）
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void onResume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))

    // ③ 网络切换（WiFi ↔ 4G）
    void Network.addListener('networkStatusChange', (s) => {
      if (s.connected) void onResume()
    }).then((h) => cleanups.push(() => void h.remove()))

    // ④ 兜底心跳：状态机可能卡在 live 但实际已断，5s 核对一次
    aliveTimer = window.setInterval(() => {
      if (state.value === 'live' && pc && pc.connectionState !== 'connected') void onResume()
    }, 5_000)
    cleanups.push(() => clearInterval(aliveTimer))
  }

  async function start(token: string | null) {
    state.value = 'signaling'

    const sig = getSignaling()

    // 包一层错误捕获：信令处理抛异常时若无人接住，
    // 会变成静默的 unhandled rejection —— 表现为「收得到消息但毫无反应」，
    // 排查时极难定位。这里统一转成界面上可见的提示。
    if (sig) {
      sig.onMessage = (msg) => {
        console.log('[rtc] 收到信令:', msg.type)
        handleSignal(msg).catch((e: unknown) => {
          const text = e instanceof Error ? e.message : String(e)
          console.error('[rtc] 处理信令失败:', e)
          errorMessage.value = `信令处理失败：${text}`
        })
      }
      // 在已有 STOMP 连接上追加信令订阅（不断开连接）
      sig.subscribeSignal(sessionCode)
    }

    createPeer(await buildIceServers())
    sig?.publish({ type: 'join', role: 'mobile' })
    state.value = 'connecting'

    registerLifecycleListeners()
  }

  async function destroy() {
    destroyed = true
    cleanups.forEach((fn) => fn())
    cleanups = []
    const sig = getSignaling()
    // 先发 leave 再取消订阅：publish 是 fire-and-forget，若紧接着 unsubscribe，
    // leave 帧可能还堵在发送缓冲里就被丢弃 —— 后端收不到 → 受控端继续空推。
    if (sig?.connected) {
      sig.publish({ type: 'leave' })
      // 给 STOMP 一帧时间把 leave 真正写出
      await new Promise((r) => setTimeout(r, 250))
    }
    // 只取消信令订阅，不断开全局 STOMP 连接（sync 等仍需要它）
    sig?.unsubscribeSignal()
    teardownPeer()
    state.value = 'idle'
  }

  onUnmounted(destroy)

  /* ────────────────────────────────────────────────────────────
     对外接口
     ──────────────────────────────────────────────────────────── */
  return {
    state,
    videoRef,
    displays,
    activeDisplayId,
    errorMessage,
    start,
    destroy,
    reconnect: () => {
      retryCount = 0
      return fullRebuild()
    },
    switchDisplay: (id: number) => {
      activeDisplayId.value = id
      send({ t: 'sw', d: id })
    },
    /** 切换画质（low / medium / high），推流建立前后都可调用 */
    quality,
    setQuality: (q: 'low' | 'medium' | 'high') => {
      quality.value = q
      send({ t: 'q', q })
    },
    /**
     * 切换分辨率（480p / 720p / 1080p / native），编码端降采样，推流建立前后都可调用。
     * 选 native 时同步把画质提到 high —— 原生分辨率像素量巨大，低码率下反而更糊，
     * 所以「真清晰」需要高分辨率 + 高码率配套。
     */
    resolution,
    setResolution: (r: '480p' | '720p' | '1080p' | 'native') => {
      resolution.value = r
      if (r === 'native' && quality.value !== 'high') {
        quality.value = 'high'
        send({ t: 'q', q: 'high' })
      }
      send({ t: 'rs', r })
    },
    /** u/v 为归一化坐标 [0,1]，由 useGestures 计算后传入 */
    mouseMove: (u: number, v: number) => send({ t: 'mm', u, v }),
    mouseDown: (b: 0 | 1 | 2 = 0) => send({ t: 'md', b }),
    mouseUp: (b: 0 | 1 | 2 = 0) => send({ t: 'mu', b }),
    wheel: (dy: number, dx = 0) => send({ t: 'mw', dy, dx }),
    keyDown: (k: string, m?: string[]) => send({ t: 'kd', k, m }),
    keyUp: (k: string, m?: string[]) => send({ t: 'ku', k, m }),
    typeText: (s: string) => send({ t: 'ty', s }),
    syncClipboard: (s: string) => send({ t: 'cb', s }),
  }
}

export type RemoteSession = ReturnType<typeof useRemoteSession>
