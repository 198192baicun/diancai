'use strict';

const {
  TIMEZONE,
  API_VERSION,
  appError,
  assert,
  cleanText,
  cleanName,
  normalizeName,
  randomId,
  shanghaiToday,
  utcNow,
  parseBoolean,
  pageFromArray,
  exactObject,
} = require('./core.cjs');
const {
  SCHEMA_VERSION,
  transaction,
  getMeta,
  requireReadContext,
  requireWriteContext,
  requireMember,
} = require('./db.cjs');
const { memberDto, categoryDto, menuItemDto, voteDto } = require('./dto.cjs');

const INITIAL_CATEGORIES = ['荤菜', '素菜', '汤', '主食', '凉菜', '其他'];

function system(db, clock) {
  const meta = getMeta(db);
  return {
    initialized: !!meta,
    familyName: meta?.family_name || null,
    timezone: TIMEZONE,
    today: shanghaiToday(clock),
    instanceId: meta?.instance_id || null,
    dataEpoch: meta?.data_epoch || null,
    schemaVersion: SCHEMA_VERSION,
    apiVersion: API_VERSION,
  };
}

function setup(db, body, clock) {
  exactObject(body, ['familyName', 'members']);
  const familyName = cleanText(body.familyName, 30, true, '家庭名称');
  assert(Array.isArray(body.members) && body.members.length >= 1 && body.members.length <= 20, 400, 'INVALID_INPUT', '初始成员需为 1—20 位');
  const members = body.members.map((item, index) => {
    exactObject(item, ['name']);
    const name = cleanName(item.name, 20, `成员 ${index + 1} 名称`);
    return { name, key: normalizeName(name) };
  });
  assert(new Set(members.map((m) => m.key)).size === members.length, 409, 'NAME_EXISTS', '初始成员名称不能重复');

  return transaction(db, () => {
    if (getMeta(db)) throw appError(409, 'ALREADY_INITIALIZED', '家庭已经初始化，不能再次覆盖');
    const now = utcNow(clock);
    const instanceId = randomId('inst');
    const dataEpoch = randomId('epoch');
    db.prepare(`INSERT INTO app_meta(singleton,family_name,timezone,instance_id,data_epoch,created_at)
                VALUES(1,?,?,?,?,?)`).run(familyName, TIMEZONE, instanceId, dataEpoch, now);
    for (const member of members) {
      db.prepare('INSERT INTO member(id,name,name_key,active,created_at) VALUES(?,?,?,?,?)')
        .run(randomId('member'), member.name, member.key, 1, now);
    }
    for (const name of INITIAL_CATEGORIES) {
      db.prepare('INSERT INTO category(id,name,name_key,active,created_at) VALUES(?,?,?,?,?)')
        .run(randomId('category'), name, normalizeName(name), 1, now);
    }
    return system(db, clock);
  });
}

function listMembers(db, headers, query) {
  const includeInactive = parseBoolean(query.includeInactive, false);
  if (includeInactive) requireReadContext(db, headers);
  else if (headers.memberId) requireReadContext(db, headers);
  const rows = db.prepare(`SELECT * FROM member ${includeInactive ? '' : 'WHERE active=1'} ORDER BY created_at ASC, id ASC`).all();
  return rows.map(memberDto);
}

function saveMember(db, headers, body, id, clock) {
  exactObject(body, ['name']);
  const name = cleanName(body.name, 20, '成员名称');
  const key = normalizeName(name);
  return transaction(db, () => {
    requireWriteContext(db, headers);
    const duplicate = db.prepare('SELECT id FROM member WHERE name_key=? AND id<>COALESCE(?,\'\')').get(key, id || null);
    if (duplicate) throw appError(409, 'NAME_EXISTS', '成员名称已存在，停用成员也会保留名称');
    if (id) {
      const row = db.prepare('SELECT * FROM member WHERE id=?').get(id);
      if (!row) throw appError(404, 'NOT_FOUND', '成员不存在');
      db.prepare('UPDATE member SET name=?, name_key=? WHERE id=?').run(name, key, id);
      return memberDto(db.prepare('SELECT * FROM member WHERE id=?').get(id));
    }
    const newId = randomId('member');
    db.prepare('INSERT INTO member(id,name,name_key,active,created_at) VALUES(?,?,?,?,?)').run(newId, name, key, 1, utcNow(clock));
    return memberDto(db.prepare('SELECT * FROM member WHERE id=?').get(newId));
  });
}

function memberDependencies(db, headers, id, query) {
  requireReadContext(db, headers);
  requireMember(db, id);
  const limit = Number(query.limit || 20);
  const cursor = query.cursor || null;
  const pending = db.prepare("SELECT * FROM menu_item WHERE ordered_by=? AND status='pending' ORDER BY menu_date ASC, created_at ASC").all(id);
  const cooking = db.prepare("SELECT * FROM menu_item WHERE cook_id=? AND status='cooking' ORDER BY menu_date ASC, created_at ASC").all(id);
  const votes = db.prepare("SELECT * FROM vote WHERE initiator_id=? AND status='active' ORDER BY created_at ASC").all(id);
  const activeCount = Number(db.prepare('SELECT COUNT(*) AS n FROM member WHERE active=1').get().n);
  const allItems = [
    ...pending.map((row) => ({ kind: 'pendingItem', value: menuItemDto(db, row, headers.memberId) })),
    ...cooking.map((row) => ({ kind: 'cookingItem', value: menuItemDto(db, row, headers.memberId) })),
    ...votes.map((row) => ({ kind: 'activeVote', value: voteDto(db, row, headers.memberId) })),
  ];
  const page = pageFromArray(allItems, { limit, cursor, filter: { route: 'dependencies', memberId: id, actorId: headers.memberId }, key: (item) => [item.kind, item.value.createdAt, item.value.id] });
  return {
    pendingItems: { count: pending.length },
    cookingItems: { count: cooking.length },
    activeVotes: { count: votes.length },
    lastActiveMember: activeCount === 1 && !!db.prepare('SELECT 1 FROM member WHERE id=? AND active=1').get(id),
    dependencies: page.items,
    total: allItems.length,
    nextCursor: page.nextCursor,
  };
}

