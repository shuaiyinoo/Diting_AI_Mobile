<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { applyAndroidSystemBars } from '@/composables/useCapacitor'

const router = useRouter()
const app = useAppStore()

/** 令牌过期（后端返回 401）时，清理登录态并退回登录页 */
async function onAuthExpired() {
  await app.logout()
  await router.replace('/login')
}

onMounted(async () => {
  // 恢复本地登录态（路由守卫也会调用，这里幂等）
  await app.load()
  window.addEventListener('auth:expired', onAuthExpired)
  // Android：让系统保留状态栏 / 导航栏空间，避免内容压到安全区
  void applyAndroidSystemBars()
})

onUnmounted(() => {
  window.removeEventListener('auth:expired', onAuthExpired)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-background text-foreground">
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
  </div>
</template>
