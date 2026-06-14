// 可注入的数据注册表（浏览器安全，替代 src/util.mjs 的 fs.readFileSync）。
//
// 设计要点（解决「顶层 const + 刷新重算」问题）：
//   - src 各模块在【模块顶层】用 loadJson('data/x.json') 读数据并存入 const。
//   - 浏览器里没有 fs，且刷新/重算需要用【新数据】，不能依赖模块顶层的陈旧缓存。
//   - 故所有移植模块改为【调用时】通过 getData(path)/loadJson(path) 从本注册表取数。
//     只要在每次 computePredictions() 开头 setData(...) 注入最新数据，重算即用新数据。
//
// 用法：
//   setData({ 'data/teams.json': {...}, 'config/model.json': {...}, ... })
//   const teams = loadJson('data/teams.json').teams;   // 从注册表取，缺失则抛错

let REGISTRY = Object.create(null);

/**
 * 注入数据。键为相对路径（与 src 中 loadJson 的入参一致，如 'data/teams.json'），值为已解析对象。
 * 每次调用整表替换，避免上一次重算的陈旧数据残留（刷新正确性的关键）。
 * @param {Record<string, any>} map
 */
export function setData(map) {
  REGISTRY = Object.create(null);
  if (map) for (const k of Object.keys(map)) REGISTRY[k] = map[k];
}

/** 合并注入（不清空已有项），用于按需补充可选数据。 */
export function mergeData(map) {
  if (map) for (const k of Object.keys(map)) REGISTRY[k] = map[k];
}

/** 是否已注入某路径。 */
export function hasData(relPath) {
  return Object.prototype.hasOwnProperty.call(REGISTRY, relPath);
}

/** 取已注入对象；缺失返回 undefined（供可选数据 try/catch 等价路径使用）。 */
export function getData(relPath) {
  return REGISTRY[relPath];
}

/**
 * loadJson 兼容层：与 src/util.mjs 的 loadJson(relPath) 同签名，但从注册表取数。
 * 缺失时抛错（与 fs 版「文件不存在抛错」行为一致），可选数据请用 try/catch 或 hasData。
 */
export function loadJson(relPath) {
  if (!Object.prototype.hasOwnProperty.call(REGISTRY, relPath)) {
    throw new Error(`loadJson: 未注入数据 "${relPath}"（请先 setData）`);
  }
  return REGISTRY[relPath];
}

/** 清空注册表（测试用）。 */
export function clearData() {
  REGISTRY = Object.create(null);
}
