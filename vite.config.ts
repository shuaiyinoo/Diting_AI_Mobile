import path from 'node:path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 手机真机通过局域网访问时，WebRTC 需要安全上下文（HTTPS）。
  // 设 DEV_HTTPS=true 即可启用自签证书；仅用于开发调试。
  const useHttps = env.DEV_HTTPS === 'true'

  return {
    plugins: [vue(), ...(useHttps ? [basicSsl()] : [])],
    resolve: {
      // Vite 8 起推荐 import.meta.dirname（Node 20.11+），__dirname 会触发弃用警告
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: true, // 允许手机通过局域网访问
      port: 5173,
    },
    build: {
      outDir: 'dist', // 必须与 capacitor.config.ts 的 webDir 一致
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
    },
  }
})
