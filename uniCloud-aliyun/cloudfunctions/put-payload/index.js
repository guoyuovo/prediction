'use strict';
// put-payload: 全量 payload → 云存储 app-data/payload.json（URL 稳定，覆盖即更新）。
//   · HTTP 化：本地 daily / CI POST，需带 secret（环境变量 PUT_SECRET）。
//   · callFunction：App 内「更新」按钮同步，同 uniCloud 空间内调用，不需密钥。
//   返回 url → 自动写入 wc_config；co-data / live-rec 读取，前端 REMOTE_URL 可留空。
const db = uniCloud.database();
const SECRET = process.env.PUT_SECRET || 'CHANGE_ME_SET_IN_CONSOLE';
const CLOUD_PATH = 'app-data/payload.json';
const CONFIG_ID = 'payload';

const reply = (statusCode, obj) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
});

/**
 * @param {boolean} isHttp
 * @param {number} status
 * @param {object} obj
 */
function finish(isHttp, status, obj) {
  return isHttp ? reply(status, obj) : obj;
}

exports.main = async (event) => {
  const isHttp = typeof event.body === 'string' || !!event.httpMethod;
  let body = event;
  if (typeof event.body === 'string') {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      body = JSON.parse(raw);
    } catch (e) { return finish(isHttp, 400, { code: 1, msg: 'bad json' }); }
  }

  // HTTP 外部 POST 必须校验密钥；App 内 callFunction 信任同空间调用
  if (isHttp && (!body || body.secret !== SECRET)) {
    return finish(isHttp, 403, { code: 1, msg: 'forbidden' });
  }

  const payload = body.payload;
  if (!payload || !payload.matches) {
    return finish(isHttp, 400, { code: 1, msg: 'payload 缺 matches' });
  }

  let res;
  try {
    res = await uniCloud.uploadFile({
      cloudPath: CLOUD_PATH,
      fileContent: Buffer.from(JSON.stringify(payload)),
    });
  } catch (e) {
    return finish(isHttp, 500, { code: 2, msg: '云存储上传失败: ' + e.message });
  }

  let url = res.fileID;
  if (/^cloud:\/\//.test(url)) {
    try {
      const t = await uniCloud.getTempFileURL({ fileList: [res.fileID] });
      url = (t.fileList[0] || {}).tempFileURL || url;
    } catch (e) {}
  }

  // 写入 wc_config，供 co-data / live-rec 自动读取（免手填 REMOTE_URL）
  try {
    await db.collection('wc_config').doc(CONFIG_ID).set({
      url, fileID: res.fileID,
      updatedAt: Date.now(),
      matches: (payload.matches.matches || []).length,
    });
  } catch (e) { /* 集合未建时忽略，co-data 会回退打包数据 */ }

  return finish(isHttp, 200, {
    code: 0, fileID: res.fileID, url,
    matches: (payload.matches.matches || []).length,
  });
};
