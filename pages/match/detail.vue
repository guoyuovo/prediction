<template>
  <view class="wrap" v-if="m">
    <!-- 头部对阵 -->
    <view class="card">
      <view class="between">
        <text class="small">{{ m.date }} {{ m.time }} · 组{{ m.g }} · 第{{ m.round }}轮</text>
        <text v-if="m.result" class="pill" style="background:rgba(47,208,123,.16);color:#2fd07b">完赛 {{ m.result.hs }}-{{ m.result.as }}</text>
      </view>
      <view class="vs">
        <view class="team"><image :src="flag(m.home)" class="flag-lg" mode="aspectFill" /><text class="tn">{{ nm(m.home) }}</text></view>
        <view class="mid"><text class="sc">{{ m.score }}</text><text class="tiny">预测比分</text></view>
        <view class="team r"><text class="tn">{{ nm(m.away) }}</text><image :src="flag(m.away)" class="flag-lg" mode="aspectFill" /></view>
      </view>
      <triple-bar :p="[m.h, m.d, m.a]" />
      <view class="between" style="margin-top:12rpx">
        <text class="small">主 {{ pct(m.h) }} · 平 {{ pct(m.d) }} · 客 {{ pct(m.a) }}</text>
        <text :style="{ color: dirColor(m.pick), fontWeight: 700 }">{{ pickText }}</text>
      </view>
      <text v-if="m.venue" class="tiny" style="margin-top:12rpx;display:block">📍 {{ m.venue }}<text v-if="m.wx"> · 🌤 {{ m.wx.tmax }}°/{{ m.wx.tmin }}° 风{{ m.wx.wind }}</text></text>
    </view>

    <!-- 🔴 滚球实时参考(手动触发,仅未完赛场次) -->
    <view class="card" v-if="!m.result">
      <view class="between">
        <text class="sec-h" style="margin:0">🔴 实时参考<text class="tiny" style="color:#7c8597;margin-left:10rpx">滚球 · 仅供参考</text></text>
        <text class="livebtn" @click="loadLive">{{ liveLoading ? '加载中…' : (live ? '刷新' : '查看实时推荐') }}</text>
      </view>
      <view v-if="live" style="margin-top:16rpx">
        <view class="between" style="margin-bottom:10rpx">
          <text class="strong" v-if="live.state==='in'">第 {{ live.minute }}′ · 实时 {{ live.score[0] }}-{{ live.score[1] }}</text>
          <text class="strong" v-else-if="live.state==='post'">已完场 {{ live.score[0] }}-{{ live.score[1] }}</text>
          <text class="strong" v-else>尚未开赛 · 赛前基线</text>
          <text v-if="live.redCards[0]||live.redCards[1]" class="tiny" style="color:#ff6470">🟥 主{{ live.redCards[0] }} 客{{ live.redCards[1] }}</text>
        </view>
        <triple-bar :p="live.p" />
        <view class="between" style="margin-top:10rpx">
          <text class="small">实时 主 {{ pct(live.p[0]) }} · 平 {{ pct(live.p[1]) }} · 客 {{ pct(live.p[2]) }}</text>
          <text style="font-weight:700;color:#ffcf4a">{{ live.lean }}</text>
        </view>
        <view class="lvgrid">
          <view v-for="o in live.ou" :key="o.line" class="lv"><text class="lvv">{{ pct(o.over) }}</text><text class="lvl">大{{ o.line }}</text></view>
          <view class="lv"><text class="lvv">{{ pct(live.moreGoals) }}</text><text class="lvl">还有球</text></view>
          <view class="lv"><text class="lvv">{{ pct(live.nextGoal[0]) }}</text><text class="lvl">下球·主</text></view>
        </view>
        <text class="tiny" style="display:block;margin-top:10rpx;color:#7c8597">最可能终场 {{ live.topScores.map(s => s.score).join(' / ') }} · 预期 {{ live.expFinal[0] }}-{{ live.expFinal[1] }}</text>
        <text class="tiny" style="display:block;margin-top:4rpx;color:#7c8597">{{ live.note }} · 理性购彩 18+</text>
      </view>
      <text v-else-if="liveTried && !liveLoading" class="tiny" style="display:block;margin-top:12rpx;color:#7c8597">暂不可用（未开赛 / 未关联云空间）。</text>
    </view>

    <!-- 完赛实况 -->
    <view class="card" v-if="m.result">
      <view class="sec-h">完赛实况</view>
      <view class="mline"><text class="muted">全场比分</text><text class="strong">{{ m.result.hs }}-{{ m.result.as }}</text></view>
      <view class="mline"><text class="muted">半场</text><text>{{ m.result.ht || '—' }}</text></view>
      <view v-if="goals.length" style="margin-top:8rpx">
        <text class="small" style="display:block;margin-bottom:10rpx">进球时间线</text>
        <view v-for="(g, i) in goals" :key="i" class="goal" :class="g.side">
          <text class="gmin">{{ g.min }}</text>
          <view class="dot" :style="{ background: g.side === 'home' ? '#2fd07b' : '#5aa9ff' }"></view>
          <text class="gtxt">{{ nm(g.side === 'home' ? m.home : m.away) }}<text v-if="g.scorer"> · {{ g.scorer }}</text><text v-if="g.pen" class="tiny">(点球)</text><text v-if="g.own" class="tiny">(乌龙)</text></text>
        </view>
      </view>
      <view v-if="m.result.pre" class="recon" :class="m.result.pre.correct ? 'hit' : 'miss'" style="margin-top:14rpx">
        <text>{{ m.result.pre.correct ? '✓ 模型预测命中' : '✗ 模型预测未中' }}</text>
        <text class="small">赛前 {{ dirZh(m.result.pre.predOutcome) }} {{ m.result.pre.predScore }}<text v-if="m.result.pre.scoreHit"> · 比分精确命中</text></text>
      </view>
      <view v-if="m.result.stats" class="statgrid">
        <view class="sg"><text class="sv">{{ m.result.stats.home.shots }}-{{ m.result.stats.away.shots }}</text><text class="sl">射门</text></view>
        <view class="sg"><text class="sv">{{ m.result.stats.home.sot }}-{{ m.result.stats.away.sot }}</text><text class="sl">射正</text></view>
        <view class="sg"><text class="sv">{{ Math.round(m.result.stats.home.poss) }}%</text><text class="sl">控球(主)</text></view>
      </view>
    </view>

    <!-- 双模型 -->
    <view class="card" v-if="dm">
      <view class="sec-h">双模型共同推断</view>
      <view class="mline"><text class="muted">① 多因子(主力)</text><text>{{ dirZh(dm.A.dir) }} · {{ dm.A.score2.join('/') }}</text></view>
      <view class="mline"><text class="muted">② xG(第二验证)</text><text>{{ dirZh(dm.B.dir) }}<text v-if="dm.B.hasXg"> {{ pct(dm.B.win) }} {{ dm.B.tier }}</text> · {{ dm.B.score2 ? dm.B.score2.join('/') : '—' }}</text></view>
      <view class="mline hot"><text :style="{ color: dm.agree ? '#2fd07b' : '#ff6470', fontWeight:700 }">③ 综合推荐</text><text :style="{ color: dirColor(dm.C.dir), fontWeight: 700 }">{{ dirZh(dm.C.dir) }} {{ pct(dm.C.max) }} · {{ dm.C.score2.join('/') }}</text></view>
      <view class="wrapflex" style="margin-top:14rpx">
        <pred-badge :text="dm.conf + '置信'" :kind="dm.conf === '高' ? 'hi' : dm.conf === '中' ? 'mid' : 'muted'" />
        <pred-badge v-if="dm.upset" :text="'⚠爆冷' + dm.upset" kind="up" />
        <pred-badge v-if="!dm.agree" text="⚠双模型分歧" kind="div" />
        <pred-badge v-if="dm.ctx && dm.ctx.elev >= 1500" :text="'⛰高原' + dm.ctx.elev + 'm'" kind="alt" />
        <pred-badge v-if="dm.adj" :text="injuryText(dm.adj)" kind="up" />
      </view>
    </view>

    <!-- 荐彩参考 -->
    <view class="card" v-if="m.rec">
      <view class="sec-h">荐彩参考 <text class="sec-sub">模型生成</text></view>
      <view class="mline"><text class="muted">单场胜平负</text><text>{{ m.rec.spf }}</text></view>
      <view class="mline"><text class="muted">让球方向</text><text>{{ m.rec.rq }}</text></view>
      <view class="mline"><text class="muted">预测比分</text><text class="gold strong">{{ m.rec.score }}</text></view>
      <view class="mline"><text class="muted">总进球</text><text>{{ m.rec.total }}</text></view>
    </view>

    <!-- 实力 & 子模型 -->
    <view class="card" v-if="m.cmp">
      <view class="sec-h">实力对比</view>
      <view class="mline"><text class="muted">Elo 评分</text><text>{{ m.cmp.elo[0] }} · {{ m.cmp.elo[1] }}</text></view>
      <view class="mline"><text class="muted">FIFA(48内)</text><text>第{{ m.cmp.fifa[0] }} · 第{{ m.cmp.fifa[1] }}</text></view>
      <view class="mline"><text class="muted">阵容身价</text><text>€{{ m.cmp.value[0] }}M · €{{ m.cmp.value[1] }}M</text></view>
      <view class="mline" v-if="m.sub"><text class="muted">特征模型(胜/平/负)</text><text>{{ f3(m.sub.base) }}</text></view>
      <view class="mline" v-if="m.sub && m.sub.mkt"><text class="muted">去水位赔率(融合)</text><text>{{ f3(m.sub.mkt) }}</text></view>
    </view>

    <!-- 赔率 -->
    <view class="card" v-if="m.titan007 || (m.src && m.src.espn)">
      <view class="sec-h">真实赔率</view>
      <view class="mline" v-if="m.titan007"><text class="gold">Titan007({{ m.titan007Co }}家)</text><text>{{ m.titan007.map(x => x.toFixed(2)).join(' / ') }}</text></view>
      <view class="mline" v-if="m.src && m.src.espn"><text class="muted">ESPN</text><text>{{ (m.espnBovada || m.src.espn).join(' / ') }}</text></view>
      <view class="mline" v-if="m.implied"><text class="muted">喂模型(去水位)</text><text>{{ m.implied.map(pct).join(' / ') }}</text></view>
      <view class="mline" v-if="m.ah"><text class="muted">让球盘</text><text>{{ m.ah.favZh }} 让{{ m.ah.line }} · {{ m.ah.read }}</text></view>
      <view class="mline" v-if="m.ou"><text class="muted">大小球</text><text>盘{{ m.ou.line }} · {{ m.ou.read }}</text></view>
    </view>

    <!-- 驱动因素 -->
    <view class="card" v-if="m.drivers && m.drivers.length">
      <view class="sec-h">模型驱动因素</view>
      <view v-for="(d, i) in m.drivers" :key="i" class="small" style="padding:6rpx 0">· {{ d }}</view>
    </view>

    <!-- 专家方案 -->
    <view class="card" v-if="plans.length">
      <view class="sec-h">专家方案 <text class="sec-sub">网易红彩</text></view>
      <view v-for="p in plans" :key="p.threadId" class="between lrow" @click="goExpert(p)">
        <view class="row" style="flex:1;min-width:0">
          <image v-if="p.expert.avatar" :src="p.expert.avatar" class="avatar sm" mode="aspectFill" />
          <view style="margin-left:14rpx;flex:1;min-width:0">
            <view class="row"><text class="strong">{{ p.expert.name }}</text><text v-if="p.unlocked" class="pill" style="margin-left:10rpx;background:rgba(47,208,123,.16);color:#2fd07b">完整</text></view>
            <text class="tiny" style="display:block">{{ p.title }}</text>
          </view>
        </view>
        <text class="accent">›</text>
      </view>
    </view>

    <view class="disclaimer">统计模型推演，仅供学术研究与娱乐参考，非投注建议。专家方案来自第三方，观点仅供参考。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getData, getLive, nm } from '@/common/api.js'
