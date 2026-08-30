# Diting AI Mobile — 两日工作复盘（BEFORE）

> 时间范围：2026-08-29 ~ 2026-08-30
> 项目：`/Users/mac/Documents/DITING/Diting_AI_Mobile/`
> 定位：Diting 远程桌面助手的 **移动端 Capacitor 客户端**（Android 已实机跑通，iOS 待验证）

---

## 一、概览

这两天的核心工作是两条线并行：

1. **远程桌面链路打通与稳定性修复**（WebRTC + STOMP 信令，桌面端 Electron ↔ 移动端 ↔ Java 后端）
2. **移动端打包落地 + 安全区（Safe Area）适配**（Android 出包、真机验证、状态栏/手势条避让）

第 1 条线已闭环；第 2 条线的 Android 出包已完成，但**安全区适配经历多轮错误方向，最终方案由用户自己定位，仍留一个顶部间距微调未落地**。

---

## 二、项目架构

### 2.1 技术栈

| 层 | 技术 | 版本 / 备注 |
|---|---|---|
| 跨端壳 | Capacitor | 8.5.0 |
| 前端框架 | Vue 3 + TypeScript | `<script setup>` 组合式 |
| 构建 | Vite | `build.outDir = dist` |
| 样式 | Tailwind CSS v4 | `@import 'tailwindcss'` + `@utility` |
| 路由 | vue-router | **Hash 模式**（`createWebHashHistory`，避免 `file://` 刷新 404） |
| 实时通信 | STOMP over WebSocket | 端点 `/stomp`，需 Bearer JWT |
| 媒体传输 | WebRTC P2P | 桌面端采集 → 移动端拉流 |
| 后端 | Java（Spring Boot + MyBatis-Plus） | 信令服务 |

### 2.2 目录结构

```
Diting_AI_Mobile/
├── src/
│   ├── main.ts                     # 入口
│   ├── App.vue                     # 根组件 + Android 系统栏初始化
│   ├── router/index.ts             # Hash 路由 + 登录守卫
│   ├── views/
│   │   ├── LoginView.vue           # 登录（p-safe）
│   │   ├── ConnectView.vue         # 输入会话码连接（p-safe）
│   │   ├── RemoteView.vue          # 远程桌面（全屏 / 内嵌双模式）
│   │   ├── SettingsView.vue        # 设置整页（p-safe）
│   │   ├── ChatView.vue            # Tab：对话
│   │   ├── AgentView.vue           # Tab：智能体
│   │   └── HomeView.vue            # 未挂载（历史遗留）
│   ├── components/
│   │   ├── AppLayout.vue           # 主壳：顶栏 + 内容区 + 底部输入栏
│   │   ├── AppTabBar.vue           # 固定底栏 / 左侧栏（响应式）
│   │   ├── ChatInputBar.vue        # 底部输入栏（本轮新抽）
│   │   ├── SettingsPanel.vue       # Tab：设置内容
│   │   └── ui/*                    # Button / Card / Dialog / Input
│   ├── composables/
│   │   ├── useCapacitor.ts         # 原生能力（状态栏、触感、沉浸模式）
│   │   ├── useRemoteSession.ts     # WebRTC 会话
│   │   └── useGestures.ts          # 手势 → 指令
│   ├── services/
│   │   ├── wake.ts                 # 设备唤醒（uuidV4 兜底）
│   │   └── api.ts                  # 业务接口
│   ├── stores/app.ts               # 登录态 / 连接历史
│   └── assets/styles/main.css      # 全局样式 + 安全区工具类
├── android/                        # Android 原生工程
├── ios/                            # iOS 原生工程
└── capacitor.config.ts
```

### 2.3 页面与路由

| 路由 | 组件 | 说明 |
|---|---|---|
| `/login` | LoginView | 登录页 |
| `/` | **AppLayout** | 主壳，内部切换 Chat / Agent / 设置 三个 Tab（不走嵌套路由） |
| `/connect` | ConnectView | 输入会话码 |
| `/remote/:code` | RemoteView | 全屏远程桌面（`meta.immersive = true`） |
| `/settings` | SettingsView | 设置整页 |

> 注意：`HomeView.vue` 不在任何路由中，**当前未挂载**，属于历史遗留文件。

