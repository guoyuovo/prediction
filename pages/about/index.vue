<template>
  <view class="wrap">
    <view class="hero"><text class="t">关于</text><text class="s">方法论 · 指标 · 数据源 · 诚实声明</text></view>

    <view class="card">
      <view class="sec-h">模型说明</view>
      <view class="p"><text class="accent strong">① 多因子（主力·v2）</text>　去水位市场赔率共识(0.35) + Elo/主场/FIFA/状态/身价/阵容 特征加权；Elo 随每场完赛滚动更新，比分用 Dixon-Coles。</view>
      <view class="p"><text class="accent strong">② xG（第二验证）</text>　Elo 0.30 + 泊松 xG 0.70，不含赔率；攻防评分随完赛 shot-based xG 滚动更新。与主力方法论独立。</view>
      <view class="p"><text class="accent strong">综合推荐</text>　= 0.5·多因子 + 0.5·xG（时间切分网格搜索验证）。方向一致→置信更高；分歧→标 ⚠。</view>
      <view class="p"><text class="accent strong">情境修正（本届特有）</text>　⛰海拔（墨西哥城2254m/瓜达拉哈拉1607m，高原略增进球+适应队edge）、💤休息/旅行疲劳——物理先验型小修正，未经回测，幅度刻意小。</view>
    </view>

    <view class="card">
      <view class="sec-h">指标说明</view>
      <view class="p">置信度：综合最高概率 ≥55%高 / 45–55%中 / &lt;45%低；分歧时降级。</view>
      <view class="p">爆冷：决断力低（最高概率偏低），弱队取胜或平局概率不低。</view>
      <view class="p">xG Tn：xG 模型方向与胜方概率档位 T1≥40%/T2≥30%/T3≥20%。</view>
      <view class="p">⚠分歧：两个独立模型方向不一致，不确定性高。</view>
    </view>

    <view class="card">
      <view class="sec-h">数据来源</view>
      <view class="p small">官方 Elo(eloratings.net) · FIFA(api.fifa.com) · 多庄赔率(Titan007/ESPN/Bovada) · 天气/海拔(Open-Meteo) · 完赛比分+射门(ESPN) · 专家方案(网易红彩) · 体彩竞彩(中国体育彩票，云端接入中)。</view>
      <view class="p small">最后更新：{{ meta.lastUpdate ? meta.lastUpdate.slice(0, 16).replace('T', ' ') : meta.date }}</view>
    </view>

    <view class="card">
      <view class="sec-h"><text class="red">诚实声明</text></view>
      <view class="p small">回测显示本模型对市场无稳定盈利优势（ROI 为负）；定位是"透明预测 + 战绩可查"，不承诺胜率。海拔/疲劳/伤停为先验型修正，未经样本外验证。</view>
    </view>

    <view class="disclaimer">所有预测均为统计模型推演，仅供学术研究与娱乐参考，非投注建议。荐彩/专家方案：竞彩数据来自中国体育彩票官方，专家方案来自第三方(网易红彩)、观点仅供参考不代表本站；理性购彩、量力而行、未满 18 周岁禁止参与；不承诺中奖、不诱导投注、不代购。</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { load } from '@/common/api.js'
import { setTabBarIndex } from '@/common/tab-bar.js'

onShow(() => setTabBarIndex(4))
const meta = ref({})
load('meta').then(d => meta.value = d)
</script>

<style scoped>
.p { margin-bottom: 16rpx; line-height: 1.75; }
</style>
