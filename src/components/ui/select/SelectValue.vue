<script setup lang="ts">
import { SelectValue } from 'reka-ui'

defineProps<{
  placeholder?: string
}>()
</script>

<template>
  <SelectValue v-bind="$props">
    <slot />
  </SelectValue>
</template>