### 2.4 远程桌面链路

```
Desktop (Electron)            后端信令 (Java)              Mobile (Capacitor)
  采集屏幕  ──────────────►  分配会话码 / 转发 SDP  ◄────  请求唤醒 (requestWake)
      │                             │                            │
      └──────────── WebRTC P2P 直连（ICE / TURN）───────────────┘
```

- **唤醒流程**：Mobile 点设备 → `requestWake()` → 后端通知桌面端 → 桌面端出码 + 开始采集 → Mobile 跳 `RemoteView`
- **画质**：低 / 中 / 高 三档
- **分辨率**：标清 480p / 高清 720p / 蓝光 1080p / 原画 native
- **手势映射**：tap=左键、longPress/twoFingerTap=右键、drag=拖拽、wheel=滚轮、pinch=缩放
- **沉浸模式**：`StatusBar.hide()` + `KeepAwake.keepAwake()`，退出时恢复

---

## 三、关键数据速查

### 3.1 环境

| 项 | 值 |
|---|---|
| JDK | **21**（`jbr-21.0.11`，Capacitor 8 要求 ≤21） |
| `ANDROID_HOME` | `~/Library/Android/sdk` |
| Gradle | 8.14.3 |
| compileSdk / targetSdk | **36（Android 16）** |
| minSdk | 24 |
| 后端局域网地址 | `192.168.31.81:9527` |
| 调试设备 | `461QYGDQ225KR`（1080 × 2340） |
| 构建耗时 | ~18s |
| APK 体积 | 4.2 MB |

### 3.2 依赖插件（7 个）

```
@capacitor-community/keep-awake@8.0.1
@capacitor/app@8.1.1
@capacitor/haptics@8.0.2
@capacitor/network@8.0.1
@capacitor/preferences@8.0.1
@capacitor/screen-orientation@8.0.1
@capacitor/status-bar@8.0.3
```

### 3.3 关键常量

| 常量 | 值 | 位置 |
|---|---|---|
| 宽屏断点 `WIDE_MIN_WIDTH` | 768 | `AppLayout.vue` |
| 底部/侧边避让基础值 | `3.75rem`（60px） | `main.css` 的 `.pb-tab` / `.pl-tab` |
| 顶栏顶部呼吸空间 | `+16px` | `AppLayout.vue` header |
| 拖拽发送节流 | 8ms（≈125Hz） | `RemoteView.vue` |
| 滚轮发送节流 | 16ms | `RemoteView.vue` |

---

## 四、解决的问题

### 4.1 后端启动报错 `StompConstants cannot be resolved`

- **现象**：`Unresolved compilation problems: StompConstants cannot be resolved`
- **根因**：非源码错误，是 Eclipse/ECJ 增量编译留下的**脏 class 文件**
- **方案**：用 Maven（javac）干净重编 `mvn clean compile`
- **状态**：⚠️ 建议在真实环境执行，**本次会话未跑完**（被中断）

### 4.2 `crypto.randomUUID is not a function`

- **现象**：Mobile 点设备报错，无响应
- **根因**：`crypto.randomUUID` 仅在**安全上下文**（HTTPS / localhost）可用，WebView 内加载 `file://` 或 HTTP 时不存在
- **方案**：`src/services/wake.ts` 新增 `uuidV4()`，优先 `crypto.randomUUID`，缺失时回落到 `crypto.getRandomValues(new Uint8Array(16))` 拼 v4 UUID
- **验证**：`vue-tsc` 通过

### 4.3 桌面出码、手机跳过去但没画面

- **现象**：桌面端生成会话码，Mobile 跳转但无画面，报 `Cannot read properties of null (reading 'length')`
- **根因**：`handleWake` 只生成了会话码，**漏调 `startCapture()`**，采集从未启动
- **方案**：`signaling-service.ts` 的 `handleWake` 补齐 `fetchIceServers()` + `startCapture()`，并用 `captureStarted` 标志防重复；同时 `displays` 加空值保护 `msg.displays ?? []`

```ts
if (!this.captureStarted) {
  const iceServers = await this.fetchIceServers()
  await remoteSessionWindow.startCapture(undefined, iceServers)
  this.captureStarted = true
}
```

### 4.4 断开连接后下次连不上

