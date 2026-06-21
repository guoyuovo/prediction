<template>
  <view class="wrap">
    <view class="hero">
      <view class="between"><text class="pill">娱乐玩法</text></view>
      <text class="s">自选串关 · 系统荐彩 · 历史战绩 · 国际盘(Bovada)口径</text>
    </view>

    <view class="warn">⚠ 娱乐玩法。高赔=低概率,长期负 EV 是常态。命中率/EV 用市场盘口口径,模型仅作 ⚑ 风味参考,<text class="strong">非保本、非价值</text>。</view>
    <view v-if="!bo" class="empty">暂无串关数据(待云端刷新)。</view>

      <block v-else>
        <view class="seg2">
          <text :class="{ on: boTab === 'custom' }" @click="boTab = 'custom'">自选串关</text>
          <text :class="{ on: boTab === 'system' }" @click="boTab = 'system'">系统荐彩</text>
          <text :class="{ on: boTab === 'history' }" @click="boTab = 'history'">历史战绩</text>
        </view>

        <block v-if="boTab !== 'history'">
          <view class="plays">
            <text v-for="p in PLAYS" :key="p.key" class="play" :class="{ on: play === p.key, dis: !bo.coverage[p.key] }" @click="bo.coverage[p.key] && setPlay(p.key)">{{ p.label }}<text v-if="!bo.coverage[p.key]" class="lk"> 🔒</text></text>
          </view>
          <view class="risk">
            <text :class="{ on: risk === 'steady' }" @click="setRisk('steady')">稳搏</text>
            <text :class="{ on: risk === 'aggressive' }" @click="setRisk('aggressive')">激进搏</text>
            <text class="rh">{{ risk === 'steady' ? '温和冷门·偏命中' : '长尾大赔·命中更低' }}</text>
          </view>
          <text v-if="play === 'hafu'" class="tiny dim">半全场无模型支持,仅市场盘口口径。</text>
          <text v-if="curVig" class="tiny dim">本玩法抽水约 {{ curVig }}%(国际盘 Bovada)。</text>
        </block>

        <!-- ── 自选串关 ── -->
        <block v-if="boTab === 'custom'">
          <view v-for="c in playCands" :key="c.key" class="mc" :class="{ sel: !!picks[c.key], na: !c.rec[risk] }">
            <view class="mc-h" @click="toggle(c)">
              <text class="ck">{{ picks[c.key] ? '☑' : (c.rec[risk] ? '☐' : '—') }}</text>
              <text class="mn">{{ nm(c.home) }} v {{ nm(c.away) }}</text>
              <text class="md">{{ c.date && c.date.slice(5) }} {{ c.time }}</text>
            </view>
            <view v-if="!c.rec[risk]" class="na-t">本档无甜区腿</view>
            <template v-else>
              <view v-if="picks[c.key]" class="opts">
                <text v-for="o in c.options" :key="o.sel" class="op" :class="{ on: picks[c.key].sel === o.sel }" @click="pick(c, o)">{{ o.selZh }} @{{ o.odds }}<text v-if="o.lean" class="ln"> ⚑</text></text>
              </view>
              <view v-else class="rec-t">推荐 {{ recOpt(c).selZh }} @{{ recOpt(c).odds }} · 市场 {{ pct(recOpt(c).q) }}<text v-if="recOpt(c).lean" class="ln"> ⚑</text></view>
            </template>
          </view>

          <view class="bar">
            <text class="bl">已选 {{ pickCount }} 场<text v-if="pickCount >= 2"> · {{ comboLabel }}</text></text>
            <text class="gen" :class="{ dis: pickCount < 2 }" @click="gen">生成方案</text>
          </view>

          <block v-if="result">
            <view v-for="grp in result.byTier" :key="grp.tier" class="card">
              <view class="sec-h">{{ grp.tier }}串1 <text class="sec-sub">{{ grp.bets.length }} 注</text></view>
              <view v-for="(bet, i) in grp.bets" :key="i" class="bet">
                <view class="between"><text class="strong">{{ bet.legs.map(l => nm(l.home).slice(0, 3) + l.selZh).join(' + ') }}</text><text class="ret">×{{ bet.odds }}</text></view>
                <view class="between foot"><text class="muted">命中 {{ pct(bet.pAdj) }} <text class="tiny">(裸算 {{ pct(bet.p) }})</text></text><text class="ev">EV {{ bet.ev }}</text></view>
              </view>
            </view>
            <text class="tiny dim">命中率为各场独立近似,实际偏乐观;EV 为市场口径,恒为负。</text>
          </block>
        </block>

        <!-- ── 系统荐彩 ── -->
        <block v-else-if="boTab === 'system'">
          <view class="card" v-for="(pl, i) in sysParlays" :key="'s' + i">
            <view class="between"><text class="strong">{{ pl.tag }}</text><text class="ret">×{{ pl.odds }}</text></view>
            <view v-for="(l, j) in pl.legs" :key="j" class="leg">
              <image :src="flag(l.home)" class="flag-sm" mode="aspectFill" />
              <text class="lt">{{ nm(l.home) }} v {{ nm(l.away) }}</text>
              <text class="lsel" :style="{ color: dirColor(l.sel) }">{{ l.selZh }}<text v-if="l.lean" class="ln"> ⚑</text></text>
              <text class="lodds">@{{ l.odds }}</text>
            </view>
            <view class="between foot"><text class="muted">命中 {{ pct(pl.pAdj) }}</text><text class="ev">EV {{ pl.ev }}</text></view>
          </view>
          <view v-if="!sysParlays.length" class="empty">本档暂无系统注。</view>
        </block>

        <!-- ── 历史战绩 ── -->
        <block v-else>
          <view v-if="hist" class="hsum">
            <view class="hrow">
              <view class="hcell"><text class="hv">{{ hist.overall.winRate != null ? pct(hist.overall.winRate) : '—' }}</text><text class="hk">总命中率</text></view>
              <view class="hcell"><text class="hv">{{ hist.overall.win }}/{{ hist.overall.settled }}</text><text class="hk">已结算(中/总)</text></view>
              <view class="hcell"><text class="hv">{{ hist.overall.pending }}</text><text class="hk">待开</text></view>
            </view>
            <view class="hrow sub">
              <view class="hcell"><text class="hv2" :class="roiCls(hist.byRisk.steady.roi)">{{ roiTxt(hist.byRisk.steady.roi) }}</text><text class="hk">稳搏ROI · {{ hist.byRisk.steady.winRate != null ? pct(hist.byRisk.steady.winRate) : '—' }}</text></view>
              <view class="hcell"><text class="hv2" :class="roiCls(hist.byRisk.aggressive.roi)">{{ roiTxt(hist.byRisk.aggressive.roi) }}</text><text class="hk">激进ROI · {{ hist.byRisk.aggressive.winRate != null ? pct(hist.byRisk.aggressive.winRate) : '—' }}</text></view>
            </view>
            <text class="tiny dim">ROI=每注押1单位的净回报率(恒为娱乐参考);命中率为已结算注的实际命中。历史自上线起逐日累积。</text>
          </view>

          <view class="hseg">
            <text v-for="f in HFILTERS" :key="f.key" :class="{ on: hFilter === f.key }" @click="hFilter = f.key">{{ f.label }}</text>
          </view>

          <view v-for="(it, i) in histItems" :key="'h' + i" class="card hcard" :class="'st-' + it.status">
            <view class="between">
              <text class="strong">{{ riskZh(it.risk) }} · {{ it.tag }}</text>
              <text class="hbadge" :class="'st-' + it.status">{{ statusZh(it.status) }}<text v-if="it.status !== 'pending'"> ×{{ it.odds }}</text></text>
            </view>
            <view v-for="(l, j) in it.legs" :key="j" class="hleg">
              <text class="hlt">{{ nm(l.home) }} {{ l.selZh }}</text>
              <text class="hlo">@{{ l.odds }}</text>
              <text v-if="it.legResults" class="hlr" :class="it.legResults[j] && it.legResults[j].hit ? 'ok' : 'no'">{{ it.legResults[j] ? (it.legResults[j].hit ? '✓' : '✗') + ' ' + it.legResults[j].actualScore : '' }}</text>
            </view>
            <view class="between hfoot"><text class="muted">推荐 {{ it.firstSeen }}</text><text class="muted">连乘 ×{{ it.odds }}</text></view>
          </view>
          <view v-if="!histItems.length" class="empty">暂无{{ hFilter === 'all' ? '' : (hFilter === 'pending' ? '待开' : hFilter === 'win' ? '命中' : '未中') }}记录(历史自上线起逐日累积)。</view>
        </block>
      </block>

    <view class="disclaimer">「串关」为本站模型/国际盘口(Bovada)生成的娱乐性组合,长期负 EV,非投注建议、非价值/保本方案。理性购彩,量力而行,未满 18 周岁禁止参与。</view>
  </view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { load, nm } from '@/common/api.js'
