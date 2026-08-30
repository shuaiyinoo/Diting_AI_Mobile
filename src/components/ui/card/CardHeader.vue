<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
</script>

<template>
  <div
    data-slot="card-header"
    :class="cn('grid auto-rows-min items-start gap-1.5 px-6', props.class)"
  >
    <slot />
  </div>
</template>