- **现象**：断开后需要关闭远程镜像开关才能重连
- **根因**：`leave` / `terminated` 只置 `peerJoined = false`，**未释放采集与会话码**
- **方案**：`stopMirroring()` 内调 `remoteSessionWindow.stopCapture()`；`leave` / `terminated` 分支补 `void this.stopMirroring()`

### 4.5 分辨率切换失败（状态依赖报错）

- **现象**：点「原画」报错；但先点「高清」再点「原画」就不报。不影响画面输出
- **根因**（两层）：
  1. 表象：连接在 `connected` 前调 `setParameters()` 触发竞态
  2. **真正根因**：transceiver 未 associate 时 `getParameters()` 返回的 `transactionId` 为**空**，此时硬 `setParameters()` 必抛 `getParameters() has never been called`；且代码自造 `encodings = [{}]` 加剧问题。首次成功 set 会"暖热" sender 内部缓存 —— 这正好解释了"先点高清就不报"的状态依赖现象
- **方案**：`public/html/remote-session.html` 抽出安全封装 `tuneSender(mutator, label)`：轮询等待 `transactionId` 与 `encodings` 就绪（最多 16 次 × 120ms），就绪后再改参并 `setParameters()`；失败只 log 不 `reportError`
- **验证**：全局仅 `tuneSender` 内一处 `setParameters`，无 `encodings=[{}]` 残留；`node --check` 通过

### 4.6 Android 打包落地

- 加 `android:usesCleartextTraffic="true"`（本地 `ws://` 明文必需，**发布前须移除**）
- 确认 `.env.development` 内联 `ws://192.168.31.81:9527/ws/mobile`
- ⚠️ **坑**：`npm run cap:sync` 内部走 `npm run build`（production，会打进 `api.diting.example.com`/`wss`），本地验证必须用 `npm run build:dev`

---

## 五、安全区适配的优化过程（含反复）

这是本次**代价最高的部分**，走了 4 个方向才收敛。

### 核心事实（必须先建立）

> **Android 的 WebView 不会向 CSS 注入 `env(safe-area-inset-*)`，它恒返回 `0`。**
> 因此纯 CSS 的 `pt-safe / p-safe / pb-safe` 在 Android 上全部算成 `0px` —— 加多少层 CSS 都不可能生效。
> iOS 相反：原生支持 `env()`。

### 迭代记录

| # | 方案 | 结果 | 失败原因 |
|---|---|---|---|
| 1 | iOS 侧 `contentInset: 'always'` → `'never'` | ❌ 不解决 Android | **平台判断错误**——用户从头说的是 Android |
| 2 | 新增 `.pb-tab` / `.pl-tab`（基础值 + `env()`） | ⚠️ 只兜住底部 | 顶部仍压状态栏（Android `env()`=0） |
| 3 | JS `StatusBar.setOverlaysWebView({ overlay: false })` | ❌ 无效 | 被 Capacitor 自身 edge-to-edge 逻辑覆盖 |
| 4 | 原生 `WindowCompat.setDecorFitsSystemWindows(getWindow(), true)` | ❌ 无效 | **Android 15（API 35）起系统强制 edge-to-edge，该 API 被忽略**；本项目 targetSdk=36 |
| 5 | **Capacitor 8 内置 SystemBars 插件注入 `--safe-area-inset-*` CSS 变量** | ✅ 方向正确（用户自行定位） | — |

### 过程中的独立坑：构建从未执行

排查"怎么改都不生效"时发现 `android/app/build/outputs/apk/debug/` **目录是空的** —— APK 根本不存在。

> **Capacitor Android 里改了 `MainActivity.java` / `build.gradle` / `AndroidManifest.xml` 后，`cap sync` 只复制 web 产物，不会编译 Java。**

