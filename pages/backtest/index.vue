<template>
  <view class="wrap">
    <view class="hero"><text class="t">回测 · 验证</text><text class="s">真实联赛回测 · 本届 live 校准 · 完赛对账</text></view>

    <view class="seg">
      <text v-for="t in TABS" :key="t.k" class="seg-item" :class="{ on: tab === t.k }" @click="tab = t.k">{{ t.label }}</text>
    </view>

    <!-- 回测表现 -->
    <view v-if="tab === 'bt'">
      <view class="card" v-if="bt">
        <view class="sec-h">三模型回测 <text class="sec-sub">{{ bt.n }}场 + B365赔率</text></view>
        <view class="btrow head"><text style="flex:2">模型</text><text>命中</text><text>Brier</text><text>平注ROI</text></view>
        <view class="btrow" v-for="r in btRows" :key="r.k">
          <text style="flex:2">{{ r.k }}</text>
          <text class="strong">{{ pct(r.m.acc) }}</text>
          <text>{{ fix(r.m.brier, 3) }}</text>
          <text :class="r.m.flatROI >= 0 ? 'green' : 'red'">{{ (r.m.flatROI * 100).toFixed(1) }}%</text>
        </view>
        <text class="small" style="margin-top:14rpx;display:block">三者几乎一致（综合略优、噪声内）；ROI 全负——模型对市场无 edge。价值在双视角 + 分歧预警，非盈利。</text>
      </view>
      <view class="card" v-if="tune">
        <view class="sec-h">融合权重调参 <text class="sec-sub">时间切分</text></view>
        <text class="small" style="display:block;margin-bottom:14rpx">训练 {{ tune.train }} 场 / 测试 {{ tune.test }} 场。最优 α∈[{{ tune.alphaStar }},{{ tune.brierStar }}]，采等权 0.5。</text>
        <view class="sec-h" style="font-size:26rpx">置信度校准（最高概率→实际命中）</view>
        <view class="mline" v-for="c in (tune.calib || [])" :key="c.range"><text class="muted">{{ c.range }}</text><text><text class="tiny">{{ c.n }}场</text> {{ c.hitRate != null ? pct(c.hitRate) : '—' }}</text></view>
        <text class="small" style="margin-top:10rpx;display:block">55% 处命中率跳变，验证高/中/低置信阈值。</text>
      </view>
    </view>

    <!-- live 校准 -->
    <view v-if="tab === 'calib'">
      <view class="card" v-if="v2 && v2.calibration">
        <view class="sec-h">本届 live 校准 <text class="sec-sub">随完赛累积</text></view>
        <view class="mline" v-for="c in v2.calibration" :key="c.range"><text class="muted">{{ c.range }}</text><text><text class="tiny">{{ c.n }}场</text> {{ c.hitRate != null ? pct(c.hitRate) : '—' }}</text></view>
      </view>
      <view class="card" v-if="v2 && v2.timeline">
        <view class="sec-h">累积命中 / Brier</view>
        <view class="mline" v-for="t in v2.timeline" :key="t.i"><text class="muted">{{ t.i }}. {{ t.label }}</text><text>命中{{ pct(t.accCum) }} · B{{ fix(t.brierCum, 3) }}</text></view>
      </view>
    </view>

    <!-- 完赛对账 -->
    <view v-if="tab === 'recon'">
      <view class="card" v-if="v2 && v2.completed">
        <view class="sec-h">完赛逐场对账 <text class="sec-sub">赛前 vs 实际</text></view>
        <view class="reconrow" v-for="(m, i) in v2.completed" :key="i">
          <view class="between"><text class="strong">{{ nm(m.home) }} {{ m.hs }}-{{ m.as }} {{ nm(m.away) }}</text><text :class="m.correct ? 'green' : 'red'" style="font-weight:700">{{ m.correct ? '✓' : '✗' }}</text></view>
          <text class="tiny">预测{{ dirZh(m.predOutcome) }}/实际{{ dirZh(m.actual) }} · 比分预测{{ m.predScore }} · ΔElo{{ m.eloDelta >= 0 ? '+' : '' }}{{ m.eloDelta }}</text>
        </view>
      </view>
      <view class="card" v-if="v2 && v2.eloChanges && v2.eloChanges.length">
        <view class="sec-h">滚动 Elo 变化</view>
        <view class="mline" v-for="c in v2.eloChanges" :key="c.team"><text>{{ nm(c.team) }}</text><text :class="c.delta >= 0 ? 'green' : 'red'">{{ c.before }}→{{ c.after }} ({{ c.delta >= 0 ? '+' : '' }}{{ c.delta }})</text></view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { load, nm } from '@/common/api.js'
import { pct, dirZh, fix } from '@/common/format.js'

const TABS = [{ k: 'bt', label: '回测表现' }, { k: 'calib', label: 'live校准' }, { k: 'recon', label: '完赛对账' }]
const tab = ref('bt')
const bt = ref(null), tune = ref(null), v2 = ref(null)
load('dual').then(d => { bt.value = d.backtest; tune.value = d.tune })
load('v2').then(d => v2.value = d)
const btRows = computed(() => {
  const s = bt.value && bt.value.summary
  return s ? [{ k: '① 多因子', m: s.weighted }, { k: '② xG', m: s.xg }, { k: '③ 综合', m: s.dual }] : []
})
</script>

<style scoped>
.btrow { display: flex; padding: 16rpx 0; border-bottom: 1rpx solid #20262f; }
.btrow text { flex: 1; }
.btrow.head { color: #7c8597; font-size: 21rpx; }
.mline { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.mline:last-child { border-bottom: none; }
.reconrow { padding: 16rpx 0; border-bottom: 1rpx solid #20262f; }
.reconrow:last-child { border-bottom: none; }
</style>
