import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.diting.mobile',
  appName: 'Diting Mobile',
  webDir: 'dist', // 必须与 vite.config.ts 的 build.outDir 一致

  // ────────────────────────────────────────────────────────────
  // 开发期：指向本机 Vite dev server，手机连同一 WiFi 即可实时热更新
  // 打包上架前【必须】注释掉整段 server 配置
  // 把 192.168.x.x 换成你本机的局域网 IP（ifconfig | grep inet）
  // ────────────────────────────────────────────────────────────
  // server: {
  //   url: 'http://192.168.1.100:5173',
  //   cleartext: true,
  // },

  android: {
    allowMixedContent: true, // 内网 HTTP 接口需要（生产环境建议全 HTTPS 后关闭）
    backgroundColor: '#09090b',
  },
  ios: {
    // ⚠️ 必须为 'never'：关闭 WKWebView 自动安全区 inset。
    // 否则在 viewport-fit=cover 下 env(safe-area-inset-*) 会被置 0，
    // 导致所有 p-safe/pt-safe/pb-safe 失效，内容顶进状态栏、压到手势条（仅 iOS 复现）。
    // 安全区统一由页面 CSS 的 env() 控制（与 Android 行为一致）。
    contentInset: 'never',
  },
}

export default config
