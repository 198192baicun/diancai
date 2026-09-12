'use strict';

const {
  appError,
  assert,
  cleanText,
  randomId,
  shanghaiToday,
  isDate,
  pageFromArray,
  exactObject,
  requestHash,
  utcNow,
} = require('./core.cjs');
const {
  transaction,
  requireReadContext,
  requireWriteContext,
  requireMember,
  getMeta,
} = require('./db.cjs');
const { attachment } = require('./attachments.cjs');
const { dishAvailable } = require('./catalog.cjs');
const { menuItemDto, reviewDto, menuDaySummary, historySummary } = require('./dto.cjs');

function menuItemRow(db, id) {
  const row = db.prepare('SELECT * FROM menu_item WHERE id=?').get(id);
  if (!row) throw appError(404, 'NOT_FOUND', '菜单事项不存在');
  return row;
}

function listMenu(db, headers, query) {
  requireReadContext(db, headers, { active: false });
  const date = String(query.date || '');
  assert(isDate(date), 400, 'INVALID_INPUT', 'date 必须是合法 YYYY-MM-DD');
  const status = query.status || null;
  if (status) assert(['pending', 'cooking', 'completed', 'cancelled'].includes(status), 400, 'INVALID_INPUT', 'status 不合法');
  const view = query.view || 'all';
  assert(['all', 'archive'].includes(view), 400, 'INVALID_INPUT', 'view 不合法');
  if (view === 'archive' && status) assert(['completed', 'cancelled'].includes(status), 400, 'INVALID_INPUT', '归档只包含已完成和已取消事项');
  const where = view === 'archive'
    ? `AND status IN('completed','cancelled') ${status ? 'AND status=?' : ''}`
    : (status ? 'AND status=?' : '');
  const rows = db.prepare(`SELECT * FROM menu_item WHERE menu_date=? ${where} ORDER BY created_at ASC, id ASC`)
    .all(...(status ? [date, status] : [date]));
  const dtos = rows.map((row) => menuItemDto(db, row, headers.memberId));
  const page = pageFromArray(dtos, {
    limit: query.limit,
    cursor: query.cursor || null,
    filter: { route: 'menu', memberId: headers.memberId, date, status: status || 'all', view },
    key: (item) => [item.createdAt, item.id],
  });
  if (view === 'archive') {
    const archive = historySummary(db, date);
    return { ...page, summary: {
      date,
      counts: { pending: 0, cooking: 0, completed: archive.completedCount, cancelled: archive.itemCount - archive.completedCount },
      effectiveCount: archive.completedCount,
      progress: archive.completedCount ? 1 : null,
      rating: archive.rating,
    } };
  }
  return { ...page, summary: menuDaySummary(db, date) };
}

function unfinished(db, headers, query, clock) {
  requireReadContext(db, headers, { active: false });
  const today = shanghaiToday(clock);
  const rows = db.prepare(`SELECT * FROM menu_item
                           WHERE menu_date<? AND status IN('pending','cooking')
                           ORDER BY menu_date ASC, created_at ASC, id ASC`).all(today);
  const dtos = rows.map((row) => menuItemDto(db, row, headers.memberId));
  return pageFromArray(dtos, {
    limit: query.limit,
    cursor: query.cursor || null,
    filter: { route: 'unfinished', memberId: headers.memberId, before: today },
    key: (item) => [item.menuDate, item.createdAt, item.id],
  });
}

function getMenuItem(db, headers, id) {
  requireReadContext(db, headers, { active: false });
  return menuItemDto(db, menuItemRow(db, id), headers.memberId);
}