function setMemberStatus(db, headers, id, body, clock) {
  exactObject(body, ['active']);
  assert(typeof body.active === 'boolean', 400, 'INVALID_INPUT', 'active 必须为布尔值');
  return transaction(db, () => {
    requireWriteContext(db, headers);
    const row = db.prepare('SELECT * FROM member WHERE id=?').get(id);
    if (!row) throw appError(404, 'NOT_FOUND', '成员不存在');
    const next = body.active ? 1 : 0;
    if (row.active === next) return memberDto(row);
    if (!next) {
      const activeCount = Number(db.prepare('SELECT COUNT(*) AS n FROM member WHERE active=1').get().n);
      if (activeCount <= 1) throw appError(409, 'LAST_ACTIVE_MEMBER', '至少保留一位启用成员');
      const pending = Number(db.prepare("SELECT COUNT(*) AS n FROM menu_item WHERE ordered_by=? AND status='pending'").get(id).n);
      const cooking = Number(db.prepare("SELECT COUNT(*) AS n FROM menu_item WHERE cook_id=? AND status='cooking'").get(id).n);
      const votes = Number(db.prepare("SELECT COUNT(*) AS n FROM vote WHERE initiator_id=? AND status='active'").get(id).n);
      if (pending || cooking || votes) {
        throw appError(409, 'MEMBER_IN_USE', '请先处理该成员的未完成事项或进行中投票', {
          pendingItems: pending,
          cookingItems: cooking,
          activeVotes: votes,
          dependenciesPath: `/api/members/${encodeURIComponent(id)}/dependencies`,
        });
      }
    }
    db.prepare('UPDATE member SET active=? WHERE id=?').run(next, id);
    for(const v of db.prepare("SELECT id FROM vote WHERE status='active'").all()) require('./vote.cjs').closeIfEveryoneVoted(db,v.id,clock);
    return memberDto(db.prepare('SELECT * FROM member WHERE id=?').get(id));
  });
}

function listCategories(db, headers, query) {
  const includeInactive = parseBoolean(query.includeInactive, false);
  if (includeInactive) requireReadContext(db, headers);
  else if (headers.memberId) requireReadContext(db, headers);
  const rows = db.prepare(`SELECT * FROM category ${includeInactive ? '' : 'WHERE active=1'} ORDER BY created_at ASC, id ASC`).all();
  return rows.map(categoryDto);
}

function saveCategory(db, headers, body, id, clock) {
  exactObject(body, ['name']);
  const name = cleanName(body.name, 20, '分类名称');
  const key = normalizeName(name);
  return transaction(db, () => {
    requireWriteContext(db, headers);
    const duplicate = db.prepare('SELECT id FROM category WHERE name_key=? AND id<>COALESCE(?,\'\')').get(key, id || null);
    if (duplicate) throw appError(409, 'NAME_EXISTS', '分类名称已存在，停用分类也会保留名称');
    if (id) {
      const row = db.prepare('SELECT * FROM category WHERE id=?').get(id);
      if (!row) throw appError(404, 'NOT_FOUND', '分类不存在');
      db.prepare('UPDATE category SET name=?, name_key=? WHERE id=?').run(name, key, id);
      return categoryDto(db.prepare('SELECT * FROM category WHERE id=?').get(id));
    }
    const newId = randomId('category');
    db.prepare('INSERT INTO category(id,name,name_key,active,created_at) VALUES(?,?,?,?,?)').run(newId, name, key, 1, utcNow(clock));
    return categoryDto(db.prepare('SELECT * FROM category WHERE id=?').get(newId));
  });
}

function setCategoryStatus(db, headers, id, body) {
  exactObject(body, ['active']);
  assert(typeof body.active === 'boolean', 400, 'INVALID_INPUT', 'active 必须为布尔值');
  return transaction(db, () => {
    requireWriteContext(db, headers);
    const row = db.prepare('SELECT * FROM category WHERE id=?').get(id);
    if (!row) throw appError(404, 'NOT_FOUND', '分类不存在');
    const next = body.active ? 1 : 0;
    if (row.active === next) return categoryDto(row);
    if (!next) {
      const inUse = Number(db.prepare('SELECT COUNT(*) AS n FROM dish WHERE category_id=? AND active=1').get(id).n);
      if (inUse) throw appError(409, 'CATEGORY_IN_USE', '请先下架或移动该分类下的上架菜品', { activeDishCount: inUse });
    }
    db.prepare('UPDATE category SET active=? WHERE id=?').run(next, id);
    return categoryDto(db.prepare('SELECT * FROM category WHERE id=?').get(id));
  });
}

function renameFamily(db, headers, body) {
  exactObject(body, ['name']);
  const name = cleanText(body.name, 30, true, '家庭名称');
  return transaction(db, () => {
    requireWriteContext(db, headers);
    db.prepare('UPDATE app_meta SET family_name=? WHERE singleton=1').run(name);
    return { name };
  });
}

module.exports = {
  INITIAL_CATEGORIES,
  system,
  setup,
  listMembers,
  saveMember,
  memberDependencies,
  setMemberStatus,
  listCategories,
  saveCategory,
  setCategoryStatus,
  renameFamily,
};