import { setTabBarIndex } from '@/common/tab-bar.js'
import { dirColor, pct } from '@/common/format.js'
import { flag } from '@/common/flags.js'
import { buildCombos } from '@/common/combo.js'

onShow(() => setTabBarIndex(1))

const PLAYS = [{ key: 'had', label: '胜平负' }, { key: 'crs', label: '波胆' }, { key: 'ttg', label: '进球数' }, { key: 'hafu', label: '半全场' }]
const HFILTERS = [{ key: 'all', label: '全部' }, { key: 'pending', label: '待开' }, { key: 'win', label: '命中' }, { key: 'lose', label: '未中' }]
const K_MAX = 4

const boTab = ref('custom')
const hFilter = ref('all')
const play = ref('had')
const risk = ref('steady')
const bo = ref(null)
const picks = reactive({})
const result = ref(null)

load('bo').then(d => bo.value = d || null)

// 按赛程(seq=开赛顺序)排序展示候选腿
const playCands = computed(() => (bo.value && bo.value.legCandidates || []).filter(l => l.play === play.value).slice().sort((a, b) => a.seq - b.seq))
const curVig = computed(() => { const c = playCands.value[0]; return c ? c.vigPct : 0 })
const recOpt = (c) => c.options.find(o => o.sel === c.rec[risk.value]) || c.options[0]
const pickCount = computed(() => Object.keys(picks).length)
const comboLabel = computed(() => { const k = Math.min(pickCount.value, K_MAX); return k >= 2 ? `${k}串${Math.pow(2, k) - k - 1}` : '' })
const sysParlays = computed(() => {
  const s = bo.value && bo.value.system && bo.value.system[risk.value]
  if (!s) return []
  // 每注内的腿按赛程(seq)排序
  return [...s.singles, ...s.parlays].map(pl => ({ ...pl, legs: pl.legs.slice().sort((a, b) => a.seq - b.seq) }))
})