必须：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME=$HOME/Library/Android/sdk
cd android && ./gradlew assembleDebug          # 18s
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.diting.mobile/.MainActivity
```

### 最终形态（当前代码状态）

- **原生层**：`MainActivity.java` 恢复为空壳，**故意不干预 edge-to-edge**
- **CSS 层**：`main.css` 全量改为优先读 CSS 变量、`env()` 作 iOS 兜底

```css
.pt-safe { padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px)); }
.pb-safe { padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)); }
.pb-tab  { padding-bottom: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 3.75rem); }
```

- **顶栏**：`AppLayout.vue` header
  `pt-[calc(var(--safe-area-inset-top,env(safe-area-inset-top,0px))+16px)]`
- **JS 层**：`useCapacitor.ts` 的 `applyAndroidSystemBars()` **只设系统栏图标样式，不做避让**

---

## 六、遗留问题

| # | 问题 | 状态 | 备注 |
|---|---|---|---|
| 1 | **顶部间距仍不足，需再 +10px** | 🔴 待调 | 用户反馈"还是压着"，要求顶部再增 10px（16px → 26px），**本次未执行** |
| 2 | `--safe-area-inset-top` 是否真的被注入 | 🟡 待验证 | 若未注入，`var()` 回落到 `env()`（Android=0），顶栏只剩 16px → 与现象吻合，建议优先排查此处 |
| 3 | iOS 端未验证 | 🟡 待验证 | `contentInset: 'never'` + `env()` 方案已就位，用户自行测试 |
| 4 | 后端 `mvn clean compile` | 🟡 未执行 | 脏 class 问题，需在真实后端环境跑 |
| 5 | `usesCleartextTraffic="true"` | 🟡 发布前移除 | 仅本地 `ws://` 明文需要 |
| 6 | `HomeView.vue` 未挂载 | 🟢 低优先 | 历史遗留死代码，可清理 |
| 7 | Chat / Agent 发送逻辑 | 🟢 未完成 | `AppLayout.vue` 的 `onSend` 仍是 `console.log` TODO |

---

## 七、经验教训

1. **平台先问清楚再动手** —— 一开始把 Android 的现象按 iOS 修，白跑一轮。
2. **Android 的 `env()` 恒为 0** —— 这是所有安全区问题的总根源，纯 CSS 方案在此平台上不可能生效。
3. **Android 15+ 强制 edge-to-edge** —— `setDecorFitsSystemWindows` / `setOverlaysWebView` / `setBackgroundColor` 均已失效，别再往这个方向试。
4. **改原生代码必须重新编译 APK** —— `cap sync` ≠ 编译。判断改生效与否，先看 `build/outputs/apk/` 里 APK 的时间戳。
5. **不要用截图代替真机判断** —— 本次我据截图断言"已修复"，与用户真机观感不符，属于过早下结论。

---

## 八、常用命令

```bash
# ── 本地开发构建（必须用 dev，内联局域网地址）──
npm run build:dev
npx cap sync android          # 只复制 web 产物

# ── 完整出包（改了原生代码时必走）──
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME=$HOME/Library/Android/sdk
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# ── 校验 ──
npx vue-tsc --noEmit                       # 类型检查
unzip -p app-debug.apk classes.dex | strings | grep setDecorFitsSystemWindows   # 确认原生代码进包
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png                  # 真机截图
```

---

## 附：本轮文件改动清单

| 文件 | 改动 |
|---|---|
| `src/services/wake.ts` | 新增 `uuidV4()` 兜底 |
| `src/composables/useRemoteSession.ts` | `displays` 空值保护 |
| `android/.../signaling-service.ts`（桌面端） | `handleWake` 补 `startCapture`；`stopMirroring` 补 `stopCapture`；leave 释放 |
| `public/html/remote-session.html`（桌面端） | 抽出 `tuneSender()` 安全封装；`reapplyTuning()` |
| `android/app/src/main/AndroidManifest.xml` | `usesCleartextTraffic="true"` |
| `src/assets/styles/main.css` | 安全区工具类改 CSS 变量；新增 `.pb-tab` / `.pl-tab` |
| `src/components/AppLayout.vue` | 顶栏安全区；避让改 `pb-tab` / `pl-tab`；远程投屏改抽屉式 |
| `src/components/ChatInputBar.vue` | （用户本轮新抽）底部输入栏 |
| `src/composables/useCapacitor.ts` | `applyAndroidSystemBars()` 只设样式不避让 |
| `src/App.vue` | `onMounted` 调用 `applyAndroidSystemBars()` |
| `android/app/src/main/java/.../MainActivity.java` | 恢复空壳（不再干预 edge-to-edge） |
| `capacitor.config.ts` | `ios.contentInset: 'never'` |
