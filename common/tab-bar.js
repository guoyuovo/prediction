/**
 * 同步自定义 tabBar 选中项（各 tab 页 onShow 调用）。
 * @param {number} index 0=赛事 1=荐彩 2=专家 3=回测 4=关于
 */
export function setTabBarIndex(index) {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (page && typeof page.getTabBar === 'function') {
    const tabBar = page.getTabBar()
    if (tabBar) tabBar.setData({ selected: index })
  }
}
