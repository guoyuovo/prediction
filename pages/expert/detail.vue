<template>
  <view class="wrap" v-if="p">
    <!-- 专家卡 -->
    <view class="card">
      <view class="row">
        <image v-if="p.expert.avatar" :src="p.expert.avatar" class="avatar lg" mode="aspectFill" />
        <view style="flex:1;margin-left:20rpx">
          <view class="row"><text class="strong" style="font-size:34rpx">{{ p.expert.name }}</text><text class="pill" style="margin-left:14rpx">{{ p.expert.slogan }}</text></view>
          <text class="small" style="margin-top:6rpx">{{ p.expert.desc || (p.publishTime) }}</text>
        </view>
      </view>
      <view class="row stats" v-if="p.expert.hitRate != null">
        <view class="stat"><text class="v gold">{{ Math.round((p.expert.hitRate || 0) * 100) }}%</text><text class="l">命中率</text></view>
        <view class="stat">
          <view class="recent"><text v-for="(t, i) in recentTokens" :key="i" :class="t.num ? 'rn' : 'rt'">{{ t.s }}</text></view>
        </view>
        <view class="stat"><text class="v">{{ p.expert.follower ?? '—' }}</text><text class="l">粉丝</text></view>
        <view class="stat"><text class="v">{{ p.expert.maxWin ?? '—' }}</text><text class="l">最高连红</text></view>
      </view>
    </view>

    <!-- 对阵 -->
    <view class="card">
      <view class="vs">
        <view class="team"><image :src="p.homeIcon || flag(p.home)" class="flag-lg" mode="aspectFill" /><text class="tn">{{ homeZh }}</text></view>
        <view class="mid"><text class="tiny">{{ p.jcNum || p.matchTime }}</text><text class="vsx">VS</text></view>
        <view class="team r"><text class="tn">{{ awayZh }}</text><image :src="p.awayIcon || flag(p.away)" class="flag-lg" mode="aspectFill" /></view>
      </view>
      <view class="between" style="margin-top:8rpx">
        <text class="pill">{{ p.type }}</text>
        <text class="small">{{ p.publishTime }}</text>
      </view>
    </view>

    <!-- 标题 -->
    <view class="card"><text class="title">{{ p.title }}</text></view>

    <!-- 红彩全盘口(全部选项 + 专家选中高亮) -->
    <view class="card" v-if="p.unlocked && p.recommends.length">
      <view class="sec-h">盘口与推荐 <text class="sec-sub">绿色=专家选中</text></view>
      <view v-for="(r, i) in p.recommends" :key="i" class="mkt">
        <text class="small" style="display:block;margin-bottom:10rpx">{{ r.play }}</text>
        <view class="wrapflex">
          <view v-for="(it, j) in r.items" :key="j" class="chip" :class="{ rec: it.rec }"><text class="ci-name">{{ it.name }}</text><text class="ci-odds">{{ it.odds }}</text></view>
        </view>
      </view>
    </view>

    <!-- 正文 -->
    <view class="card" v-if="p.unlocked && p.content">
      <view class="sec-h">方案分析</view>
      <rich-text :nodes="styledContent" class="rt"></rich-text>
    </view>

    <!-- 锁定提示 -->
    <view class="card" v-if="!p.unlocked">
      <view class="sec-h">完整方案</view>
      <text class="small">该方案正文与推荐由网易红彩提供，需在其平台查看。</text>
      <view class="btn" style="margin-top:18rpx" @click="openLink">前往网易红彩查看 ›</view>
    </view>

    <!-- 近期走势 -->
    <view class="card" v-if="p.unlocked && p.recentForm.length">
      <view class="sec-h">{{ homeZh }} 近期走势</view>
      <view v-for="(f, i) in p.recentForm" :key="i" class="between lrow">
        <text class="small" style="width:120rpx">{{ f.date }}</text>
        <text style="flex:1;text-align:center">{{ f.home }} <text class="gold strong">{{ f.hs }}-{{ f.as }}</text> {{ f.away }}</text>
        <text class="tiny" style="width:120rpx;text-align:right">半{{ f.half }}</text>
      </view>
    </view>

    <!-- 模型对照 -->
    <view class="card" v-if="dm">
      <view class="sec-h">本站模型对照 <text class="sec-sub">独立参考</text></view>
      <triple-bar :p="[dm.A.p.h, dm.A.p.d, dm.A.p.a]" />
      <view class="between" style="margin-top:14rpx">
        <text :style="{ color: dirColor(dm.C.dir), fontWeight: 700 }">综合 {{ dirZh(dm.C.dir) }} {{ pct(dm.C.max) }}</text>
        <text class="gold">比分 {{ dm.C.score2.join(' / ') }}</text>
      </view>
      <text class="small" style="margin-top:10rpx;display:block">多因子 {{ dirZh(dm.A.dir) }} · xG {{ dirZh(dm.B.dir) }}<text v-if="!dm.agree" class="red"> · 双模型分歧</text></text>
    </view>

    <view class="disclaimer">本方案来自第三方平台（网易红彩），观点仅供参考，不代表本站立场，本站不提供购买/代购。理性购彩，量力而行，未满 18 周岁禁止参与。</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getData, nm } from '@/common/api.js'
