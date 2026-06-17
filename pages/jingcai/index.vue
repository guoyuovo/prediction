<template>
  <view class="wrap">
    <!-- 分段:荐彩 / 搏·串关 -->
    <view class="seg">
      <text class="seg-i" :class="{ on: tab === 'rec' }" @click="tab = 'rec'">荐彩</text>
      <text class="seg-i" :class="{ on: tab === 'bo' }" @click="tab = 'bo'">搏·串关</text>
    </view>

    <!-- ===== 荐彩 ===== -->
    <block v-if="tab === 'rec'">
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

      <view class="disclaimer">荐彩为统计模型推演，非投注建议；回测显示模型对市场无稳定盈利优势。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
    </block>

    <!-- ===== 搏·串关(娱乐) ===== -->
    <block v-else>
      <view class="warn">⚠ 娱乐玩法。高赔=低概率，长期负 EV 是常态。模型只在「市场认为还有点可能」的结果里挑高赔，<text class="strong">不是保本、不是价值</text>。回测样本极小，胜率/ROI 不可外推到真实下注。</view>

      <view v-if="!bo" class="empty">暂无搏·串关数据（待云端刷新）。</view>

      <block v-else>
        <!-- 串关 -->
        <view class="sec-h" style="margin:10rpx 4rpx 18rpx">串关组合 <text class="sec-sub">本模型 · 价值标尺取市场</text></view>
        <view class="card" v-for="(pl, i) in bo.parlays" :key="'p' + i">
          <view class="between">
            <text class="strong">{{ pl.tier }}关 <text class="pill" style="margin-left:8rpx">{{ pl.tag }}</text></text>
            <text class="ret">×{{ pl.odds }}</text>
          </view>
          <view v-for="(l, j) in pl.legs" :key="j" class="leg">
            <image :src="flag(l.home)" class="flag-sm" mode="aspectFill" />
            <text class="lt">{{ nm(l.home) }} v {{ nm(l.away) }}</text>
            <text class="lsel" :style="{ color: dirColor(l.sel) }">{{ legSel(l) }}<text v-if="l.lean" class="lean"> ⚑</text></text>
            <text class="lodds">@{{ l.odds }}</text>
          </view>
          <view class="between foot">
            <text class="muted">命中概率 {{ pct(pl.p) }}</text>
            <text class="ev">EV {{ pl.ev }}</text>
            <text class="muted">100元中得 {{ Math.round(pl.odds * 100) }}元</text>
          </view>
        </view>

        <!-- 高赔单 -->
        <view class="sec-h" style="margin:26rpx 4rpx 18rpx">高赔单关</view>
        <view class="card single" v-for="(s, i) in bo.singles" :key="'s' + i">
          <image :src="flag(s.legs[0].home)" class="flag-sm" mode="aspectFill" />
          <view style="flex:1;margin-left:14rpx">
            <text class="lt">{{ nm(s.legs[0].home) }} v {{ nm(s.legs[0].away) }}</text>
            <text class="tiny" style="display:block;color:#7c8597">市场 {{ pct(s.legs[0].q) }} · 模型 {{ pct(s.legs[0].modelP) }}<text v-if="s.legs[0].lean" class="lean"> ⚑模型偏爱</text></text>
          </view>
          <view style="text-align:right">
            <text class="lsel" :style="{ color: dirColor(s.legs[0].sel) }">{{ legSel(s.legs[0]) }}</text>
            <text class="ret" style="display:block">×{{ s.odds }}</text>
          </view>
        </view>

        <!-- 竞彩比分(波胆)娱乐卡 -->
        <view v-if="bo.cs && bo.cs.length" class="sec-h" style="margin:26rpx 4rpx 18rpx">比分·竞彩盘口 <text class="sec-sub">真实盘口 · 抽水高 · 娱乐</text></view>
        <view class="card" v-for="(c, i) in bo.cs" :key="'c' + i">
          <view class="between">
            <text class="small">{{ c.matchNum || (c.date && c.date.slice(5) + ' ' + c.time) }} · {{ nm(c.home) }} v {{ nm(c.away) }}</text>
            <text class="tiny">抽水 {{ c.vigPct }}%</text>
          </view>
          <text class="tiny" style="display:block;margin:10rpx 0 8rpx;color:#7c8597">竞彩比分盘(低赔在前)</text>
          <view class="wrapflex">
            <view v-for="(x, j) in c.market.slice(0, 8)" :key="'m' + j" class="chip"><text class="ci-name">{{ x.score }}</text><text class="ci-odds">{{ x.odds }}</text></view>
          </view>
          <text v-if="c.model && c.model.length" class="tiny" style="display:block;margin:12rpx 0 8rpx;color:#7c8597">模型最可能比分</text>
          <view v-if="c.model && c.model.length" class="wrapflex">
            <view v-for="(x, j) in c.model.slice(0, 3)" :key="'md' + j" class="chip rec"><text class="ci-name">{{ x.score }}</text><text class="ci-odds">{{ pct(x.p) }}</text></view>
          </view>
        </view>
      </block>

      <view class="disclaimer">「搏·串关」为本站模型生成的娱乐性高赔组合，长期负 EV，非投注建议、非价值/保本方案；比分盘口取自中国竞彩官方（抽水约 35%）仅作展示。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
    </block>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { load, nm } from '@/common/api.js'
