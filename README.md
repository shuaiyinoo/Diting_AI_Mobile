# Diting AI Mobile

远程桌面**控制端**。Vue 3 + Capacitor 8，一套代码同时产出 iOS App / Android App / H5 网页。

配合 `Diting_AI_Desktop`（Electron 受控端）+ `Diting_AI_Api`（Spring Boot 信令）使用。

---

## 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 框架 | Vue 3（Composition API + `<script setup>`） | 3.5.x |
| 构建 | Vite | 8.x |
| 语言 | TypeScript | 6.x |
| 状态 | Pinia | 3.x |
| 路由 | Vue Router（**hash 模式**） | 5.x |
| UI | shadcn-vue（组件本地化，非 npm 依赖） | — |
| 基础组件 | Reka UI（原 Radix Vue） | 2.x |
| 样式 | Tailwind CSS v4 | 4.x |
| 图标 | @lucide/vue | 1.37.x |
| 原生容器 | Capacitor | **8.5** |
| 信令 | STOMP over WebSocket | 7.x |

> 版本刻意与 `Diting_AI_Web` 对齐（除 Capacitor 外），避免多端维护时版本割裂。
> 未采用刚发布的 TypeScript 7 / pinia 4，等生态稳定后再升级。

---

## 目录结构

```
Diting_AI_Mobile/
├── android/                      # 原生工程（提交 Git，勿删）
├── ios/                          # 原生工程（提交 Git，勿删）
├── src/
│   ├── assets/styles/main.css    # Tailwind v4 入口 + shadcn 主题变量 + 移动端适配
│   ├── components/ui/            # shadcn-vue 组件（button / card / input / dialog）
│   ├── composables/
│   │   ├── useRemoteSession.ts   # ⭐ WebRTC + DataChannel + 三级自动重连
│   │   ├── useGestures.ts        # ⭐ 触控手势 → 归一化坐标
│   │   └── useCapacitor.ts       # 原生能力（状态栏 / 常亮 / 震动）
│   ├── lib/utils.ts              # cn() 类名合并
│   ├── router/index.ts           # 路由（hash 模式）
│   ├── services/
│   │   ├── api.ts                # Axios 封装 + 业务接口
│   │   └── signaling.ts          # STOMP 信令客户端
│   ├── stores/app.ts             # 全局状态（token / 历史）
│   ├── types/remote.ts           # ⭐ 控制端 ↔ 受控端协议定义
│   └── views/
│       ├── HomeView.vue          # 设备列表 + 入口
│       ├── ConnectView.vue       # 会话码输入
│       ├── RemoteView.vue        # ⭐ 远程桌面主界面
│       └── SettingsView.vue      # 设置
├── capacitor.config.ts           # appId: com.diting.mobile
├── components.json               # shadcn-vue 配置
└── vite.config.ts
```

---

## 快速开始

### 1. 先用 Web 开发调试（推荐）

```bash
npm install
npm run dev
# 浏览器打开 http://localhost:5173
```

**业务逻辑完全可以在浏览器里开发调试，不必碰 iOS / Android。**

Capacitor 插件在 H5 下会自动降级，已验证：

| 插件 | H5 行为 |
|---|---|
| `@capacitor/app` | ✅ 有 web 实现（`appStateChange` 基于 visibilitychange） |
| `@capacitor/network` | ✅ 有 web 实现（基于 `navigator.onLine`） |
| `@capacitor/preferences` | ✅ 有 web 实现（localStorage） |
| `@capacitor/haptics` | ✅ 有 web 实现（no-op，静默跳过） |
| `@capacitor-community/keep-awake` | ✅ 有 web 实现（no-op） |
| `@capacitor/status-bar` | ⚠️ **无 web 实现** → 代码已用 `isNative` 包住，H5 下不会调用 |

所以除了「状态栏隐藏 / 屏幕常亮」这两个纯原生能力，其余功能在浏览器里都能真实验证，
包括 WebRTC 建连、DataChannel 指令、手势映射、三级重连。

### 2. 手机真机调试（可选，建议后期再做）

两种路径，任选：

**路径 A — 手机浏览器直连（需要 HTTPS）**

WebRTC 要求安全上下文。手机通过 `http://192.168.x.x:5173` 访问时不是安全上下文，会受限。

```bash
# .env.development 里设 DEV_HTTPS=true，然后
npm run dev
# 手机访问 https://192.168.x.x:5173，忽略证书警告即可
```

**路径 B — 打包成 App + 热更新（更接近真机效果）**