import { pct, dirZh, dirColor } from '@/common/format.js'
import { flag } from '@/common/flags.js'
import tripleBar from '@/components/triple-bar.vue'
import predBadge from '@/components/pred-badge.vue'

const m = ref(null), dm = ref(null), plans = ref([])
const live = ref(null), liveLoading = ref(false), liveTried = ref(false)
async function loadLive() {
  if (liveLoading.value || !m.value) return
  liveLoading.value = true; liveTried.value = true
  live.value = await getLive(m.value.seq)
  liveLoading.value = false
}
onLoad((q) => {
  getData().then(d => {
    const match = (d.matches.matches || []).find(x => String(x.seq) === String(q.seq)); m.value = match
    if (match) {
      dm.value = (d.dual.future || []).find(x => x.home === match.home && x.away === match.away)
      plans.value = (d.experts.plans || []).filter(p => p.home === match.home && p.away === match.away)
    }
  })
})
const goals = computed(() => (m.value && m.value.result && m.value.result.goals) || [])
const pickText = computed(() => !m.value ? '' : m.value.pick === 'H' ? nm(m.value.home) + ' 胜' : m.value.pick === 'A' ? nm(m.value.away) + ' 胜' : '平局')
const f3 = (v) => v ? pct(v[0]) + ' / ' + pct(v[1]) + ' / ' + pct(v[2]) : '—'
const injuryText = (adj) => '伤停' + (adj.home ? ' 主-' + adj.home : '') + (adj.away ? ' 客-' + adj.away : '')
const goExpert = (p) => uni.navigateTo({ url: '/pages/expert/detail?threadId=' + p.threadId })
</script>

