<script>
export default {
  onLaunch: function() { console.log('App Launch') },
  onShow: function() {},
  onHide: function() {}
}
</script>

<style>
/* ============ 全局 Pro 暗色设计系统 ============ */
page {
  background: #0b0d12;
  color: #e8eaf0;
  font-size: 28rpx;
  line-height: 1.55;
  overflow-x: hidden;
  font-family: -apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
view, scroll-view, text, image { box-sizing: border-box; }
/* H5：内置 tabBar 已通过 uni-placeholder 给 tab 页预留底部高度，详情页无 tabBar，故 .wrap 只保留常规底部间距，避免双重留白 */
.wrap { width: 100%; max-width: 100%; padding: 24rpx 28rpx 40rpx; }
/* 非 H5：custom-tab-bar 为 fixed 覆盖层、不占位，tab 页需手动留出其高度 */
/* #ifndef H5 */
.wrap { padding-bottom: calc(128rpx + env(safe-area-inset-bottom)); }
/* #endif */

/* 文本 */
.muted { color: #7c8597; }
.small { font-size: 23rpx; color: #7c8597; }
.tiny { font-size: 20rpx; color: #6b7385; }
.strong { font-weight: 700; }
.gold { color: #ffcf4a; } .green { color: #2fd07b; } .red { color: #ff6470; }
.amber { color: #ffc23d; } .accent { color: #5aa9ff; }

/* 卡片 */
.card {
  background: linear-gradient(180deg, #181c25 0%, #14171f 100%);
  border: 1rpx solid #252b38;
  border-radius: 24rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 8rpx 32rpx rgba(0,0,0,.28);
}
.card-tap { transition: transform .08s; }
.card-tap:active { transform: scale(.985); }

/* 区块标题（左侧强调条） */
.sec-h { display: flex; align-items: center; font-size: 30rpx; font-weight: 700; margin-bottom: 22rpx; }
.sec-h::before { content: ''; width: 8rpx; height: 30rpx; background: linear-gradient(#5aa9ff,#2fd07b); border-radius: 4rpx; margin-right: 16rpx; }
.sec-sub { font-size: 22rpx; color: #7c8597; font-weight: 400; margin-left: 12rpx; }

/* 行布局 */
.row { display: flex; align-items: center; }
.between { display: flex; align-items: center; justify-content: space-between; }
.col { display: flex; flex-direction: column; }
.wrapflex { display: flex; flex-wrap: wrap; align-items: center; }
.gap8 > view, .gap8 > text { margin-right: 12rpx; }

/* 分段控制（pill tabs，吸顶） */
.seg {
  display: flex; gap: 8rpx; padding: 8rpx;
  background: #14171f; border: 1rpx solid #252b38; border-radius: 20rpx;
  margin-bottom: 24rpx; position: sticky; top: 0; z-index: 9;
}
.seg-item { flex: 1; text-align: center; padding: 16rpx 0; border-radius: 14rpx; color: #7c8597; font-size: 26rpx; }
.seg-item.on { background: linear-gradient(135deg,#5aa9ff,#3d7fd6); color: #fff; font-weight: 700; box-shadow: 0 4rpx 16rpx rgba(90,169,255,.35); }

/* 药丸 / 标签 */
.pill { padding: 4rpx 16rpx; border-radius: 999rpx; font-size: 21rpx; background: #1f2530; color: #9aa3b4; }
.pill-line { padding: 3rpx 14rpx; border-radius: 999rpx; font-size: 20rpx; border: 1rpx solid #303747; color: #9aa3b4; }
.dot { width: 12rpx; height: 12rpx; border-radius: 50%; margin-right: 10rpx; }

/* 赔率/选项 chip */
.chip { display: inline-flex; align-items: center; padding: 10rpx 20rpx; border-radius: 14rpx; margin: 0 14rpx 14rpx 0; background: #1c2330; border: 1rpx solid #2c3445; }
.chip .ci-name { color: #e8eaf0; font-weight: 600; font-size: 25rpx; }
.chip .ci-odds { color: #ffcf4a; font-weight: 700; margin-left: 12rpx; font-size: 25rpx; }
.chip.rec { background: linear-gradient(135deg, rgba(47,208,123,.16), rgba(47,208,123,.06)); border-color: rgba(47,208,123,.4); }

/* 统计小块 */
.stat { flex: 1; text-align: center; }
.stat .v { font-size: 34rpx; font-weight: 800; }
.stat .l { font-size: 21rpx; color: #7c8597; margin-top: 4rpx; }

/* 列表行 */
.lrow { padding: 20rpx 0; border-bottom: 1rpx solid #20262f; }
.lrow:last-child { border-bottom: none; }

/* 头像/队徽 */
.avatar { width: 80rpx; height: 80rpx; border-radius: 50%; background: #1f2530; }
.flag { width: 44rpx; height: 30rpx; border-radius: 4rpx; background: #1f2530; }
.flag-lg { width: 60rpx; height: 42rpx; border-radius: 6rpx; background: #1f2530; }

/* 分割线 */
.hr { height: 1rpx; background: #20262f; margin: 22rpx 0; }

/* 按钮 */
.btn { background: linear-gradient(135deg,#5aa9ff,#3d7fd6); color: #fff; font-size: 28rpx; font-weight: 600; border-radius: 16rpx; padding: 22rpx 0; text-align: center; }
.btn-ghost { background: #1c2330; color: #9aa3b4; border: 1rpx solid #2c3445; border-radius: 16rpx; padding: 18rpx 0; text-align: center; font-size: 26rpx; }

/* 免责 */
.disclaimer { color: #5b6171; font-size: 21rpx; line-height: 1.7; margin-top: 24rpx; padding: 20rpx; background: #101319; border: 1rpx solid #20262f; border-radius: 16rpx; }

/* 顶栏 hero */
.hero { padding: 8rpx 4rpx 24rpx; }
.hero .t { font-size: 40rpx; font-weight: 800; letter-spacing: .5rpx; }
.hero .s { font-size: 23rpx; color: #7c8597; margin-top: 6rpx; }
.hero .between { gap: 16rpx; }
.hero .pill { flex-shrink: 0; white-space: nowrap; }
.between { min-width: 0; }

/* H5 底部 tabBar 字号放大：H5 渲染的是 uni-app 内置 tabBar(custom-tab-bar 组件在 H5 不注入),
   其文字默认仅 10px,故全局覆盖 .uni-tabbar__label。!important 压过框架内置样式。 */
/* #ifdef H5 */
.uni-tabbar__label { font-size: 16px !important; line-height: 1.3 !important; }
.uni-tabbar__item.uni-tabbar__item--active .uni-tabbar__label { font-weight: 700; }
.uni-tabbar { height: 58px !important; }
/* #endif */
</style>