import { pct, dirZh, dirColor } from '@/common/format.js'
import { flag } from '@/common/flags.js'
import tripleBar from '@/components/triple-bar.vue'

const p = ref(null), dm = ref(null)
onLoad((q) => {
  getData().then(d => {
    const plan = (d.experts.plans || []).find(x => String(x.threadId) === String(q.threadId))
    p.value = plan
    if (plan && plan.home && plan.away) dm.value = (d.dual.future || []).find(x => x.home === plan.home && x.away === plan.away)
  })
})
const homeZh = computed(() => p.value ? (nm(p.value.home) !== p.value.home ? nm(p.value.home) : p.value.matchZh.split(' vs ')[0]) : '')
const awayZh = computed(() => p.value ? (nm(p.value.away) !== p.value.away ? nm(p.value.away) : p.value.matchZh.split(' vs ')[1]) : '')

// 近况"近2场中2场"→ 分词:数字醒目、文字小
const recentTokens = computed(() => {
  const s = p.value?.expert?.recent || '—'
  return s.split(/(\d+)/).filter((x) => x !== '').map((x) => ({ s: x, num: /^\d+$/.test(x) }))
})

const styledContent = computed(() => p.value ? `<div style="color:#cfd4e0;font-size:28rpx;line-height:1.8">${p.value.content}</div>` : '')
const openLink = () => {
  // #ifdef H5
  window.open(p.value.link)
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: p.value.link, success: () => uni.showToast({ title: '链接已复制', icon: 'none' }) })
  // #endif
}
</script>

<style scoped>
.avatar.lg { width: 110rpx; height: 110rpx; }
.stats { margin-top: 24rpx; padding-top: 24rpx; border-top: 1rpx solid #20262f; }
.vs { display: flex; align-items: center; }
.team { flex: 1; display: flex; align-items: center; }
.team.r { justify-content: flex-end; }
.team .tn { font-size: 30rpx; font-weight: 700; margin: 0 14rpx; }
.mid { text-align: center; padding: 0 14rpx; }
.mid .vsx { display: block; font-size: 30rpx; font-weight: 800; color: #7c8597; margin-top: 4rpx; }
.title { font-size: 32rpx; font-weight: 700; line-height: 1.5; }
.rt { display: block; }
.recent { display: flex; align-items: baseline; justify-content: center; line-height: 1; }
.recent .rt { font-size: 22rpx; color: #8b93a1; }
.recent .rn { font-size: 36rpx; font-weight: 800; color: #ffcf4a; margin: 0 3rpx; }
.mkt { margin-bottom: 22rpx; }
.mkt:last-child { margin-bottom: 0; }
.mkt-h { margin-bottom: 12rpx; }
</style>
