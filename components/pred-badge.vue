<template>
  <text class="badge" :style="{ background: bg, color: fg }">{{ text }}</text>
</template>
<script setup>
import { computed } from 'vue'
const props = defineProps({ text: String, kind: { type: String, default: 'muted' } })
const MAP = {
  hi: ['rgba(54,194,117,.16)', '#36c275'],
  mid: ['rgba(255,194,61,.16)', '#ffc23d'],
  up: ['rgba(255,93,108,.16)', '#ff5d6c'],
  div: ['rgba(255,93,108,.2)', '#ff5d6c'],
  alt: ['rgba(139,147,161,.16)', '#c7cdd8'],
  muted: ['rgba(139,147,161,.16)', '#8b93a1']
}
const bg = computed(() => (MAP[props.kind] || MAP.muted)[0])
const fg = computed(() => (MAP[props.kind] || MAP.muted)[1])
</script>
<style scoped>
.badge { display: inline-block; padding: 2rpx 14rpx; border-radius: 10rpx; font-size: 22rpx; margin: 2rpx 8rpx 2rpx 0; }
</style>
