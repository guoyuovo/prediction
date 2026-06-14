// 队名中文映射
import { loadJson } from './util.mjs';

const ZH = loadJson('data/team-names-zh.json').names;

export function zh(name) {
  return ZH[name] || name;
}

// "西班牙 (Spain)" 形式
export function zhFull(name) {
  const c = ZH[name];
  return c ? `${c}` : name;
}