<style scoped>
.vs { display: flex; align-items: center; margin: 22rpx 0; }
.team { flex: 1; display: flex; align-items: center; }
.team.r { justify-content: flex-end; }
.team .tn { font-size: 32rpx; font-weight: 700; margin: 0 16rpx; }
.mid { text-align: center; padding: 0 12rpx; }
.mid .sc { display: block; font-size: 38rpx; font-weight: 800; color: #ffcf4a; }
.mline { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid #20262f; }
.mline:last-child { border-bottom: none; }
.mline.hot { background: rgba(90,169,255,.06); margin: 4rpx -12rpx 0; padding: 14rpx 12rpx; border-radius: 10rpx; border: none; }
.avatar.sm { width: 60rpx; height: 60rpx; }
.goal { display: flex; align-items: center; padding: 8rpx 0; }
.goal .gmin { width: 70rpx; color: #ffcf4a; font-weight: 700; font-size: 25rpx; }
.goal .gtxt { font-size: 25rpx; }
.recon { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 18rpx; border-radius: 12rpx; font-weight: 700; }
.recon.hit { background: rgba(47,208,123,.12); color: #2fd07b; }
.recon.miss { background: rgba(255,100,112,.12); color: #ff6470; }
.statgrid { display: flex; margin-top: 16rpx; padding-top: 16rpx; border-top: 1rpx solid #20262f; }
.sg { flex: 1; text-align: center; }
.sg .sv { display: block; font-size: 30rpx; font-weight: 800; }
.sg .sl { font-size: 20rpx; color: #7c8597; }
.livebtn { font-size: 24rpx; font-weight: 700; color: #5aa9ff; padding: 8rpx 20rpx; border: 1rpx solid rgba(90,169,255,.4); border-radius: 999rpx; }
.lvgrid { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 14rpx; }
.lv { flex: 1; min-width: 90rpx; text-align: center; background: rgba(90,169,255,.06); border-radius: 10rpx; padding: 12rpx 6rpx; }
.lv .lvv { display: block; font-size: 28rpx; font-weight: 800; color: #ffcf4a; }
.lv .lvl { font-size: 20rpx; color: #7c8597; }
</style>
