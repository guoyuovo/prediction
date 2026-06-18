<template>
  <view class="wrap">
    <view class="hero">
      <view class="between">
        <text class="pill" :class="{ warn: stale }">{{ updated }}{{ stale ? ' · 偏旧' : '' }}</text>
      </view>
      <text class="s">v2 滚动模型 · 双模型共同推断 · 透明回测</text>
      <text v-if="offline" class="degraded">⚠ 离线快照 · 未能连上数据服务，当前显示 App 内置数据（可能较旧），请检查网络后重进</text>
      <text v-if="degraded" class="degraded">⚠ 上次更新有数据源未刷新（{{ health.failed.join('、') }}），相关数值沿用上次</text>
    </view>

    <view class="seg">
      <text v-for="t in TABS" :key="t.k" class="seg-item" :class="{ on: tab === t.k }" @click="tab = t.k">{{ t.label }}</text>
    </view>

    <!-- 对阵预测（默认） -->
    <view v-if="tab === 'match'">
      <view class="lead">即将开赛 · 按时间排序</view>
      <view v-for="m in upcoming" :key="m.seq" @click="goDetail(m)">
        <match-card :m="m" />
      </view>
      <view v-if="!upcoming.length" class="card"><text class="muted">暂无未开赛场次。</text></view>

      <view class="foldhead" @click="showHist = !showHist">
        <text class="strong">已完赛 · 预测对账（{{ history.length }}）</text>
        <text class="accent">{{ showHist ? '收起 ▲' : '展开 ▼' }}</text>
      </view>
      <view v-if="showHist">
        <view v-for="m in history" :key="m.seq" @click="goDetail(m)">
          <match-card :m="m" done />
        </view>
      </view>
    </view>

    <!-- 夺冠 -->
    <view v-if="tab === 'champ'" class="card">
      <view class="sec-h">夺冠概率 <text class="sec-sub">已纳入完赛</text></view>
      <view v-for="(c, i) in champions.slice(0, 20)" :key="c.team" class="lrow">
        <view class="between">
          <view class="row" style="flex:1;min-width:0">
            <text class="rk" :class="{ top: i < 3 }">{{ i + 1 }}</text>
            <image :src="flag(c.team)" class="flag" mode="aspectFill" />
            <text class="strong" style="margin-left:14rpx">{{ nm(c.team) }}</text>
          </view>
          <text class="gold strong" style="font-size:30rpx">{{ pct1(c.champion) }}</text>
        </view>
        <view class="prog"><view class="prog-f" :style="{ width: (c.champion / maxChamp * 100) + '%' }"></view></view>
        <text class="tiny">进32 {{ pct(c.r32) }} · 进4强 {{ pct(c.sf) }} · 决赛 {{ pct(c.final) }}</text>
      </view>
    </view>

    <!-- 出线 -->
    <view v-if="tab === 'group'">
      <view v-for="(rows, g) in groups" :key="g" class="card">
        <view class="sec-h">组 {{ g }}</view>
        <view v-for="(r, i) in rows" :key="r.team" class="between lrow">
          <view class="row"><view class="dot" :style="{ background: i < 2 ? '#2fd07b' : '#3a4150' }"></view><image :src="flag(r.team)" class="flag" mode="aspectFill" /><text :class="{ strong: i < 2 }" style="margin-left:12rpx">{{ nm(r.team) }}</text></view>
          <view class="row"><text class="small" style="margin-right:18rpx">进32 {{ pct(r.r32) }}</text><text class="gold">{{ pct(r.champion) }}</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getData, nm } from '@/common/api.js'
import { setTabBarIndex } from '@/common/tab-bar.js'
import { pct, pct1 } from '@/common/format.js'
import { flag } from '@/common/flags.js'
import matchCard from '@/components/match-card.vue'

onShow(() => setTabBarIndex(0))

const TABS = [{ k: 'match', label: '对阵预测' }, { k: 'champ', label: '夺冠' }, { k: 'group', label: '出线' }]
const tab = ref('match')
const showHist = ref(false)
const meta = ref({}), champions = ref([]), groups = ref({}), matches = ref([])
const apply = (d) => { if (!d) return; meta.value = d.meta; champions.value = (d.champions.champions || []); groups.value = d.champions.groups || {}; matches.value = d.matches.matches || [] }
getData().then(apply)

// 真实更新时间(lastUpdate/fetchedAt 是 UTC，转北京时间显示)；meta.date 只是模型数据基准日，不当更新时间用
const updatedIso = computed(() => meta.value.lastUpdate || meta.value.fetchedAt || null)
const updated = computed(() => {
  if (!updatedIso.value) return meta.value.date || ''
  const d = new Date(new Date(updatedIso.value).getTime() + 8 * 3600000)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
})
// 正常每小时刷新一次，>90 分钟未更新视为偏旧（定时未触发/抓取失败时给用户明确提示）
const stale = computed(() => {
  if (!updatedIso.value) return false
  return (Date.now() - new Date(updatedIso.value).getTime()) / 60000 > 90
})
const health = computed(() => meta.value.health || null)
const degraded = computed(() => !!(health.value && health.value.failed && health.value.failed.length))
// 数据来源回退到内置包：显式提示，别让用户把冻结的旧数据误当最新
const offline = computed(() => meta.value.source === 'bundled')
const upcoming = computed(() => matches.value.filter(m => !m.result).sort((a, b) => a.seq - b.seq))
const history = computed(() => matches.value.filter(m => m.result).sort((a, b) => b.seq - a.seq))
const maxChamp = computed(() => Math.max(...champions.value.map(c => c.champion), 0.01))
const goDetail = (m) => uni.navigateTo({ url: '/pages/match/detail?seq=' + m.seq })
</script>

<style scoped>
.pill.warn { background: rgba(255,159,67,.16); color: #ff9f43; }
.degraded { display: block; margin-top: 12rpx; font-size: 21rpx; color: #ff9f43; }
.lead { font-size: 23rpx; color: #7c8597; margin: 4rpx 4rpx 16rpx; }
.foldhead { display: flex; align-items: center; justify-content: space-between; padding: 24rpx; margin: 8rpx 0 20rpx; background: #14171f; border: 1rpx solid #252b38; border-radius: 18rpx; }
.rk { width: 48rpx; font-size: 26rpx; color: #7c8597; font-weight: 700; text-align: center; }
.rk.top { color: #ffcf4a; }
.prog { height: 10rpx; background: #1f2530; border-radius: 999rpx; margin: 12rpx 0 8rpx; overflow: hidden; }
.prog-f { height: 100%; background: linear-gradient(90deg,#ffcf4a,#ff9d3d); border-radius: 999rpx; }
</style>
