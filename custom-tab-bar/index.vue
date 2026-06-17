<template>
  <view class="tab-bar">
    <view
      v-for="(item, index) in list"
      :key="item.pagePath"
      class="tab-item"
      :class="{ on: selected === index }"
      @click="onSwitch(index)"
    >
      <text class="tab-text">{{ item.text }}</text>
    </view>
  </view>
</template>

<script>
/** 自定义底部 tabBar（字号可配，替代原生 tabBar） */
export default {
  data() {
    return {
      selected: 0,
      list: [
        { pagePath: '/pages/events/index', text: '赛事' },
        { pagePath: '/pages/jingcai/index', text: '荐彩' },
        { pagePath: '/pages/expert/index', text: '专家' },
        { pagePath: '/pages/backtest/index', text: '回测' },
        { pagePath: '/pages/about/index', text: '关于' },
      ],
    }
  },
  methods: {
    /** @param {number} index */
    onSwitch(index) {
      if (index === this.selected) return
      this.selected = index
      uni.switchTab({ url: this.list[index].pagePath })
    },
  },
}
</script>

<style scoped>
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 999;
  display: flex;
  height: calc(124rpx + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: #181b22;
  border-top: 1rpx solid #252b38;
}
.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16rpx 0 10rpx;
}
.tab-text {
  font-size: 40rpx;
  color: #8b93a1;
  font-weight: 600;
  line-height: 1.2;
}
.tab-item.on .tab-text {
  color: #4ea1ff;
  font-weight: 700;
}
</style>
