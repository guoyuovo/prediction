<template>
  <view class="wrap">
    <view class="hero">
      <view class="between"><text class="t">专家方案</text><text class="pill">网易红彩 · {{ rows.length }}条</text></view>
      <text class="s">世界杯免费方案 · 本站模型 vs 专家 对照</text>
      <view v-if="stats.cmp" class="s2">
        <text>方向一致 </text><text class="hl">{{ stats.same }}/{{ stats.cmp }}</text><text> 条</text>
        <text v-if="stats.done">　·　赛后命中 模型 </text><text v-if="stats.done" class="hl">{{ stats.mHit }}/{{ stats.done }}</text><text v-if="stats.done"> · 专家 {{ stats.eHit }}/{{ stats.eCmp }}</text>
      </view>
    </view>

    <view v-if="!rows.length" class="card"><text class="muted">暂无方案数据。</text></view>

    <view class="card card-tap" v-for="r in rows" :key="r.p.threadId" @click="goDetail(r.p)">
      <view class="row">
        <image v-if="r.p.expert.avatar" :src="r.p.expert.avatar" class="avatar" mode="aspectFill" />
        <view style="flex:1;margin-left:16rpx;min-width:0">
          <view class="row">
            <text class="strong" style="font-size:30rpx">{{ r.p.expert.name }}</text>
            <text v-if="r.p.expert.hitRate != null" class="pill" style="margin-left:12rpx;background:rgba(255,207,74,.14);color:#ffcf4a">命中 {{ Math.round(r.p.expert.hitRate*100) }}%</text>
            <text v-if="r.p.unlocked" class="pill" style="margin-left:8rpx;background:rgba(47,208,123,.16);color:#2fd07b">完整</text>
            <text v-else class="pill" style="margin-left:8rpx">🔒</text>
          </view>
          <text class="tiny">{{ r.p.expert.slogan }} · {{ r.p.publishTime }}</text>
        </view>
      </view>

      <text class="title">{{ r.p.title }}</text>

      <!-- 对照面板 -->
      <view class="cmp">
        <view class="cmp-head">
          <image :src="flag(r.p.home)" class="flag" mode="aspectFill" />
          <text class="mn">{{ matchName(r.p) }}</text>
          <image :src="flag(r.p.away)" class="flag" mode="aspectFill" />
          <text v-if="r.ag" class="tag" :class="r.ag">{{ r.ag === 'same' ? '方向一致' : '方向分歧' }}</text>
        </view>
        <view class="cmp-row">
          <text class="cmp-k">本站模型</text>
          <text v-if="r.m" class="cmp-dir" :style="{ color: dirColor(r.m.dir) }">{{ dirZh(r.m.dir) }} {{ pct(r.m.max) }}</text>
          <text v-else class="muted">无对应预测</text>
          <text v-if="r.m && r.m.score" class="cmp-sc">{{ r.m.score }}</text>
        </view>
        <view class="cmp-row">
          <text class="cmp-k">专家方案</text>
          <text v-if="r.e && r.e.dir" class="cmp-dir" :style="{ color: dirColor(r.e.dir) }">{{ dirZh(r.e.dir) }}</text>
          <text v-else class="muted">{{ r.p.unlocked ? '—' : '🔒 锁定' }}</text>
          <text v-if="r.e && r.e.score" class="cmp-sc">{{ r.e.score }}</text>
        </view>
        <view v-if="r.m && r.m.done" class="cmp-row res">
          <text class="cmp-k">实际结果</text>
          <text class="cmp-dir" style="color:#ffcf4a">{{ r.m.actual }} {{ dirZh(r.m.actualDir) }}</text>
          <view class="cmp-sc">
            <text>模型</text><text :class="r.m.modelHit ? 'ok' : 'no'">{{ r.m.modelHit ? '✓' : '✗' }}</text>
            <text v-if="r.expertHit != null">　专家</text><text v-if="r.expertHit != null" :class="r.expertHit ? 'ok' : 'no'">{{ r.expertHit ? '✓' : '✗' }}</text>
          </view>
        </view>
      </view>

      <view v-if="r.p.unlocked && r.p.recommends.length" class="wrapflex" style="margin-top:14rpx">
        <view v-for="(it, j) in firstItems(r.p)" :key="j" class="chip rec" style="margin-bottom:0"><text class="ci-name">{{ it.name }}</text><text class="ci-odds">{{ it.odds }}</text></view>
      </view>
    </view>

    <view class="disclaimer">"方向一致/分歧""命中✓✗"仅为本站模型与专家观点的机械对照，不代表谁更准。专家方案来自第三方平台（网易红彩），仅供参考，不代表本站立场。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getData, nm } from '@/common/api.js'
import { setTabBarIndex } from '@/common/tab-bar.js'
import { pct, dirZh, dirColor } from '@/common/format.js'
import { flag } from '@/common/flags.js'

