'use strict';
const { assert } = require('./core.cjs');
function attachment(db, id, kind) {
  if (id == null || id === '') return null;
  assert(typeof id === 'string', 400, 'INVALID_INPUT', '媒体引用不合法');
  const row = db.prepare('SELECT * FROM media WHERE id=?').get(id);
  assert(row && row.detected_mime.startsWith(kind + '/'), 400, 'INVALID_INPUT', kind === 'audio' ? '请选择语音文件' : '请选择图片文件');
  return id;
}
module.exports = { attachment };