import { setTabBarIndex } from '@/common/tab-bar.js'
import { dirColor, pct } from '@/common/format.js'
import { flag } from '@/common/flags.js'

onShow(() => setTabBarIndex(1))

const tab = ref('rec')
const matches = ref([])
const bo = ref(null)
load('matches').then(d => matches.value = d.matches || [])
load('bo').then(d => bo.value = d || null)

const upcoming = computed(() => matches.value.filter(m => !m.result && m.rec))
const goDetail = (m) => uni.navigateTo({ url: '/pages/match/detail?seq=' + m.seq })
// 选中方向 → 明确押哪队赢
const legSel = (l) => l.sel === 'D' ? '平局' : (l.sel === 'H' ? nm(l.home) : nm(l.away)) + '胜'
</script>

<style scoped>
.seg { display: flex; background: #181b22; border: 1rpx solid #252b38; border-radius: 16rpx; padding: 6rpx; margin-bottom: 20rpx; }
.seg-i { flex: 1; text-align: center; padding: 16rpx 0; font-size: 28rpx; color: #8b93a1; font-weight: 600; border-radius: 12rpx; }
.seg-i.on { background: #232a36; color: #4ea1ff; }
.warn { background: rgba(255,170,60,.1); border: 1rpx solid rgba(255,170,60,.3); color: #ffce8a; font-size: 23rpx; line-height: 1.6; padding: 18rpx 20rpx; border-radius: 14rpx; margin-bottom: 20rpx; }
.warn .strong { color: #ffb74a; }
.empty { text-align: center; color: #7c8597; padding: 60rpx 0; font-size: 26rpx; }
.ret { font-size: 38rpx; font-weight: 800; color: #ffcf4a; }
.leg { display: flex; align-items: center; padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.flag-sm { width: 38rpx; height: 38rpx; border-radius: 6rpx; flex-shrink: 0; }
.leg .lt { flex: 1; margin-left: 14rpx; font-size: 26rpx; color: #e8eaf0; }
.leg .lsel { font-size: 26rpx; font-weight: 700; margin-right: 14rpx; }
.leg .lean { color: #ffcf4a; font-size: 22rpx; }
.leg .lodds { font-size: 26rpx; font-weight: 700; color: #ffcf4a; width: 110rpx; text-align: right; }
.foot { margin-top: 14rpx; }
.foot .muted, .foot .ev { font-size: 22rpx; }
.foot .ev { color: #e0795a; }
.single { display: flex; align-items: center; }
.vs { display: flex; align-items: center; margin: 18rpx 0; }
.team { flex: 1; display: flex; align-items: center; }
.team.r { justify-content: flex-end; }
.team .tn { font-size: 30rpx; font-weight: 700; margin: 0 14rpx; }
.mid { text-align: center; padding: 0 12rpx; }
.mid .sc { display: block; font-size: 34rpx; font-weight: 800; color: #ffcf4a; }
.mline { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.mline:last-child { border-bottom: none; }
</style>
