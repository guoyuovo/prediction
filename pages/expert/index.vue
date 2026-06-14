<template>
  <view class="wrap">
    <view class="hero">
      <view class="between"><text class="t">专家方案</text><text class="pill">网易红彩 · {{ plans.length }}条</text></view>
      <text class="s">世界杯免费方案 · 含推荐与赔率 · 与本站模型对照</text>
    </view>

    <view v-if="!plans.length" class="card"><text class="muted">暂无方案数据。</text></view>

    <view class="card card-tap" v-for="p in plans" :key="p.threadId" @click="goDetail(p)">
      <view class="row">
        <image v-if="p.expert.avatar" :src="p.expert.avatar" class="avatar" mode="aspectFill" />
        <view style="flex:1;margin-left:16rpx;min-width:0">
          <view class="row">
            <text class="strong" style="font-size:30rpx">{{ p.expert.name }}</text>
            <text v-if="p.expert.hitRate != null" class="pill" style="margin-left:12rpx;background:rgba(255,207,74,.14);color:#ffcf4a">命中 {{ Math.round(p.expert.hitRate*100) }}%</text>
            <text v-if="p.unlocked" class="pill" style="margin-left:8rpx;background:rgba(47,208,123,.16);color:#2fd07b">完整</text>
            <text v-else class="pill" style="margin-left:8rpx">🔒</text>
          </view>
          <text class="tiny">{{ p.expert.slogan }} · {{ p.publishTime }}</text>
        </view>
      </view>

      <text class="title">{{ p.title }}</text>

      <view class="matchrow">
        <view class="row" style="flex:1;min-width:0">
          <image :src="flag(p.home)" class="flag" mode="aspectFill" />
          <text class="mn">{{ matchName(p) }}</text>
          <image :src="flag(p.away)" class="flag" mode="aspectFill" style="margin-left:8rpx" />
        </view>
        <text v-if="dirOf(p)" :style="{ color: dirColor(dirOf(p)), fontWeight: 700 }">模型 {{ dirZh(dirOf(p)) }}{{ pct(maxOf(p)) }}</text>
      </view>

      <view v-if="p.unlocked && p.recommends.length" class="wrapflex" style="margin-top:14rpx">
        <view v-for="(it, j) in firstItems(p)" :key="j" class="chip rec" style="margin-bottom:0"><text class="ci-name">{{ it.name }}</text><text class="ci-odds">{{ it.odds }}</text></view>
      </view>
    </view>

    <view class="disclaimer">专家方案来自第三方平台（网易红彩），观点仅供参考，不代表本站立场。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { getData, nm } from '@/common/api.js'
import { pct, dirZh, dirColor } from '@/common/format.js'
import { flag } from '@/common/flags.js'

const plans = ref([]); const dualMap = ref({})
getData().then(d => { plans.value = d.experts.plans || []; for (const f of (d.dual.future || [])) dualMap.value[f.home + '|' + f.away] = f })

const dm = (p) => (p.home && p.away) ? dualMap.value[p.home + '|' + p.away] : null
const dirOf = (p) => { const d = dm(p); return d ? d.C.dir : null }
const maxOf = (p) => { const d = dm(p); return d ? d.C.max : null }
const matchName = (p) => (nm(p.home) !== p.home || nm(p.away) !== p.away) ? (nm(p.home) + ' vs ' + nm(p.away)) : p.matchZh
const firstItems = (p) => (p.recommends[0] && p.recommends[0].items) ? p.recommends[0].items.slice(0, 3) : []
const goDetail = (p) => uni.navigateTo({ url: '/pages/expert/detail?threadId=' + p.threadId })
</script>

<style scoped>
.title { display: block; font-size: 28rpx; font-weight: 600; margin: 18rpx 0 14rpx; line-height: 1.5; }
.matchrow { display: flex; align-items: center; justify-content: space-between; padding-top: 16rpx; border-top: 1rpx solid #20262f; }
.mn { font-size: 25rpx; font-weight: 600; margin: 0 8rpx; }
</style>
