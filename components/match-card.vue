<template>
  <view class="card card-tap mc">
    <view class="between">
      <text class="small">{{ m.date && m.date.slice(5) }} {{ m.time }} · 组{{ m.g }}</text>
      <text class="status" :class="done ? 'done' : 'soon'">{{ done ? '完场' : '未开赛' }}</text>
    </view>

    <!-- 队伍（竖排，比分在右） -->
    <view class="team-row" :class="{ win: done && m.result.r === 'H' }">
      <image :src="flag(m.home)" class="flag" mode="aspectFill" />
      <text class="tn">{{ nm(m.home) }}</text>
      <text v-if="done" class="sc">{{ m.result.hs }}</text>
    </view>
    <view class="team-row" :class="{ win: done && m.result.r === 'A' }">
      <image :src="flag(m.away)" class="flag" mode="aspectFill" />
      <text class="tn">{{ nm(m.away) }}</text>
      <text v-if="done" class="sc">{{ m.result.as }}</text>
    </view>

    <view class="hr" style="margin:18rpx 0 14rpx"></view>

    <triple-bar :p="[m.h, m.d, m.a]" />
    <view class="predline">
      <text class="tiny pl-l">主{{ pct(m.h) }} 平{{ pct(m.d) }} 客{{ pct(m.a) }}</text>
      <text class="pl-r" :style="{ color: dirColor(m.pick) }">{{ pickText }} · {{ m.score }}</text>
    </view>

    <!-- 完赛：进球时间线 + 预测对账 -->
    <view v-if="done" class="result">
      <view class="between">
        <text class="small">半场 {{ m.result.ht || '-' }} · <text v-if="goalsTxt">⚽ {{ goalsTxt }}</text></text>
      </view>
      <view v-if="m.result.pre" class="recon" :class="m.result.pre.correct ? 'hit' : 'miss'">
        <text>{{ m.result.pre.correct ? '✓ 预测命中' : '✗ 预测未中' }}</text>
        <text class="tiny">赛前 {{ preDir }} {{ m.result.pre.predScore }}<text v-if="m.result.pre.scoreHit" class="green"> 比分also中</text></text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { nm } from '@/common/api.js'
import { pct, dirColor, dirZh } from '@/common/format.js'
import { flag } from '@/common/flags.js'
import tripleBar from '@/components/triple-bar.vue'

const props = defineProps({ m: Object, done: Boolean })
const pickText = computed(() => props.m.pick === 'H' ? nm(props.m.home) + '胜' : props.m.pick === 'A' ? nm(props.m.away) + '胜' : '平局')
const preDir = computed(() => props.m.result && props.m.result.pre ? dirZh(props.m.result.pre.predOutcome) : '')
const goalsTxt = computed(() => {
  const g = props.m.result && props.m.result.goals || []
  return g.map(x => x.min + (x.own ? '(乌)' : '') + (x.pen ? '(点)' : '')).join('  ')
})
</script>

<style scoped>
.mc { padding: 24rpx 26rpx; }
.status { font-size: 21rpx; padding: 4rpx 16rpx; border-radius: 999rpx; }
.status.soon { background: rgba(90,169,255,.14); color: #5aa9ff; }
.status.done { background: rgba(47,208,123,.16); color: #2fd07b; }
.team-row { display: flex; align-items: center; padding: 12rpx 0; }
.team-row .flag { width: 48rpx; height: 34rpx; border-radius: 5rpx; }
.team-row .tn { flex: 1; min-width: 0; font-size: 32rpx; font-weight: 700; margin-left: 18rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.team-row .sc { font-size: 36rpx; font-weight: 800; color: #e8eaf0; }
.team-row.win .tn { color: #fff; }
.team-row.win .sc { color: #ffcf4a; }
.predline { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; gap: 16rpx; }
.pl-l { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.pl-r { flex-shrink: 0; font-weight: 700; font-size: 25rpx; white-space: nowrap; }
.result { margin-top: 16rpx; padding-top: 14rpx; border-top: 1rpx solid #20262f; }
.recon { display: flex; align-items: center; justify-content: space-between; margin-top: 10rpx; padding: 12rpx 18rpx; border-radius: 12rpx; font-weight: 700; font-size: 25rpx; }
.recon.hit { background: rgba(47,208,123,.12); color: #2fd07b; }
.recon.miss { background: rgba(255,100,112,.12); color: #ff6470; }
</style>
