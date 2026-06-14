'use strict';
// put-payload(HTTP 化瘦函数):本地 daily 跑完 → POST 全量 payload → 上传到【云存储】。
//   只做密钥校验 + 写文件,零计算。前端直接拉云存储 URL(CDN),不走函数/DB。
//   部署后需在 uniCloud 控制台:① 本函数「URL 化」拿到公网地址(给本地 daily 用);
//                              ② 设环境变量 PUT_SECRET(与本地 .env 一致)。
//   返回里的 url 即云存储公网地址 —— 复制到前端 common/api.js 的 REMOTE_URL。
const SECRET = process.env.PUT_SECRET || 'CHANGE_ME_SET_IN_CONSOLE';
const CLOUD_PATH = 'app-data/payload.json'; // 固定路径 → URL 稳定,覆盖即更新

const reply = (statusCode, obj) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
});

exports.main = async (event) => {
  // 兼容:URL 化(event.body 字符串/base64) 与 直接调用(event 即对象)
  let body = event;
  if (typeof event.body === 'string') {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      body = JSON.parse(raw);
    } catch (e) { return reply(400, { code: 1, msg: 'bad json' }); }
  }

  if (!body || body.secret !== SECRET) return reply(403, { code: 1, msg: 'forbidden' });
  const payload = body.payload;
  if (!payload || !payload.matches) return reply(400, { code: 1, msg: 'payload 缺 matches' });

  // 上传到云存储(同一 cloudPath 覆盖,URL 稳定)
  let res;
  try {
    res = await uniCloud.uploadFile({
      cloudPath: CLOUD_PATH,
      fileContent: Buffer.from(JSON.stringify(payload)),
    });
  } catch (e) { return reply(500, { code: 2, msg: '云存储上传失败: ' + e.message }); }

  // 取公网 URL:阿里云 fileID 即 https;腾讯云为 cloud:// 需换取临时/永久地址
  let url = res.fileID;
  if (/^cloud:\/\//.test(url)) {
    try { const t = await uniCloud.getTempFileURL({ fileList: [res.fileID] }); url = (t.fileList[0] || {}).tempFileURL || url; } catch (e) {}
  }

  return reply(200, {
    code: 0, fileID: res.fileID, url,
    matches: (payload.matches.matches || []).length,
  });
};