```bash
# 1. capacitor.config.ts 里放开 server.url，填本机局域网 IP
# 2. 电脑启动 dev server
npm run dev
# 3. 手机先装一次 App（在 Xcode / Android Studio 里 Run）
npx cap run ios --livereload --external
# 之后改代码即时生效，不用重复构建
```

### 3. 打包进 App

```bash
# 首次：生成原生工程（已生成，可跳过）
npx cap add ios
npx cap add android

# 日常：改完代码后
npm run cap:sync      # = npm run build && npx cap sync
npx cap open ios      # 打开 Xcode
npx cap open android  # 打开 Android Studio
```

### 3. 真机热更新（推荐开发方式）

手机与电脑连同一 WiFi，然后：

1. 查本机局域网 IP：`ifconfig | grep inet`
2. 编辑 `capacitor.config.ts`，放开 `server.url` 配置，填入你的 IP
3. `npm run dev`
4. 手机打开已安装的 App → 改代码即时生效

⚠️ **上架前务必注释掉 `server.url`**，否则 App 会去连你的电脑。

---

## 环境要求

| 项 | 要求 | 当前状态 |
|---|---|---|
| Node.js | 22+ | ✅ v22.22.2 |
| Xcode | 26.0+（iOS） | ❌ **未安装**，需自行安装 |
| Android Studio | 2025.2.1+（Android） | ❌ **未安装**，需自行安装 |
| iOS 部署目标 | 15.0+ | ✅ 已配置 |
| Android | 7.0 (API 24)+ | ✅ 已配置 |

> `android/` `ios/` 目录已生成。iOS 用 Capacitor 8 默认的 **SPM**（非 CocoaPods）。
> Android 首次 gradle sync 因缺 SDK 失败属正常，装好 Android Studio 后 `npx cap open android` 会自动恢复。

---

## 登录与连接流程

WebSocket 与所有业务接口都依赖登录令牌，因此**必须先登录再建立 WS 连接**。

```
启动 App
  └─ 路由守卫检查本地令牌
       ├─ 无令牌 → /login（邮箱 + 密码）
       │              └─ POST /cloud/mobile/auth/login → 拿到 access_token
       │                   └─ 存入 Capacitor Preferences，注入 http 客户端
       │                        └─ 跳转首页
       └─ 有令牌 → 直接进首页
                    └─ 进入远程桌面页时用该令牌建立 WebSocket 连接
```

### 登录接口

```
POST /cloud/mobile/auth/login
{ "email": "you@example.com", "password": "..." }

→ { "code": 200, "data": {
      "access_token": "...", "expire_in": 7200,
      "user_id": 1, "username": "...", "nickname": "...", "email": "...",
      "team_id": null, "team_name": null
  }}
```

⚠️ **不要用 Web 端的 `/auth/login`**：那个接口需要 `clientId` / `grantType`，
且请求体走 `@ApiEncrypt` 加密。后端为客户端专门提供了 `/cloud/{mobile,desktop}/auth/`，
只需邮箱 + 密码。

令牌失效（后端返回 401）时会自动触发 `auth:expired` 事件，清理登录态并退回登录页。

---

## 关于 Coturn：局域网阶段不用部署

**同网段 / 局域网联调完全不需要 Coturn。**

ICE 建连时会收集三类候选地址：

| 候选类型 | 用途 | 获取方式 |
|---|---|---|
| **host candidate** | 本机内网地址 | 无需任何服务器 |
| server reflexive | 经过 NAT 后的公网地址 | 需要 **STUN** |
| relayed | 中继地址 | 需要 **TURN** |

局域网内双方都在同一网段，直接用 host candidate 就能连上，STUN 和 TURN 都用不上。

代码已做容错 —— `VITE_TURN_URL` 留空时 `buildIceServers()` 返回空数组并打印提示，不会报错；
后端 `/api/turn/credentials` 还没实现时也会静默降级为「仅 STUN」，不影响联调。

**什么时候再部署 Coturn：**
- 需要跨网段 / VPN 访问
- 公网上线（移动网络下约 10-20% 的会话因对称 NAT 需要中继）
- 多设备跨地域测试

部署时记得用 `use-auth-secret` 短期凭证，别用静态账号密码（会被白嫖）。

---

## 核心实现说明

### 三级自动重连（`useRemoteSession.ts`）

切后台 / 锁屏 / 网络切换后自动恢复，按成本从低到高：

| 级别 | 触发条件 | 处理 | 耗时 |
|---|---|---|---|
| L1 | 连接仍存活 | 什么都不做（iOS 短时后台会自愈） | 0 |
| L2 | ICE 断但 STOMP 在线 | ICE Restart | 1-3s |
| L3 | STOMP 也断 | 全量重建：重连 STOMP → 重新入房 → 完整协商 | 3-8s |