// 历史战绩
const hist = computed(() => bo.value && bo.value.history && bo.value.history.summary || null)
const histItems = computed(() => {
  const all = bo.value && bo.value.history && bo.value.history.items || []
  return hFilter.value === 'all' ? all : all.filter(p => p.status === hFilter.value)
})
const riskZh = (r) => r === 'aggressive' ? '激进' : '稳搏'
const statusZh = (s) => s === 'win' ? '命中' : s === 'lose' ? '未中' : '待开'
const roiTxt = (v) => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(0) + '%'
const roiCls = (v) => v == null ? '' : v > 0 ? 'up' : v < 0 ? 'down' : ''

const reset = () => { for (const k in picks) delete picks[k]; result.value = null }
const setPlay = (k) => { if (play.value !== k) { play.value = k; reset() } }
const setRisk = (r) => { if (risk.value !== r) { risk.value = r; reset() } }

const mkLeg = (c, o) => ({ key: c.key, home: c.home, away: c.away, play: c.play, sel: o.sel, selZh: o.selZh, q: o.q, odds: o.odds, lean: o.lean })
const toggle = (c) => {
  if (picks[c.key]) { delete picks[c.key]; result.value = null; return }
  if (!c.rec[risk.value]) return
  if (pickCount.value >= K_MAX) { uni.showToast({ title: `最多选 ${K_MAX} 场`, icon: 'none' }); return }
  picks[c.key] = mkLeg(c, recOpt(c)); result.value = null
}
const pick = (c, o) => { picks[c.key] = mkLeg(c, o); result.value = null }
const gen = () => { if (pickCount.value < 2) return; result.value = buildCombos(Object.values(picks), K_MAX) }
</script>