function appendMenuItem(db, actor, dishId, targetDate, note, source = {}, clock) {
  const dish = db.prepare(`SELECT d.*, c.name AS category_name FROM dish d JOIN category c ON c.id=d.category_id WHERE d.id=?`).get(dishId);
  if (!dish || !dish.active || !db.prepare('SELECT active FROM category WHERE id=?').get(dish.category_id)?.active) {
    throw appError(422, 'DISH_UNAVAILABLE', '菜品目前不可点');
  }
  const id = randomId('item');
  const now = utcNow(clock);
  db.prepare(`INSERT INTO menu_item(
    id,menu_date,dish_id,dish_name,category_name,cover_media_id,
    ordered_by,ordered_name,note,status,cook_id,cook_name,claimed_at,completed_at,
    cancelled_by,cancelled_name,cancelled_at,cancel_reason,source_vote_id,source_item_id,
    revision,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'',?,?,1,?,?)`)
    .run(id, targetDate, dish.id, dish.name, dish.category_name, dish.cover_media_id,
      actor.id, actor.name, note, source.voteId || null, source.itemId || null, now, now);
  return id;
}

function batchSubmit(db, headers, idempotencyKey, body, clock) {
  assert(typeof idempotencyKey === 'string' && idempotencyKey.length >= 8 && idempotencyKey.length <= 200, 400, 'INVALID_INPUT', '缺少或非法幂等 Key');
  exactObject(body, ['targetDate', 'items']);
  const targetDate = String(body.targetDate || '');
  assert(isDate(targetDate), 400, 'INVALID_INPUT', 'targetDate 必须是合法日期');
  assert(Array.isArray(body.items) && body.items.length >= 1 && body.items.length <= 50, 400, 'INVALID_INPUT', '一次请选择 1—50 条菜品');
  const items = body.items.map((item, index) => {
    exactObject(item, ['dishId', 'note', 'sourceItemId', 'noteVoiceMediaId']);
    assert(typeof item.dishId === 'string' && item.dishId, 400, 'INVALID_INPUT', `第 ${index + 1} 条 dishId 不合法`);
    const note = cleanText(item.note, 200, false, `第 ${index + 1} 条备注`);
    const sourceItemId = item.sourceItemId == null || item.sourceItemId === '' ? null : String(item.sourceItemId);
    return { dishId: item.dishId, note, sourceItemId, ...(item.noteVoiceMediaId ? {noteVoiceMediaId: item.noteVoiceMediaId} : {}) };
  });
  const semanticBody = { targetDate, items };
  const hash = requestHash('POST', '/api/menu/batches', targetDate, semanticBody);

  return transaction(db, () => {
    // 实例和数据代次在重放前也必须正确；成员活跃检查在成功回执之后。
    const meta = getMeta(db);
    if (!meta) throw appError(409, 'NOT_INITIALIZED', '家庭服务尚未初始化');
    if (headers.instanceId !== meta.instance_id) throw appError(409, 'INSTANCE_CHANGED', '家庭服务实例已变化，请重新连接', { currentInstanceId: meta.instance_id });
    if (headers.dataEpoch !== meta.data_epoch) throw appError(409, 'DATA_EPOCH_CHANGED', '家庭数据已重新载入，请核对菜单后重新选择', { currentDataEpoch: meta.data_epoch });
    const member = requireMember(db, headers.memberId, { active: false });
    const receiptRow = db.prepare(`SELECT response_json, request_hash FROM submission_receipt
                                   WHERE data_epoch=? AND member_id=? AND operation='menu.batch' AND idempotency_key=?`)
      .get(meta.data_epoch, member.id, idempotencyKey);
    if (receiptRow) {
      if (receiptRow.request_hash !== hash) throw appError(409, 'IDEMPOTENCY_MISMATCH', '此提交凭据不能用于不同的点菜内容');
      return JSON.parse(receiptRow.response_json);
    }
    if (!member.active) throw appError(403, 'MEMBER_INACTIVE', '当前成员已停用，请重新选择');
    const today = shanghaiToday(clock);
    if (targetDate !== today) throw appError(409, 'DATE_CHANGED', `家庭当前日期为 ${today}，请确认新的点菜日期`, { today });

    const invalidItems = [];
    items.forEach((item, index) => {
      if (!dishAvailable(db, item.dishId)) {
        invalidItems.push({ index, dishId: item.dishId, reason: 'DISH_UNAVAILABLE' });
        return;
      }
      if (item.sourceItemId) {
        const source = db.prepare('SELECT dish_id FROM menu_item WHERE id=?').get(item.sourceItemId);
        if (!source || source.dish_id !== item.dishId) invalidItems.push({ index, dishId: item.dishId, reason: 'INVALID_SOURCE_ITEM' });
      }
    });
    if (invalidItems.length) throw appError(422, 'DISH_UNAVAILABLE', '批次中存在不可点或来源不匹配的菜品', { invalidItems });

    const ids = items.map((item) => { const voice = attachment(db,item.noteVoiceMediaId,'audio'); const id = appendMenuItem(db, member, item.dishId, targetDate, item.note, { itemId: item.sourceItemId }, clock); if(voice) db.prepare('UPDATE menu_item SET note_voice_media_id=? WHERE id=?').run(voice,id); return id; });
    const receipt = { idempotencyKey, targetDate, menuItemIds: ids, submittedAt: utcNow(clock) };
    db.prepare(`INSERT INTO submission_receipt(data_epoch,member_id,operation,idempotency_key,request_hash,response_json,created_at)
                VALUES(?,?,'menu.batch',?,?,?,?)`)
      .run(meta.data_epoch, member.id, idempotencyKey, hash, JSON.stringify(receipt), receipt.submittedAt);
    return receipt;
  });
}