关键设计：
- **先探 STOMP 再决定策略** —— 别一上来就全量重建
- **只有控制端发起 ICE Restart** —— 双方同时发起会 glare（信令冲突）
- **成功即重置退避计数** —— 否则一次抖动会让后续重连越来越慢
- **5s 兜底心跳** —— 防止状态机卡在 `live` 但实际已断
- **监听两个事件** —— `appStateChange`（切后台）+ `visibilitychange`（锁屏），只听一个会漏场景

### 坐标映射（`useGestures.ts`）

**永远不直接传像素给受控端。** 流程：

```
触控点 → 减去 letterbox 黑边偏移 → 除以视频有效显示区 → 得到 (u,v) ∈ [0,1]
受控端：实际落点 = display.x + u × display.width
```

- 直接基于 `video.getBoundingClientRect()` 计算，无论外部怎么布局都正确
- 受控端上报的 `display.x` 可能为负（副屏在主屏左侧），必须加上
- 用**逻辑像素**，不要乘 `scaleFactor`（Retina 下乘了必偏）

### iOS 两个必须注意的坑

1. **必须开内联播放**：Xcode 工程里勾选 `allowsInlineMediaPlayback`，或代码设置 `WKWebViewConfiguration.allowsInlineMediaPlayback = true`，否则 `<video>` 会强制全屏播放
2. **iOS 15.x 上给 `<video>` 或其父元素加 CSS `transform` / `animation` 会导致画面黑屏**
   → `RemoteView.vue` 里的画面缩放**用 `width/height` 百分比实现，不用 transform**

---

## 协议约定（`src/types/remote.ts`）

### 信令（走 STOMP `/topic/room.{sessionCode}`）

`join` / `offer` / `answer` / `candidate` / `leave` / `displays` / `terminated`

### 控制指令（走 DataChannel）

| 指令 | 含义 |
|---|---|
| `mm {u,v}` | 鼠标移动（归一化坐标） |
| `md {b}` / `mu {b}` | 鼠标按下 / 抬起（0=左 1=中 2=右） |
| `mw {dy}` | 滚轮 |
| `kd {k,m}` / `ku {k,m}` | 按键按下 / 抬起 |
| `ty {s}` | 整串文本输入（比逐字符快得多） |
| `sw {d}` | 切换目标显示器 |
| `cb {s}` | 剪贴板同步 |

> **受控端（`Diting_AI_Desktop`）需按此协议实现。** 若字段名有出入，改 `types/remote.ts` 即可，两端保持一致就行。

---

## 后端接口约定

当前 `services/api.ts` 期望以下接口，路径不一致时改这个文件：

| 接口 | 用途 |
|---|---|
| `POST /api/auth/login` | 登录，返回 `{ token }` |
| `GET  /api/devices` | 设备列表 |
| `GET  /api/turn/credentials` | **TURN 短期凭证**（HMAC 签发，TTL 600s） |
| `POST /api/session/verify` | 校验会话码 |

⚠️ **绝不要在前端硬编码 TURN 账号密码** —— 那等于把服务器送给别人当中继。凭证必须由后端用 Coturn 的 `static-auth-secret` 做 HMAC 签名动态签发。

---

## 待补充 / 需确认

| 项 | 说明 |
|---|---|
| **后端地址** | `.env.development` 当前指向 `localhost:8080`，按实际情况修改 |
| **STOMP 端点** | 当前为 `/stomp`，需与 Spring Boot 的 `registerStompEndpoints` 一致 |
| **TURN 地址** | `.env.development` 已留空（局域网直连够用），公网上线前再填 |
| **Android SDK / Xcode** | 未安装，**但前期 Web 开发不需要**，业务调通后再装 |
| **iOS 内联播放** | 上真机前需在 Xcode 勾 `allowsInlineMediaPlayback` |
| **图标与启动图** | 待补充，推荐用 `npx @capacitor/assets generate` 自动生成 |

---

## 常用命令

```bash
npm run dev              # 启动开发服务器
npm run build            # 类型检查 + 生产构建
npm run cap:sync         # 构建并同步到原生工程（含插件依赖）
npm run cap:copy         # 仅同步 Web 资源（更快）
npm run cap:ios          # 打开 Xcode
npm run cap:android      # 打开 Android Studio
npm run cap:dev:ios      # 真机热更新调试
```

> 装了新插件后**必须**用 `cap:sync`（`cap:copy` 不会更新原生依赖）。