<style scoped>
.seg2 { display: flex; gap: 16rpx; margin-bottom: 18rpx; }
.seg2 text { flex: 1; text-align: center; padding: 14rpx 0; font-size: 26rpx; color: #8b93a1; background: #181b22; border: 1rpx solid #252b38; border-radius: 12rpx; }
.seg2 text.on { color: #4ea1ff; border-color: #4ea1ff; }
.warn { background: rgba(255,170,60,.1); border: 1rpx solid rgba(255,170,60,.3); color: #ffce8a; font-size: 23rpx; line-height: 1.6; padding: 18rpx 20rpx; border-radius: 14rpx; margin-bottom: 20rpx; }
.warn .strong { color: #ffb74a; }
.empty { text-align: center; color: #7c8597; padding: 50rpx 0; font-size: 26rpx; }
.tiny.dim { display: block; color: #7c8597; margin: -6rpx 4rpx 12rpx; }
.plays { display: flex; gap: 12rpx; margin-bottom: 14rpx; flex-wrap: wrap; }
.plays .play { padding: 10rpx 22rpx; font-size: 26rpx; color: #9aa3b4; background: #1c2330; border: 1rpx solid #2c3445; border-radius: 12rpx; }
.plays .play.on { color: #fff; background: linear-gradient(135deg,#5aa9ff,#3d7fd6); border-color: transparent; }
.plays .play.dis { opacity: .45; }
.risk { display: flex; align-items: center; gap: 12rpx; margin-bottom: 16rpx; }
.risk text { padding: 8rpx 20rpx; font-size: 24rpx; color: #9aa3b4; background: #1c2330; border: 1rpx solid #2c3445; border-radius: 999rpx; }
.risk text.on { color: #2fd07b; border-color: rgba(47,208,123,.5); }
.risk .rh { background: none; border: none; color: #7c8597; font-size: 21rpx; padding: 0; }
.mc { background: #14171f; border: 1rpx solid #252b38; border-radius: 16rpx; padding: 18rpx 20rpx; margin-bottom: 14rpx; }
.mc.sel { border-color: rgba(78,161,255,.5); }
.mc.na { opacity: .5; }
.mc-h { display: flex; align-items: center; }
.mc-h .ck { font-size: 30rpx; margin-right: 14rpx; color: #4ea1ff; }
.mc-h .mn { flex: 1; font-size: 27rpx; font-weight: 600; color: #e8eaf0; }
.mc-h .md { font-size: 21rpx; color: #7c8597; }
.na-t { font-size: 22rpx; color: #6b7385; margin-top: 8rpx; }
.rec-t { font-size: 23rpx; color: #9aa3b4; margin-top: 10rpx; }
.opts { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; }
.opts .op { padding: 8rpx 16rpx; font-size: 23rpx; color: #cfd4e0; background: #1c2330; border: 1rpx solid #2c3445; border-radius: 10rpx; }
.opts .op.on { color: #2fd07b; border-color: rgba(47,208,123,.5); background: rgba(47,208,123,.08); }
.ln { color: #ffcf4a; }
.bar { position: sticky; bottom: calc(128rpx + env(safe-area-inset-bottom)); display: flex; align-items: center; justify-content: space-between; background: #1a1f29; border: 1rpx solid #2c3445; border-radius: 16rpx; padding: 16rpx 22rpx; margin: 18rpx 0; box-shadow: 0 6rpx 24rpx rgba(0,0,0,.4); }
.bar .bl { font-size: 25rpx; color: #e8eaf0; }
.bar .gen { background: linear-gradient(135deg,#5aa9ff,#3d7fd6); color: #fff; font-size: 25rpx; font-weight: 700; padding: 14rpx 36rpx; border-radius: 12rpx; }
.bar .gen.dis { opacity: .4; }
.bet { padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.bet:last-child { border-bottom: none; }
.ret { font-size: 32rpx; font-weight: 800; color: #ffcf4a; }
.foot { margin-top: 8rpx; }
.foot .muted, .foot .ev { font-size: 22rpx; }
.foot .ev { color: #e0795a; }
.leg { display: flex; align-items: center; padding: 12rpx 0; border-bottom: 1rpx solid #20262f; }
.flag-sm { width: 36rpx; height: 36rpx; border-radius: 6rpx; flex-shrink: 0; }
.leg .lt { flex: 1; margin-left: 12rpx; font-size: 25rpx; color: #e8eaf0; }
.leg .lsel { font-size: 25rpx; font-weight: 700; margin-right: 12rpx; }
.leg .lodds { font-size: 25rpx; font-weight: 700; color: #ffcf4a; width: 100rpx; text-align: right; }
.vs { display: flex; align-items: center; margin: 18rpx 0; }
.team { flex: 1; display: flex; align-items: center; }
.team.r { justify-content: flex-end; }
.team .tn { font-size: 30rpx; font-weight: 700; margin: 0 14rpx; }
.mid { text-align: center; padding: 0 12rpx; }
.mid .sc { display: block; font-size: 34rpx; font-weight: 800; color: #ffcf4a; }
.mline { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.mline:last-child { border-bottom: none; }
/* 历史战绩 */
.hsum { background: #14171f; border: 1rpx solid #252b38; border-radius: 16rpx; padding: 20rpx; margin-bottom: 16rpx; }
.hrow { display: flex; }
.hrow.sub { margin-top: 16rpx; padding-top: 16rpx; border-top: 1rpx solid #20262f; }
.hcell { flex: 1; text-align: center; display: flex; flex-direction: column; }
.hcell .hv { font-size: 38rpx; font-weight: 800; color: #4ea1ff; }
.hcell .hv2 { font-size: 32rpx; font-weight: 800; color: #cfd4e0; }
.hcell .hv2.up { color: #2fd07b; }
.hcell .hv2.down { color: #e0795a; }
.hcell .hk { font-size: 21rpx; color: #7c8597; margin-top: 6rpx; }
.hseg { display: flex; gap: 12rpx; margin-bottom: 14rpx; }
.hseg text { padding: 8rpx 24rpx; font-size: 23rpx; color: #9aa3b4; background: #1c2330; border: 1rpx solid #2c3445; border-radius: 999rpx; }
.hseg text.on { color: #4ea1ff; border-color: rgba(78,161,255,.5); }
.hcard { border-left: 4rpx solid #2c3445; }
.hcard.st-win { border-left-color: #2fd07b; }
.hcard.st-lose { border-left-color: #e0795a; }
.hcard.st-pending { border-left-color: #4ea1ff; }
.hbadge { font-size: 22rpx; font-weight: 700; padding: 4rpx 14rpx; border-radius: 999rpx; color: #9aa3b4; background: #1c2330; }
.hbadge.st-win { color: #2fd07b; background: rgba(47,208,123,.12); }
.hbadge.st-lose { color: #e0795a; background: rgba(224,121,90,.12); }
.hbadge.st-pending { color: #4ea1ff; background: rgba(78,161,255,.12); }
.hleg { display: flex; align-items: center; padding: 10rpx 0; border-bottom: 1rpx solid #20262f; }
.hleg:last-of-type { border-bottom: none; }
.hleg .hlt { flex: 1; font-size: 25rpx; color: #e8eaf0; }
.hleg .hlo { font-size: 24rpx; font-weight: 700; color: #ffcf4a; width: 90rpx; text-align: right; }
.hleg .hlr { width: 120rpx; text-align: right; font-size: 22rpx; }
.hleg .hlr.ok { color: #2fd07b; }
.hleg .hlr.no { color: #e0795a; }
.hfoot { margin-top: 10rpx; }
.hfoot .muted { font-size: 21rpx; color: #7c8597; }
</style>
