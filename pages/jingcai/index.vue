<template>
  <view class="wrap">
    <view class="hero">
      <view class="between"><text class="t">荐彩参考</text><text class="pill">模型生成</text></view>
      <text class="s">单场胜平负 · 让球 · 比分 · 大小球 · 真实赔率对照</text>
    </view>

    <view class="card card-tap" v-for="m in upcoming" :key="m.seq" @click="goDetail(m)">
      <view class="between">
        <text class="small">{{ m.date && m.date.slice(5) }} {{ m.time }} · 组{{ m.g }}</text>
        <text v-if="m.titan007" class="pill" style="background:rgba(255,207,74,.14);color:#ffcf4a">赔率{{ m.titan007Co }}家</text>
      </view>
      <view class="vs">
        <view class="team"><image :src="flag(m.home)" class="flag-lg" mode="aspectFill" /><text class="tn">{{ nm(m.home) }}</text></view>
        <view class="mid"><text class="sc">{{ m.rec.score }}</text></view>
        <view class="team r"><text class="tn">{{ nm(m.away) }}</text><image :src="flag(m.away)" class="flag-lg" mode="aspectFill" /></view>
      </view>
      <view class="mline"><text class="muted">胜平负</text><text :style="{ color: dirColor(m.pick), fontWeight: 600 }">{{ m.rec.spf }}</text></view>
      <view class="mline"><text class="muted">让球方向</text><text>{{ m.rec.rq }}</text></view>
      <view class="mline"><text class="muted">大小球</text><text>{{ m.rec.total }}</text></view>
      <view class="mline" v-if="m.titan007"><text class="muted">市场赔率(主/平/客)</text><text class="gold">{{ m.titan007.map(x => x.toFixed(2)).join(' / ') }}</text></view>
    </view>

    <view class="disclaimer">荐彩为统计模型推演，非投注建议；回测显示模型对市场无稳定盈利优势。体彩官方竞彩数据将在云端接入后并列展示。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { load, nm } from '@/common/api.js'
import { setTabBarIndex } from '@/common/tab-bar.js'
import { dirColor } from '@/common/format.js'
import { flag } from '@/common/flags.js'

onShow(() => setTabBarIndex(1))

const matches = ref([])
load('matches').then(d => matches.value = d.matches || [])
const upcoming = computed(() => matches.value.filter(m => !m.result && m.rec))
const goDetail = (m) => uni.navigateTo({ url: '/pages/match/detail?seq=' + m.seq })
</script>

<style scoped>
.vs { display: flex; align-items: center; margin: 18rpx 0; }
.team { flex: 1; display: flex; align-items: center; }
.team.r { justify-content: flex-end; }
.team .tn { font-size: 30rpx; font-weight: 700; margin: 0 14rpx; }
.mid { text-align: center; padding: 0 12rpx; }
.mid .sc { display: block; font-size: 34rpx; font-weight: 800; color: #ffcf4a; }
.mline { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.mline:last-child { border-bottom: none; }
</style>
