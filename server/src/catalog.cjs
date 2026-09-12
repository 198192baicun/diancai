'use strict';

const {
  appError,
  assert,
  cleanText,
  cleanName,
  normalizeName,
  randomId,
  parseInteger,
  pageFromArray,
  exactObject,
  utcNow,
} = require('./core.cjs');
const { transaction, requireReadContext, requireWriteContext } = require('./db.cjs');
const { attachment } = require('./attachments.cjs');
const { dishDto, reviewDto } = require('./dto.cjs');

function categoryAvailable(db, categoryId) {
  return !!db.prepare('SELECT 1 FROM category WHERE id=? AND active=1').get(categoryId);
}

function dishAvailable(db, dishId) {
  return !!db.prepare(`SELECT 1 FROM dish d JOIN category c ON c.id=d.category_id
                       WHERE d.id=? AND d.active=1 AND c.active=1`).get(dishId);
}

function listDishes(db, headers, query) {
  requireReadContext(db, headers, { active: false });
  const q = String(query.q || '').trim();
  const qKey = normalizeName(q);
  const categoryId = query.categoryId || null;
  const activeParam = query.active == null ? 'true' : String(query.active);
  assert(['true', 'false', 'all'].includes(activeParam), 400, 'INVALID_INPUT', 'active 参数不合法');
  const limit = parseInteger(query.limit, { min: 1, max: 50, fallback: 10, field: 'limit' });
  const rows = db.prepare(`
    SELECT d.* FROM dish d
    JOIN category c ON c.id=d.category_id
    WHERE (? IS NULL OR d.category_id=?)
      AND (?='all' OR d.active=CASE WHEN ?='true' THEN 1 ELSE 0 END)
      AND (?='all' OR d.active=0 OR c.active=1)
    ORDER BY d.created_at DESC, d.id ASC
  `).all(categoryId, categoryId, activeParam, activeParam, activeParam)
    .filter((row) => !qKey || normalizeName(row.name).includes(qKey));
  const dtos = rows.map((row) => dishDto(db, row));
  return pageFromArray(dtos, {
    limit,
    cursor: query.cursor || null,
    filter: { route: 'dishes', q: qKey, categoryId, active: activeParam },
    key: (item) => [item.createdAt, item.id], descending: [true, false],
  });
}

function getDish(db, headers, id) {
  requireReadContext(db, headers, { active: false });
  const row = db.prepare('SELECT * FROM dish WHERE id=?').get(id);
  if (!row) throw appError(404, 'NOT_FOUND', '菜品不存在');
  return dishDto(db, row);
}

function validateDishPayload(db, body, { update = false, existing = null } = {}) {
  const keys = ['name', 'categoryId', 'estimatedMinutes', 'introduction', 'coverMediaId', 'steps', 'voiceMediaId'];
  if (update) keys.push('expectedRevision');
  exactObject(body, keys);
  const name = cleanName(body.name, 50, '菜名');
  assert(typeof body.categoryId === 'string' && body.categoryId, 400, 'INVALID_INPUT', '请选择分类');
  const category = db.prepare('SELECT * FROM category WHERE id=?').get(body.categoryId);
  if (!category) throw appError(400, 'INVALID_INPUT', '分类不存在');
  if ((!existing || existing.active) && !category.active) throw appError(409, 'CATEGORY_INACTIVE', '请选择启用的分类');
  let estimatedMinutes = null;
  if (body.estimatedMinutes != null && body.estimatedMinutes !== '') {
    estimatedMinutes = Number(body.estimatedMinutes);
    assert(Number.isInteger(estimatedMinutes) && estimatedMinutes >= 1 && estimatedMinutes <= 1440, 400, 'INVALID_INPUT', '预计时长须为 1—1440 分钟整数');
  }
  const introduction = cleanText(body.introduction, 1000, false, '简介');
  const coverMediaId = body.coverMediaId == null || body.coverMediaId === '' ? null : String(body.coverMediaId);
  attachment(db, coverMediaId,'image');
  assert(Array.isArray(body.steps) && body.steps.length <= 50, 400, 'INVALID_INPUT', '做法步骤最多 50 步');
  const steps = body.steps.map((step, index) => {
    exactObject(step, ['content', 'mediaId']);
    const content = cleanText(step.content, 2000, true, `步骤 ${index + 1}`);
    const mediaId = step.mediaId == null || step.mediaId === '' ? null : String(step.mediaId);
    attachment(db,mediaId,'image');
    return { content, mediaId };
  });
  const expectedRevision = update ? Number(body.expectedRevision) : null;
  if (update) assert(Number.isInteger(expectedRevision) && expectedRevision >= 1, 400, 'INVALID_INPUT', 'expectedRevision 不合法');
  return { name, nameKey: normalizeName(name), categoryId: body.categoryId, estimatedMinutes, introduction, coverMediaId, steps, expectedRevision };
}