onShow(() => setTabBarIndex(2))

// 从专家推荐里解析 1X2 方向(让球/胜平负的 主胜/客胜/平)与比分
function expertView(p) {
  let dir = null, score = ''
  for (const r of (p.recommends || [])) {
    if (!dir && /让球|胜平负|胜负/.test(r.play)) {
      for (const it of (r.items || [])) {
        const n = it.name || ''
        if (n.includes('客') || n === '负') { dir = 'A'; break }
        if (n.includes('主') || n === '胜') { dir = 'H'; break }
        if (n.includes('平')) { dir = 'D'; break }
      }
    }
    if (!score && /比分/.test(r.play) && r.items && r.items[0]) score = (r.items[0].name || '').replace(':', '-')
  }
  return (dir || score) ? { dir, score } : null
}

// 把方案与模型预测对齐(未开赛取 future，已完赛取 history 并带实际结果)
function enrich(p, fut, his) {
  const k = (p.home && p.away) ? p.home + '|' + p.away : null
  let m = null
  if (k && fut[k]) { const c = fut[k].C; m = { dir: c.dir, max: c.max, score: (c.score2 || [])[0] || '', done: false } }
  else if (k && his[k]) { const h = his[k]; m = { dir: h.dir, max: h.dirProb, score: h.score, done: true, actual: h.actual, actualDir: h.actualDir, modelHit: h.hit } }
  const e = expertView(p)
  const ag = (m && e && m.dir && e.dir) ? (m.dir === e.dir ? 'same' : 'diff') : null
  const expertHit = (m && m.done && e && e.dir && m.actualDir) ? (e.dir === m.actualDir) : null
  return { p, m, e, ag, expertHit }
}

const rows = ref([])
getData().then(d => {
  const fut = {}, his = {}
  for (const f of (d.dual.future || [])) fut[f.home + '|' + f.away] = f
  for (const h of (d.dual.history || [])) his[h.home + '|' + h.away] = h
  rows.value = (d.experts.plans || []).map(p => enrich(p, fut, his))
})

const stats = computed(() => {
  let same = 0, cmp = 0, done = 0, mHit = 0, eHit = 0, eCmp = 0
  for (const r of rows.value) {
    if (r.ag) { cmp++; if (r.ag === 'same') same++ }
    if (r.m && r.m.done) { done++; if (r.m.modelHit) mHit++; if (r.expertHit != null) { eCmp++; if (r.expertHit) eHit++ } }
  }
  return { same, cmp, done, mHit, eHit, eCmp }
})

// 未解析出英文队名时(home/away 为 null)直接回退红彩原始中文，避免显示 "xx vs null"
const matchName = (p) => {
  if (!p.home || !p.away) return p.matchZh || ''
  return (nm(p.home) !== p.home || nm(p.away) !== p.away) ? (nm(p.home) + ' vs ' + nm(p.away)) : p.matchZh
}
const firstItems = (p) => (p.recommends[0] && p.recommends[0].items) ? p.recommends[0].items.slice(0, 3) : []
const goDetail = (p) => uni.navigateTo({ url: '/pages/expert/detail?threadId=' + p.threadId })
</script>

<style scoped>
.s2 { display: block; margin-top: 8rpx; font-size: 23rpx; color: #8b93a1; }
.s2 .hl { color: #36c275; font-weight: 700; }
.title { display: block; font-size: 28rpx; font-weight: 600; margin: 18rpx 0 14rpx; line-height: 1.5; }
.cmp { margin-top: 16rpx; padding: 16rpx 18rpx; background: #14171f; border: 1rpx solid #232a36; border-radius: 16rpx; }
.cmp-head { display: flex; align-items: center; padding-bottom: 12rpx; border-bottom: 1rpx solid #20262f; }
.mn { font-size: 25rpx; font-weight: 600; margin: 0 8rpx; }
.tag { margin-left: auto; padding: 3rpx 14rpx; border-radius: 999rpx; font-size: 20rpx; font-weight: 700; }
.tag.same { background: rgba(54,194,117,.16); color: #36c275; }
.tag.diff { background: rgba(255,159,67,.16); color: #ff9f43; }
.cmp-row { display: flex; align-items: center; margin-top: 12rpx; }
.cmp-row.res { margin-top: 12rpx; padding-top: 12rpx; border-top: 1rpx solid #20262f; }
.cmp-k { width: 130rpx; font-size: 23rpx; color: #8b93a1; }
.cmp-dir { font-size: 26rpx; font-weight: 700; }
.cmp-sc { margin-left: auto; font-size: 24rpx; color: #c7ccd6; font-weight: 600; }
.cmp-sc .ok { color: #36c275; font-weight: 700; }
.cmp-sc .no { color: #ff6b6b; font-weight: 700; }
</style>
