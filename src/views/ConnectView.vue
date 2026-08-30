<script setup lang="ts">
import { ArrowLeft, Loader2, Monitor, MonitorOff, MonitorPlay } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, type DeviceInfo } from '@/services/api'
import { requestWake } from '@/services/wake'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const route = useRoute()
const app = useAppStore()

/* ───────────────── 方式一：手动输入会话码 ───────────────── */
const code = ref('')
const verifying = ref(false)
const error = ref('')

/** 会话码：6 位数字，自动过滤非数字并截断 */
const normalized = computed(() => code.value.replace(/\D/g, '').slice(0, 6))
const canSubmit = computed(() => normalized.value.length === 6 && !verifying.value)

async function submit() {
  if (!canSubmit.value) return

  verifying.value = true
  error.value = ''
  try {
    const res = await api.verifySessionCode(normalized.value)
    if (!res.valid) {
      error.value = '会话码无效或已过期'
      return
    }
    await app.pushHistory({ code: normalized.value, deviceName: '', connectedAt: Date.now() })
    // ⚠️ 这次点击就是 iOS 需要的「用户手势」，后续 video.play() 才能自动执行
    await router.push(`/remote/${normalized.value}`)
  } catch (e) {
    // 后端未就绪时先放行，方便前端单独联调
    console.warn('[connect] 校验接口不可用，直接进入房间:', e)
    await router.push(`/remote/${normalized.value}`)
  } finally {
    verifying.value = false
  }
}

/* ───────────────── 方式二：设备列表（无人值守唤醒） ───────────────── */
const devices = ref<DeviceInfo[]>([])
const loadingDevices = ref(false)
const wakingId = ref<string | null>(null)

async function loadDevices() {
  loadingDevices.value = true
  try {
    devices.value = await api.listDevices()
  } catch (e) {
    console.error('[connect] 设备列表加载失败:', e)
  } finally {
    loadingDevices.value = false
  }
}

async function connectByDevice(d: DeviceInfo) {
  if (!d.online || wakingId.value) return
  wakingId.value = d.id
  error.value = ''
  try {
    const sessionCode = await requestWake(d.id, app.token)
    await app.pushHistory({ code: sessionCode, deviceName: d.name, connectedAt: Date.now() })
    await router.push(`/remote/${sessionCode}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '唤醒失败'
  } finally {
    wakingId.value = null
  }
}

function platformLabel(p: DeviceInfo['platform']) {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[p] ?? p
}

onMounted(async () => {
  await loadDevices()
  // 从首页带 device 参数进入：自动唤醒该设备，无需手动点击
  const target = route.query.device
  if (typeof target === 'string') {
    const d = devices.value.find((x) => x.id === target)
    if (d && d.online) {
      await connectByDevice(d)
    } else {
      error.value = '目标设备不在线或不存在'
    }
  }
})
</script>

<template>
  <div class="flex min-h-full flex-col p-safe">
    <header class="flex items-center gap-2 px-3 pb-2 pt-4">
      <Button variant="ghost" size="icon" aria-label="返回" @click="router.back()">
        <ArrowLeft class="size-5" />
      </Button>
      <h1 class="text-lg font-semibold">连接设备</h1>
    </header>

    <main class="flex-1 space-y-8 px-6 pb-8 pt-8">
      <!-- 主入口图标 -->
      <div class="text-center">
        <div class="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10">
          <MonitorPlay class="size-7 text-primary" />
        </div>
        <p class="text-sm text-muted-foreground">
          在电脑上运行 Diting Agent，<br />在窗口中查看 6 位会话码
        </p>
      </div>

      <!-- 方式一：手动会话码 -->
      <section>
        <label class="mb-2 block text-sm font-medium" for="session-code">会话码</label>
        <Input
          id="session-code"
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="000000"
          class="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          :class="error && 'border-destructive'"
          @keyup.enter="submit"
          @input="error = ''"
        />
        <p v-if="error" class="mt-2 text-sm text-destructive">{{ error }}</p>
        <p v-else class="mt-2 text-xs text-muted-foreground">输入 6 位数字后点击连接</p>

        <Button class="mt-8 w-full" size="lg" :disabled="!canSubmit" @click="submit">
          <Loader2 v-if="verifying" class="size-5 animate-spin" />
          {{ verifying ? '校验中…' : '连接' }}
        </Button>
      </section>

      <!-- 方式二：设备列表（点击即自动唤醒并连接） -->
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-medium text-muted-foreground">我的设备</h2>
          <Button variant="ghost" size="icon-sm" :disabled="loadingDevices" @click="loadDevices">
            <Loader2 class="size-4" :class="loadingDevices && 'animate-spin'" />
          </Button>
        </div>

        <div v-if="devices.length === 0 && !loadingDevices" class="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          暂无设备。请先在电脑上运行 Diting Agent 并登录同一账号。
        </div>

        <div v-else class="space-y-2">
          <button
            v-for="d in devices"
            :key="d.id"
            type="button"
            :disabled="!d.online || wakingId !== null"
            class="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-4 text-left transition-colors active:bg-accent disabled:opacity-60"
            @click="connectByDevice(d)"
          >
            <component :is="d.online ? Monitor : MonitorOff" class="size-5 shrink-0 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{{ d.name }}</p>
              <p class="text-xs text-muted-foreground">
                {{ platformLabel(d.platform) }} · {{ d.online ? '在线' : '离线' }}
              </p>
            </div>
            <Loader2 v-if="wakingId === d.id" class="size-4 shrink-0 animate-spin text-primary" />
            <span
              v-else
              class="size-2 shrink-0 rounded-full"
              :class="d.online ? 'bg-green-500' : 'bg-muted-foreground/40'"
            />
          </button>
        </div>
      </section>
    </main>
  </div>
</template>