function saveDish(db, headers, body, id, clock) {
  return transaction(db, () => {
    const { member } = requireWriteContext(db, headers);
    const existing = id ? db.prepare('SELECT * FROM dish WHERE id=?').get(id) : null;
    if (id && !existing) throw appError(404, 'NOT_FOUND', '菜品不存在');
    const values = validateDishPayload(db, body, { update: !!id, existing });
    if (existing && Number(existing.revision) !== values.expectedRevision) {
      throw appError(409, 'VERSION_CONFLICT', '菜品资料已有变化，请查看最新版本', { latest: dishDto(db, existing) });
    }
    const duplicate = db.prepare('SELECT id FROM dish WHERE name_key=? AND id<>COALESCE(?,\'\')').get(values.nameKey, id || null);
    if (duplicate) throw appError(409, 'NAME_EXISTS', '这个菜名已经存在');
    const now = utcNow(clock);
    let dishId = id;
    if (!dishId) {
      dishId = randomId('dish');
      db.prepare(`INSERT INTO dish(id,name,name_key,category_id,active,estimated_minutes,introduction,cover_media_id,created_by,revision,created_at,updated_at)
                  VALUES(?,?,?,?,1,?,?,?,?,1,?,?)`)
        .run(dishId, values.name, values.nameKey, values.categoryId, values.estimatedMinutes, values.introduction, values.coverMediaId, member.id, now, now);
    } else {
      db.prepare(`UPDATE dish SET name=?,name_key=?,category_id=?,estimated_minutes=?,introduction=?,cover_media_id=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(values.name, values.nameKey, values.categoryId, values.estimatedMinutes, values.introduction, values.coverMediaId, now, dishId);
      db.prepare('DELETE FROM recipe_step WHERE dish_id=?').run(dishId);
    }
    const insertStep = db.prepare('INSERT INTO recipe_step(id,dish_id,position,content,media_id) VALUES(?,?,?,?,?)');
    values.steps.forEach((step, index) => insertStep.run(randomId('step'), dishId, index + 1, step.content, step.mediaId));
    if(Object.hasOwn(body,'voiceMediaId')) db.prepare('UPDATE dish SET voice_media_id=? WHERE id=?').run(attachment(db,body.voiceMediaId,'audio'),dishId);
    return dishDto(db, db.prepare('SELECT * FROM dish WHERE id=?').get(dishId));
  });
}

function setDishStatus(db, headers, id, body, clock) {
  exactObject(body, ['active', 'expectedRevision']);
  assert(typeof body.active === 'boolean', 400, 'INVALID_INPUT', 'active 必须为布尔值');
  const expectedRevision = Number(body.expectedRevision);
  assert(Number.isInteger(expectedRevision) && expectedRevision >= 1, 400, 'INVALID_INPUT', 'expectedRevision 不合法');
  return transaction(db, () => {
    requireWriteContext(db, headers);
    const row = db.prepare('SELECT * FROM dish WHERE id=?').get(id);
    if (!row) throw appError(404, 'NOT_FOUND', '菜品不存在');
    if (Number(row.revision) !== expectedRevision) throw appError(409, 'VERSION_CONFLICT', '菜品资料已有变化', { latest: dishDto(db, row) });
    const next = body.active ? 1 : 0;
    if (row.active === next) return dishDto(db, row);
    if (!next) {
      const activeVote = db.prepare(`SELECT v.id FROM vote v JOIN vote_candidate vc ON vc.vote_id=v.id
                                     WHERE v.status='active' AND vc.dish_id=? LIMIT 1`).get(id);
      if (activeVote) throw appError(409, 'ACTIVE_VOTE', '该菜正在参与投票，请先结束或取消投票', { voteId: activeVote.id });
    } else if (!categoryAvailable(db, row.category_id)) {
      throw appError(409, 'CATEGORY_INACTIVE', '分类已停用，请先调整分类');
    }
    db.prepare('UPDATE dish SET active=?, revision=revision+1, updated_at=? WHERE id=?').run(next, utcNow(clock), id);
    return dishDto(db, db.prepare('SELECT * FROM dish WHERE id=?').get(id));
  });
}

function dishReviews(db, headers, id, query) {
  requireReadContext(db, headers, { active: false });
  if (!db.prepare('SELECT 1 FROM dish WHERE id=?').get(id)) throw appError(404, 'NOT_FOUND', '菜品不存在');
  const rows = db.prepare(`SELECT r.* FROM review r
                           WHERE r.dish_id=? AND r.superseded=0
                           ORDER BY r.created_at DESC, r.id ASC`).all(id).map(reviewDto);
  return pageFromArray(rows, {
    limit: query.limit,
    cursor: query.cursor || null,
    filter: { route: 'dishReviews', dishId: id },
    key: (item) => [item.createdAt, item.id], descending: [true, false],
  });
}

module.exports = {
  categoryAvailable,
  dishAvailable,
  listDishes,
  getDish,
  saveDish,
  setDishStatus,
  dishReviews,
};
