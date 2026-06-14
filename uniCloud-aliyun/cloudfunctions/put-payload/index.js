'use strict';
// put-payload(HTTP 化瘦函数):本地 daily 跑完 → POST 全量 payload → 写 wc_payload。
//   只做密钥校验 + 写库,零计算。co-data 已 orderBy updatedAt desc 读最新。
//   部署后需在 uniCloud 控制台：① 本函数「URL 化」拿到公网地址；
//                              ② 设环境变量 PUT_SECRET（与本地 .env 一致）。
const db = uniCloud.database();
const SECRET = process.env.PUT_SECRET || 'CHANGE_ME_SET_IN_CONSOLE';

const reply = (statusCode, obj) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj),
});

exports.main = async (event) => {
  // 兼容：URL 化(event.body 为字符串/base64) 与 直接调用(event 即对象)
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

  const col = db.collection('wc_payload');
  const updatedAt = Date.now();
  await col.add({ updatedAt, payload });
  // 只留最新一条，清掉更旧的（量小，避免无限增长）
  try { await col.where({ updatedAt: db.command.lt(updatedAt) }).remove(); } catch (e) {}

  return reply(200, {
    code: 0, updatedAt,
    matches: (payload.matches.matches || []).length,
  });
};
