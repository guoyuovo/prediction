<template>
  <view class="triple">
    <view class="seg h" :style="{ width: (p[0] * 100) + '%' }"><text v-if="p[0] > 0.12" class="lab">{{ Math.round(p[0]*100) }}</text></view>
    <view class="seg d" :style="{ width: (p[1] * 100) + '%' }"><text v-if="p[1] > 0.12" class="lab">{{ Math.round(p[1]*100) }}</text></view>
    <view class="seg a" :style="{ width: (p[2] * 100) + '%' }"><text v-if="p[2] > 0.12" class="lab">{{ Math.round(p[2]*100) }}</text></view>
  </view>
</template>
<script setup>
defineProps({ p: { type: Array, default: () => [0.34, 0.33, 0.33] } })
</script>
<style scoped>
.triple { display: flex; width: 100%; height: 40rpx; border-radius: 12rpx; overflow: hidden; background: #1f2530; }
.seg { height: 100%; display: flex; align-items: center; justify-content: center; min-width: 0; }
.lab { font-size: 20rpx; color: rgba(255,255,255,.92); font-weight: 700; }
.h { background: linear-gradient(135deg,#2fd07b,#23a862); }
.d { background: linear-gradient(135deg,#ffc23d,#e0a322); }
.a { background: linear-gradient(135deg,#5aa9ff,#3d7fd6); }
</style>
