<script setup lang="ts">
import { Clock, Monitor, MonitorOff, Plus, RefreshCw, Settings } from '@lucide/vue'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/lib/utils'
import { api, type DeviceInfo } from '@/services/api'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const app = useAppStore()

const devices = ref<DeviceInfo[]>([])
const loading = ref(false)
const loadError = ref('')

async function loadDevices() {
  loading.value = true
  loadError.value = ''
  try {
    devices.value = await api.listDevices()
  } catch (e) {
    loadError.value = '设备列表加载失败，请检查后端地址'
    console.error(e)
  } finally {
    loading.value = false
  }
}

function connectDevice(d: DeviceInfo) {
  if (!d.online) return
  // 真实项目里这里应先用设备 id 换取一次性会话码
  void router.push({ name: 'connect', query: { device: d.id } })
}

function formatTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return formatDateTime(ts)
}

function platformLabel(p: DeviceInfo['platform']) {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[p] ?? p
}

onMounted(loadDevices)
</script>

<template>
  <div class="flex min-h-full flex-col p-safe">
    <!-- 顶栏 -->
    <header class="flex items-center justify-between px-5 pb-2 pt-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Diting Mobile</h1>
        <p class="mt-1 text-sm text-muted-foreground">远程桌面控制端</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="设置" @click="router.push('/settings')">
        <Settings class="size-5" />
      </Button>
    </header>

    <main class="flex-1 space-y-6 px-5 pb-8 pt-4">
      <!-- 主入口 -->
      <Button size="lg" class="w-full" @click="router.push('/connect')">
        <Plus class="size-5" />
        输入会话码连接
      </Button>

      <!-- 在线设备 -->
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium text-muted-foreground">我的设备</h2>
          <Button variant="ghost" size="icon-sm" :disabled="loading" @click="loadDevices">
            <RefreshCw class="size-4" :class="loading && 'animate-spin'" />
          </Button>
        </div>

        <div v-if="loadError" class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {{ loadError }}
        </div>

        <div v-else-if="devices.length === 0 && !loading" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          暂无设备。请先在电脑上运行 Diting Agent 并登录同一账号。
        </div>

        <div v-else class="space-y-2">
          <Card
            v-for="d in devices"
            :key="d.id"
            class="cursor-pointer gap-0 py-0 transition-colors active:bg-accent"
            :class="d.online ? undefined : 'opacity-60'"
            @click="connectDevice(d)"
          >
            <CardContent class="flex items-center gap-3 px-4 py-4">
              <component :is="d.online ? Monitor : MonitorOff" class="size-5 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ d.name }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ platformLabel(d.platform) }} · {{ d.online ? '在线' : '离线' }}
                </p>
              </div>
              <span
                class="size-2 shrink-0 rounded-full"
                :class="d.online ? 'bg-green-500' : 'bg-muted-foreground/40'"
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <!-- 最近连接 -->
      <section v-if="app.history.length > 0">
        <h2 class="mb-3 text-sm font-medium text-muted-foreground">最近连接</h2>
        <div class="space-y-2">
          <Card
            v-for="h in app.history"
            :key="h.code"
            class="cursor-pointer gap-0 py-0 transition-colors active:bg-accent"
            @click="router.push(`/remote/${h.code}`)"
          >
            <CardContent class="flex items-center gap-3 px-4 py-3">
              <Clock class="size-4 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ h.deviceName || h.code }}</p>
                <p class="font-mono text-xs text-muted-foreground">{{ h.code }}</p>
              </div>
              <span class="shrink-0 text-xs text-muted-foreground">{{ formatTime(h.connectedAt) }}</span>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  </div>
</template>
