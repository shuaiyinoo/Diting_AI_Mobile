import axios, { type AxiosInstance } from 'axios'

/**
 * HTTP 客户端
 * 拦截器统一处理 token 与错误，业务代码只管调 api.xxx()
 */
class HttpClient {
  private instance: AxiosInstance
  /** 内存态 token，重启即失效；持久化放在 Preferences 里 */
  private token: string | null = null

  constructor() {
    this.instance = axios.create({
      baseURL: import.meta.env.VITE_API_BASE_URL,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    })

    this.instance.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`
      }
      // 客户端标识：与后端 Mobile 登录写入 token 的 clientid 一致，
      // 否则框架 SecurityConfig 会因「客户端ID与Token不匹配」拒绝访问。
      config.headers.clientid = 'mobile'
      return config
    })

    // 注意：这里不再解包 res.data —— axios 1.20 引入了 AxiosResponseResult<T,...>，
    // 解包会让 TS 无法推断真实返回类型。统一在下面各方法里取 .data。
    this.instance.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err?.response?.status
        if (status === 401) {
          this.token = null
          // 交由路由守卫跳转登录，这里不直接改路由，避免循环依赖
          window.dispatchEvent(new CustomEvent('auth:expired'))
        }
        return Promise.reject(err)
      },
    )
  }

  setToken(t: string | null) {
    this.token = t
  }

  async get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.instance.get<T>(url, { params })
    return res.data
  }

  async post<T = unknown>(url: string, data?: unknown): Promise<T> {
    const res = await this.instance.post<T>(url, data)
    return res.data
  }

  async put<T = unknown>(url: string, data?: unknown): Promise<T> {
    const res = await this.instance.put<T>(url, data)
    return res.data
  }

  async delete<T = unknown>(url: string): Promise<T> {
    const res = await this.instance.delete<T>(url)
    return res.data
  }
}

export const http = new HttpClient()

/* ══════════════════════════════════════════════════════════════
   业务接口
   ══════════════════════════════════════════════════════════════ */

export interface DeviceInfo {
  id: string
  name: string
  platform: 'windows' | 'macos' | 'linux'
  online: boolean
  lastSeenAt?: string
}

export interface TurnCredentials {
  username: string
  credential: string
  ttl: number
  /** TURN 地址（需凭证） */
  urls: string[]
  /** STUN 地址（无需凭证）—— 内网连通的关键，别忽略 */
  stunUrls: string[]
}

/** 校验会话码的结果 */
export interface SessionVerifyResult {
  valid: boolean
  deviceId?: string
  deviceName?: string
  platform?: string
  online?: boolean
}

/**
 * 后端统一响应包装（org.dromara.common.core.domain.R）
 * 所有接口都返回 { code, msg, data }，业务数据在 data 里。
 */
export interface R<T> {
  code: number
  msg: string
  data: T
}

/** 拆掉 R 包装，直接拿到业务数据 */
function unwrap<T>(p: Promise<R<T>>): Promise<T> {
  return p.then((r) => r.data)
}

/**
 * 登录返回结果
 *
 * 对应后端 DesktopAuthVo。字段是 snake_case —— 因为该 VO 上标注了
 * `@JsonProperty("access_token")` 等注解（不是全局命名策略，别改这里的写法）。
 *
 * 注意：Mobile 与 Desktop 共用同一套账号体系，但 Sa-Token 的 deviceType 不同
 * （mobile / pc），会话按「loginId + deviceType」隔离，
 * 因此同一账号可以两端同时在线、互不顶号。
 */
export interface AuthResult {
  access_token: string
  expire_in: number
  user_id: number
  username: string
  nickname: string
  email: string
  team_id: number | null
  team_name: string | null
}

export const api = {
  /**
   * 邮箱 + 密码登录，换取访问令牌。
   *
   * 该接口是后端为客户端专门提供的（/cloud/{mobile,desktop}/auth/login），
   * 不需要 clientId / grantType，也不走 @ApiEncrypt 加密，
   * 与 Web 端标准登录接口（/auth/login）不同，别混用。
   */
  login(email: string, password: string) {
    return unwrap(http.post<R<AuthResult>>('/cloud/mobile/auth/login', { email, password }))
  },

  /** 我的设备列表（当前在线的受控端） */
  listDevices() {
    return unwrap(http.get<R<DeviceInfo[]>>('/cloud/remote/session/devices'))
  },

  /**
   * 申请 TURN 短期凭证
   *
   * ⚠️ 绝不要在前端硬编码 TURN 账号密码 —— 那等于把服务器送给别人当中继。
   * 凭证由后端用 Coturn 的 static-auth-secret 做 HMAC-SHA1 签名，TTL 通常 600s。
   */
  getTurnCredentials() {
    return unwrap(http.get<R<TurnCredentials>>('/cloud/remote/turn/credentials'))
  },

  /** 校验会话码，返回是否可接入 */
  verifySessionCode(code: string) {
    return unwrap(http.post<R<SessionVerifyResult>>('/cloud/remote/session/verify', { code }))
  },
}