function getReceipt(db, headers, key) {
  const meta = getMeta(db);
  if (!meta) throw appError(409, 'NOT_INITIALIZED', '家庭服务尚未初始化');
  if (headers.instanceId !== meta.instance_id) throw appError(409, 'INSTANCE_CHANGED', '家庭服务实例已变化，请重新连接');
  if (headers.dataEpoch !== meta.data_epoch) throw appError(409, 'DATA_EPOCH_CHANGED', '家庭数据已重新载入，请核对菜单后重新选择');
  const member = requireMember(db, headers.memberId, { active: false });
  const row = db.prepare(`SELECT response_json FROM submission_receipt
                          WHERE data_epoch=? AND member_id=? AND operation='menu.batch' AND idempotency_key=?`)
    .get(meta.data_epoch, member.id, key);
  if (!row) throw appError(404, 'RECEIPT_NOT_FOUND', '尚未找到这个提交凭据的成功回执');
  return JSON.parse(row.response_json);
}

function mutateMenuItem(db, headers, id, body, action, clock) {
  const bodyKeys = action === 'note' ? ['note', 'expectedRevision'] : action === 'cancel' ? ['expectedRevision', 'reason'] : ['expectedRevision'];
  exactObject(body, [...bodyKeys, ...(['note','claim','complete'].includes(action) ? ['voiceMediaId'] : []), ...(action==='complete' ? ['photoMediaIds','completionNote'] : [])]);
  const expectedRevision = Number(body.expectedRevision);
  assert(Number.isInteger(expectedRevision) && expectedRevision >= 1, 400, 'INVALID_INPUT', 'expectedRevision 不合法');

  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const row = menuItemRow(db, id);
    if (Number(row.revision) !== expectedRevision) throw appError(409, 'STATE_CONFLICT', '这条事项已经发生变化', { latest: menuItemDto(db, row, member.id) });
    const now = utcNow(clock);
    if (action === 'note') {
      const note = cleanText(body.note, 200, false, '备注');
      if (row.status !== 'pending' || row.ordered_by !== member.id) throw appError(403, 'FORBIDDEN', '只有点菜人可以编辑自己的待做备注', { latest: menuItemDto(db, row, member.id) });
      db.prepare('UPDATE menu_item SET note=?,revision=revision+1,updated_at=? WHERE id=?').run(note, now, id);
    } else if (action === 'claim') {
      if (row.status !== 'pending') throw appError(409, 'STATE_CONFLICT', '这道菜已被处理', { latest: menuItemDto(db, row, member.id) });
      db.prepare(`UPDATE menu_item SET status='cooking',cook_id=?,cook_name=?,claimed_at=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(member.id, member.name, now, now, id);
    } else if (action === 'unclaim') {
      if (row.status !== 'cooking' || row.cook_id !== member.id) throw appError(403, 'FORBIDDEN', '只有当前做菜人可以取消认领', { latest: menuItemDto(db, row, member.id) });
      db.prepare(`UPDATE menu_item SET status='pending',cook_id=NULL,cook_name=NULL,claimed_at=NULL,revision=revision+1,updated_at=? WHERE id=?`)
        .run(now, id);
    } else if (action === 'complete') {
      if (row.status !== 'cooking' || row.cook_id !== member.id) throw appError(403, 'FORBIDDEN', '只有当前做菜人可以标记完成', { latest: menuItemDto(db, row, member.id) });
      db.prepare(`UPDATE menu_item SET status='completed',completed_at=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(now, now, id);
    } else if (action === 'cancel') {
      const reason = cleanText(body.reason, 200, false, '取消原因');
      const allowed = (row.status === 'pending' && row.ordered_by === member.id) || (row.status === 'cooking' && row.cook_id === member.id);
      if (!allowed) throw appError(403, 'FORBIDDEN', '当前成员不能取消这条事项', { latest: menuItemDto(db, row, member.id) });
      db.prepare(`UPDATE menu_item SET status='cancelled',cancelled_by=?,cancelled_name=?,cancelled_at=?,cancel_reason=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(member.id, member.name, now, reason, now, id);
    } else {
      throw appError(500, 'INTERNAL_ERROR', '未实现的菜单动作');
    }
    if (['note','claim','complete'].includes(action) && Object.hasOwn(body,'voiceMediaId')) {
      const column = {note:'note_voice_media_id',claim:'claim_voice_media_id',complete:'completion_voice_media_id'}[action];
      db.prepare(`UPDATE menu_item SET ${column}=? WHERE id=?`).run(attachment(db,body.voiceMediaId,'audio'),id);
    }
    if(action==='unclaim') db.prepare('UPDATE menu_item SET claim_voice_media_id=NULL WHERE id=?').run(id);
    if(action==='complete') {
      const photos=body.photoMediaIds || [];
      assert(Array.isArray(photos) && photos.length<=9,400,'INVALID_INPUT','最多上传 9 张成品照片');
      photos.forEach((photo,i)=>db.prepare('INSERT INTO menu_completion_photo VALUES(?,?,?)').run(id,i+1,attachment(db,photo,'image')));
      db.prepare('UPDATE menu_item SET completion_note=? WHERE id=?').run(cleanText(body.completionNote,200,false,'完成留言'),id);
    }
    return menuItemDto(db, menuItemRow(db, id), member.id);
  });
}

function itemReviews(db, headers, id, query) {
  requireReadContext(db, headers, { active: false });
  const item = menuItemRow(db, id);
  const rows = db.prepare(`SELECT * FROM review
    WHERE dish_id=? AND review_date=? AND superseded=0
    ORDER BY created_at DESC, id ASC`).all(item.dish_id, item.menu_date).map(reviewDto);
  return pageFromArray(rows, { limit: query.limit, cursor: query.cursor || null, filter: { route: 'itemReviews', menuItemId: id }, key: (item) => [item.createdAt, item.id], descending: [true, false] });
}

function putMyReview(db, headers, id, body, clock) {
  exactObject(body, ['rating', 'comment', 'voiceMediaId']);
  const rating = Number(body.rating);
  assert(Number.isInteger(rating) && rating >= 1 && rating <= 5, 400, 'INVALID_RATING', '评分必须为 1—5 的整数');
  const comment = cleanText(body.comment, 1000, false, '评价');
  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const item = menuItemRow(db, id);
    if (item.status !== 'completed') throw appError(409, 'STATE_CONFLICT', '只能评价已完成的菜', { latest: menuItemDto(db, item, member.id) });
    const now = utcNow(clock);
    const existing = db.prepare(`SELECT * FROM review
      WHERE dish_id=? AND review_date=? AND member_id=? AND superseded=0`).get(item.dish_id, item.menu_date, member.id);
    if (existing) throw appError(409, 'REVIEW_ALREADY_SUBMITTED', '当天已经评价过这道菜，评价提交后不能修改', { review: reviewDto(existing) });
    const reviewId = randomId('review');
    db.prepare(`INSERT INTO review(id,menu_item_id,dish_id,review_date,member_id,member_name,rating,comment,superseded,created_at,updated_at,voice_media_id)
                VALUES(?,?,?,?,?,?,?,?,0,?,?,?)`)
      .run(reviewId, id, item.dish_id, item.menu_date, member.id, member.name, rating, comment, now, now, attachment(db,body.voiceMediaId,'audio'));
    return reviewDto(db.prepare('SELECT * FROM review WHERE id=?').get(reviewId));
  });
}

function myOrders(db, headers, query) {
  const { member } = requireReadContext(db, headers, { active: false });
  const dateFrom = query.dateFrom || null;
  const dateTo = query.dateTo || null;
  if (dateFrom) assert(isDate(dateFrom), 400, 'INVALID_INPUT', 'dateFrom 不合法');
  if (dateTo) assert(isDate(dateTo), 400, 'INVALID_INPUT', 'dateTo 不合法');
  const status = query.status || null;
  if (status) assert(['pending', 'cooking', 'completed', 'cancelled'].includes(status), 400, 'INVALID_INPUT', 'status 不合法');
  const rows = db.prepare(`SELECT * FROM menu_item WHERE ordered_by=?
    AND (? IS NULL OR menu_date>=?) AND (? IS NULL OR menu_date<=?)
    AND (? IS NULL OR status=?) ORDER BY menu_date DESC, created_at DESC, id DESC`)
    .all(member.id, dateFrom, dateFrom, dateTo, dateTo, status, status)
    .map((row) => menuItemDto(db, row, member.id));
  return pageFromArray(rows, { limit: query.limit, cursor: query.cursor || null, filter: { route: 'myOrders', memberId: member.id, dateFrom, dateTo, status }, key: (item) => [item.menuDate, item.createdAt, item.id], descending: [true, true, true] });
}

function myTasks(db, headers, query) {
  const { member } = requireReadContext(db, headers, { active: false });
  const rows = db.prepare("SELECT * FROM menu_item WHERE cook_id=? AND status='cooking'").all(member.id)
    .map((row) => menuItemDto(db, row, member.id));
  return pageFromArray(rows, { limit: query.limit, cursor: query.cursor || null,
    filter: { route: 'myTasks', memberId: member.id }, key: (item) => [item.menuDate, item.createdAt, item.id] });
}

function myReviews(db, headers, query) {
  const { member } = requireReadContext(db, headers, { active: false });
  const rows = db.prepare(`SELECT r.*, mi.dish_name, mi.menu_date, mi.status AS item_status
                           FROM review r JOIN menu_item mi ON mi.id=r.menu_item_id
                           WHERE r.member_id=? AND r.superseded=0 ORDER BY r.created_at DESC, r.id DESC`).all(member.id)
    .map((row) => ({ review: reviewDto(row), item: { id: row.menu_item_id, dishName: row.dish_name, menuDate: row.menu_date, status: row.item_status } }));
  return pageFromArray(rows, { limit: query.limit, cursor: query.cursor || null, filter: { route: 'myReviews', memberId: member.id }, key: (item) => [item.review.createdAt, item.review.id], descending: [true, true] });
}

function history(db, headers, query, clock) {
  requireReadContext(db, headers, { active: false });
  const today = shanghaiToday(clock);
  const beforeDate = query.beforeDate || today;
  assert(isDate(beforeDate), 400, 'INVALID_INPUT', 'beforeDate 不合法');
  const dates = db.prepare(`SELECT DISTINCT menu_date FROM menu_item
    WHERE menu_date<? AND status IN('completed','cancelled') ORDER BY menu_date DESC`).all(beforeDate).map((r) => r.menu_date);
  const summaries = dates.map((date) => historySummary(db, date));
  return pageFromArray(summaries, { limit: query.limit, cursor: query.cursor || null, filter: { route: 'history', beforeDate }, key: (item) => [item.menuDate], descending: [true] });
}

module.exports = {
  menuItemRow,
  listMenu,
  unfinished,
  getMenuItem,
  appendMenuItem,
  batchSubmit,
  getReceipt,
  mutateMenuItem,
  itemReviews,
  putMyReview,
  myOrders,
  myReviews,
  myTasks,
  history,
};
