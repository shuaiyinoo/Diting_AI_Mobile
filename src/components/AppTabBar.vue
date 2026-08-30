<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import { cn } from '@/lib/utils'

/** 底部菜单项定义 */
export interface TabItem {
  /** 唯一 key，用于 v-model 绑定 */
  key: string
  /** 展示文案 */
  label: string
  /** 未选中图标组件 */
  icon: Component
  /** 选中图标组件（可选，缺省复用 icon） */
  activeIcon?: Component
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    tabs: TabItem[]
    /** 布局方向：bottom=底部横排（手机竖屏），left=左侧竖排（大屏/折叠屏） */
    orientation?: 'bottom' | 'left'
    class?: string
  }>(),
  { orientation: 'bottom' },
)

const isLeft = computed(() => props.orientation === 'left')

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

function isActive(key: string) {
  return props.modelValue === key
}

function select(tab: TabItem) {
  if (isActive(tab.key)) return
  emit('update:modelValue', tab.key)
  emit('change', tab.key)
}
</script>

<template>
  <!-- 底部横排模式：钉在全局底部，自适应安全区用 pb-safe -->
  <nav
    v-if="!isLeft"
    class="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border bg-background/95 pb-safe pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    :class="cn('', props.class)"
  >
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors"
      :class="isActive(tab.key) ? 'text-primary' : 'text-muted-foreground active:text-foreground'"
      :aria-current="isActive(tab.key) ? 'page' : undefined"
      @click="select(tab)"
    >
      <component
        :is="(tab.activeIcon ?? tab.icon) as Component"
        class="size-5 transition-transform"
        :class="isActive(tab.key) && 'scale-110'"
      />
      <span class="text-xs font-medium">{{ tab.label }}</span>
      <!-- 选中指示条（顶部） -->
      <span
        class="absolute top-0 h-0.5 w-8 rounded-full bg-primary transition-opacity"
        :class="isActive(tab.key) ? 'opacity-100' : 'opacity-0'"
      />
    </button>
  </nav>

  <!-- 左侧竖排模式：钉在全局左侧，自适应安全区用 pl-safe -->
  <nav
    v-else
    class="fixed inset-y-0 left-0 z-50 flex w-16 flex-col items-stretch border-r border-border bg-background/95 pl-safe backdrop-blur supports-[backdrop-filter]:bg-background/80"
    :class="cn('', props.class)"
  >
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      class="relative flex flex-1 flex-col items-center justify-center gap-1.5 px-1 py-3 transition-colors"
      :class="isActive(tab.key) ? 'text-primary' : 'text-muted-foreground active:text-foreground'"
      :aria-current="isActive(tab.key) ? 'page' : undefined"
      @click="select(tab)"
    >
      <component
        :is="(tab.activeIcon ?? tab.icon) as Component"
        class="size-5 transition-transform"
        :class="isActive(tab.key) && 'scale-110'"
      />
      <span class="text-xs font-medium">{{ tab.label }}</span>
      <!-- 选中指示条（左侧） -->
      <span
        class="absolute left-0 h-8 w-0.5 rounded-full bg-primary transition-opacity"
        :class="isActive(tab.key) ? 'opacity-100' : 'opacity-0'"
      />
    </button>
  </nav>
</template>
