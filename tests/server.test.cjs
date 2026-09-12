'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../server/src/http.cjs');
const { createDatabase } = require('../server/src/db.cjs');

function requestWithHost(base, pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request(new URL(pathname, base), { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('默认拒绝任意 Host 和 Origin，原生无 Origin 请求仍可连接', async (t) => {
  const previous = { hosts: process.env.ALLOWED_HOSTS, origins: process.env.ALLOWED_ORIGINS };
  delete process.env.ALLOWED_HOSTS;
  delete process.env.ALLOWED_ORIGINS;
  t.after(() => {
    for (const [key, value] of [['ALLOWED_HOSTS', previous.hosts], ['ALLOWED_ORIGINS', previous.origins]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const { base } = await startFixture(t);
  assert.equal((await requestWithHost(base, '/api/system')).status, 200);
  for (const host of ['audit.invalid', '127.0.0.1.attacker.invalid', 'localhost:1']) {
    const res = await requestWithHost(base, '/api/system', { Host: host });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error.code, 'HOST_NOT_ALLOWED');
  }
  for (const origin of ['http://audit.invalid', 'null', '']) {
    const res = await requestWithHost(base, '/api/system', { Origin: origin });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error.code, 'ORIGIN_NOT_ALLOWED');
  }
  assert.equal((await requestWithHost(base, '/api/system', { Origin: 'http://audit.invalid' }, 'OPTIONS')).status, 403);
});

test('明确配置映射端口和浏览器来源，本机探针不放宽业务 Host', async (t) => {
  const origin = 'http://viewer.invalid:8080';
  const { base } = await startFixture(t, { allowedHosts: ['192.168.1.100:18080'], allowedOrigins: [origin] });
  const headers = { Host: '192.168.1.100:18080' };
  assert.equal((await requestWithHost(base, '/api/system', headers)).status, 200);
  const cors = await requestWithHost(base, '/api/system', { ...headers, Origin: origin }, 'OPTIONS');
  assert.equal(cors.status, 204);
  assert.equal(cors.headers['access-control-allow-origin'], origin);
  assert.equal((await requestWithHost(base, '/api/system', { ...headers, Origin: origin + '.attacker.invalid' })).status, 403);
  assert.equal((await requestWithHost(base, '/api/system')).status, 403);
  assert.equal((await requestWithHost(base, '/health/ready')).status, 200);
  assert.equal((await requestWithHost(base, '/health/live')).status, 200);
  assert.equal((await requestWithHost(base, '/health/ready', {}, 'POST')).status, 403);
  assert.equal((await requestWithHost(base, '/health/ready', { Host: 'audit.invalid' })).status, 403);
  const denied = await startFixture(t, { allowedHosts: [], allowedOrigins: [] });
  assert.equal((await requestWithHost(denied.base, '/api/system')).status, 403);
});

test('媒体读取故障及下载取消关闭文件流，服务继续可用', async (t) => {
  const { Readable } = require('node:stream');
  const { app, base } = await startFixture(t);
  const { system, members } = await setupFamily(base);
  const form = new FormData();
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  form.append('file', new Blob([bytes]), 'synthetic.png');
  const uploaded = await fetch(base + '/api/media', { method: 'POST', headers: writeHeaders(system, members[0].id), body: form });
  assert.equal(uploaded.status, 201);
  const media = (await uploaded.json()).data;
  let stream;
  const mock = t.mock.method(fs, 'createReadStream', () => {
    stream = new Readable({ read() { this.destroy(Object.assign(new Error('synthetic disk error'), { code: 'EIO' })); } });
    return stream;
  });
  for (const route of ['content', 'download']) {
    await assert.rejects(async () => {
      const res = await fetch(`${base}/api/media/${media.id}/${route}`);
      await res.arrayBuffer();
    });
    assert.ok(stream.destroyed);
    assert.equal((await jsonRequest(base, '/health/ready')).status, 200);
  }
  mock.mock.restore();
  const slow = t.mock.method(fs, 'createReadStream', () => {
    stream = new Readable({ read() { if (!this.sent) { this.sent = true; this.push(bytes.subarray(0, 1)); } } });
    return stream;
  });
  const res = await fetch(`${base}/api/media/${media.id}/download`);
  const closed = require('node:events').once(stream, 'close').catch(() => {});
  await res.body.cancel();
  await closed;
  assert.ok(stream.destroyed);
  slow.mock.restore();
  assert.equal((await jsonRequest(base, '/api/system')).status, 200);
  const good = await fetch(`${base}/api/media/${media.id}/download`);
  assert.deepEqual(Buffer.from(await good.arrayBuffer()), bytes);
  assert.ok(fs.existsSync(path.join(app.database.dataRoot, 'media')));
});

async function jsonRequest(base, pathname, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, payload, headers: response.headers };
}

function writeHeaders(system, memberId, extra = {}) {
  return {
    'x-member-id': memberId,
    'x-instance-id': system.instanceId,
    'x-data-epoch': system.dataEpoch,
    ...extra,
  };
}

async function startFixture(t, options = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diancai-api-'));
  let instant = new Date('2026-09-09T08:00:00.000Z');
  const app = createApp({ dataRoot, allowCreate: true, allowUnsupportedSqlite: true, logger: false, clock: () => new Date(instant), ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  return { app, base, setInstant(value) { instant = new Date(value); } };
}

async function setupFamily(base) {
  const before = await jsonRequest(base, '/api/system');
  assert.equal(before.status, 200);
  assert.equal(before.payload.data.initialized, false);

  const setup = await jsonRequest(base, '/api/setup', {
    method: 'POST',
    body: { familyName: '幸福之家', members: [{ name: '丈夫' }, { name: '妻子' }, { name: '妈妈' }] },
  });
  assert.equal(setup.status, 201);
  assert.equal(setup.payload.data.timezone, 'Asia/Shanghai');
  const system = setup.payload.data;
  const members = (await jsonRequest(base, '/api/members')).payload.data;
  const categories = (await jsonRequest(base, '/api/categories')).payload.data;
  assert.equal(categories.length, 6);
  return { system, members, categories };
}

async function createDish(base, system, actor, categoryId, name) {
  const response = await jsonRequest(base, '/api/dishes', {
    method: 'POST',
    headers: writeHeaders(system, actor.id),
    body: { name, categoryId, estimatedMinutes: 20, introduction: `${name} 简介`, coverMediaId: null, steps: [{ content: '准备食材', mediaId: null }] },
  });
  assert.equal(response.status, 201, JSON.stringify(response.payload));
  return response.payload.data;
}

test('HTTP 分页总数、跨页稳定性、我的待做与过期投票选择', async (t) => {
  const { base, setInstant } = await startFixture(t);
  const { system, members, categories } = await setupFamily(base);
  const a = members[0], b = members[1], headers = writeHeaders(system, a.id);
  const dish = await createDish(base, system, a, categories[0].id, '分页测试菜');
  const dish2 = await createDish(base, system, a, categories[0].id, '另一个候选菜');
  const submit = async (count, key) => jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: { ...headers, 'x-idempotency-key': key }, body: { targetDate: system.today, items: Array.from({ length: count }, () => ({ dishId: dish.id, note: '' })) } });
  assert.equal((await submit(50, 'pagination-first')).status, 201);
  assert.equal((await submit(2, 'pagination-second')).status, 201);
  const first = await jsonRequest(base, `/api/menu?date=${system.today}&status=pending&limit=1`, { headers });
  assert.equal(first.payload.data.total, 52);
  const item = first.payload.data.items[0];
  assert.equal((await jsonRequest(base, `/api/menu-items/${item.id}/claim`, { method: 'POST', headers, body: { expectedRevision: item.revision } })).status, 200);
  const second = await jsonRequest(base, `/api/menu?date=${system.today}&status=pending&limit=50&cursor=${encodeURIComponent(first.payload.data.nextCursor)}`, { headers });
  assert.equal(second.payload.data.items.length, 50);
  const third = await jsonRequest(base, `/api/menu?date=${system.today}&status=pending&limit=50&cursor=${encodeURIComponent(second.payload.data.nextCursor)}`, { headers });
  assert.equal(third.payload.data.items.length, 1);
  assert.equal(new Set([...second.payload.data.items, ...third.payload.data.items].map(x => x.id)).size, 51);
  setInstant('2026-09-10T08:00:00.000Z');
  const tasks = await jsonRequest(base, '/api/me/tasks', { headers });
  assert.equal(tasks.payload.data.total, 1); assert.equal(tasks.payload.data.items[0].menuDate, system.today);
  assert.equal((await jsonRequest(base, '/api/me/tasks', { headers: writeHeaders(system, b.id) })).payload.data.total, 0);
  assert.equal((await jsonRequest(base, '/api/menu/unfinished?limit=1', { headers })).payload.data.total, 52);
  const poll = await jsonRequest(base, '/api/votes', { method: 'POST', headers, body: { title: '选择测试', dishIds: [dish.id, dish2.id] } });
  const pollId = poll.payload.data.id;
  await jsonRequest(base, `/api/votes/${pollId}/my-ballot`, { method: 'PUT', headers, body: { dishIds: [dish.id] } });
  const wrong = await jsonRequest(base, `/api/votes/${pollId}/finish`, { method: 'POST', headers, body: { winnerDishId: dish2.id } });
  assert.equal(wrong.payload.error.code, 'INVALID_WINNER');
  assert.equal((await jsonRequest(base, `/api/votes/${pollId}`, { headers })).payload.data.status, 'active');
  const invalidImport = await jsonRequest(base, '/api/recipe-imports', { method: 'POST', headers, body: { shareText: 'https://127.0.0.1/secret' } });
  assert.equal(invalidImport.status, 400);
});

test('已有 v1 数据库按迁移记录升级到 v3', (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diancai-v1-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const dbPath = path.join(dataRoot, 'app.db');
  const legacy = new DatabaseSync(dbPath);
  const migrationPath = path.join(__dirname, '..', 'server', 'migrations', '001_initial.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  legacy.exec(migrationSql);
  legacy.prepare('INSERT INTO schema_migration(version,sha256,applied_at) VALUES(1,?,?)')
    .run(crypto.createHash('sha256').update(migrationSql).digest('hex'), '2026-09-10T00:00:00.000Z');
  legacy.close();

  const upgraded = createDatabase({ dataRoot, allowCreate: true, allowUnsupportedSqlite: true });
  try {
    assert.equal(upgraded.schemaVersion, 3);
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.deepEqual(upgraded.db.prepare('SELECT version FROM schema_migration ORDER BY version').all().map((r) => r.version), [1, 2, 3]);
    assert.ok(upgraded.db.prepare("SELECT 1 FROM pragma_table_info('review') WHERE name='review_date'").get());
  } finally {
    upgraded.db.close();
  }
});

test('家庭点菜 HTTP 服务覆盖核心事务、幂等、状态、投票、历史与媒体', async (t) => {
  const fx = await startFixture(t);
  const { base, app } = fx;
  const { system, members, categories } = await setupFamily(base);
  const [husband, wife, mother] = members;
  const cat = categories[0];

  const unknownQuery = await jsonRequest(base, '/api/categories?unexpected=1', { headers: { 'x-member-id': husband.id } });
  assert.equal(unknownQuery.status, 400);
  assert.equal(unknownQuery.payload.error.code, 'INVALID_INPUT');

  const malformedPath = await jsonRequest(base, '/api/dishes/%E0%A4%A', { headers: { 'x-member-id': husband.id } });
  assert.equal(malformedPath.status, 400);
  assert.equal(malformedPath.payload.error.code, 'INVALID_INPUT');

  const pork = await createDish(base, system, husband, cat.id, '红烧肉');
  const wings = await createDish(base, system, husband, cat.id, '可乐鸡翅');

  // NFKC + Unicode full case-fold: 停用与启用资料都共享同一名称命名空间。
  const name1 = await jsonRequest(base, '/api/members', { method: 'POST', headers: writeHeaders(system, husband.id), body: { name: 'Straße' } });
  assert.equal(name1.status, 201);
  const name2 = await jsonRequest(base, '/api/members', { method: 'POST', headers: writeHeaders(system, husband.id), body: { name: 'STRASSE' } });
  assert.equal(name2.status, 409);
  assert.equal(name2.payload.error.code, 'NAME_EXISTS');

  const nfkcDisplay = await jsonRequest(base, '/api/members', { method: 'POST', headers: writeHeaders(system, husband.id), body: { name: 'ＡＢＣ' } });
  assert.equal(nfkcDisplay.status, 201);
  assert.equal(nfkcDisplay.payload.data.name, 'ABC');

  const key = 'batch-core-00000001';
  const batchBody = {
    targetDate: '2026-09-09',
    items: [
      { dishId: pork.id, note: '少放糖', sourceItemId: null },
      { dishId: pork.id, note: '', sourceItemId: null },
    ],
  };
  const firstBatch = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, wife.id, { 'x-idempotency-key': key }), body: batchBody });
  assert.equal(firstBatch.status, 201, JSON.stringify(firstBatch.payload));
  assert.equal(firstBatch.payload.data.menuItemIds.length, 2);
  assert.notEqual(firstBatch.payload.data.menuItemIds[0], firstBatch.payload.data.menuItemIds[1]);

  const replay = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, wife.id, { 'x-idempotency-key': key }), body: batchBody });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.payload.data.menuItemIds, firstBatch.payload.data.menuItemIds);

  const mismatch = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, wife.id, { 'x-idempotency-key': key }), body: { ...batchBody, items: [{ dishId: wings.id, note: '', sourceItemId: null }] } });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.payload.error.code, 'IDEMPOTENCY_MISMATCH');

  const [itemA, itemB] = firstBatch.payload.data.menuItemIds;
  const readA = await jsonRequest(base, `/api/menu-items/${itemA}`, { headers: { 'x-member-id': husband.id } });
  assert.equal(readA.status, 200);
  const revision = readA.payload.data.revision;

  const claimed = await jsonRequest(base, `/api/menu-items/${itemA}/claim`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { expectedRevision: revision } });
  assert.equal(claimed.status, 200);
  const competing = await jsonRequest(base, `/api/menu-items/${itemA}/claim`, { method: 'POST', headers: writeHeaders(system, mother.id), body: { expectedRevision: revision } });
  assert.equal(competing.status, 409);
  assert.equal(competing.payload.error.code, 'STATE_CONFLICT');

  const foreignComplete = await jsonRequest(base, `/api/menu-items/${itemA}/complete`, { method: 'POST', headers: writeHeaders(system, mother.id), body: { expectedRevision: claimed.payload.data.revision } });
  assert.equal(foreignComplete.status, 403);
  const completed = await jsonRequest(base, `/api/menu-items/${itemA}/complete`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { expectedRevision: claimed.payload.data.revision } });
  assert.equal(completed.status, 200);
  assert.equal(completed.payload.data.status, 'completed');

  const review1 = await jsonRequest(base, `/api/menu-items/${itemA}/my-review`, { method: 'PUT', headers: writeHeaders(system, wife.id), body: { rating: 4, comment: '不错' } });
  assert.equal(review1.status, 200);
  const review2 = await jsonRequest(base, `/api/menu-items/${itemA}/my-review`, { method: 'PUT', headers: writeHeaders(system, wife.id), body: { rating: 5, comment: '下次还要' } });
  assert.equal(review2.status, 409);
  assert.equal(review2.payload.error.code, 'REVIEW_ALREADY_SUBMITTED');
  const reviewList = await jsonRequest(base, `/api/menu-items/${itemA}/reviews?limit=50`, { headers: { 'x-member-id': wife.id } });
  assert.equal(reviewList.payload.data.items.length, 1);
  assert.equal(reviewList.payload.data.items[0].rating, 4);

  const readB = await jsonRequest(base, `/api/menu-items/${itemB}`, { headers: { 'x-member-id': wife.id } });
  const cancelled = await jsonRequest(base, `/api/menu-items/${itemB}/cancel`, { method: 'POST', headers: writeHeaders(system, wife.id), body: { expectedRevision: readB.payload.data.revision, reason: '今天不吃了' } });
  assert.equal(cancelled.status, 200);
  const day = await jsonRequest(base, '/api/menu?date=2026-09-09&limit=50', { headers: { 'x-member-id': wife.id } });
  assert.equal(day.payload.data.summary.counts.cancelled, 1);
  assert.equal(day.payload.data.summary.effectiveCount, 1);
  assert.equal(day.payload.data.summary.progress, 1);

  // 有全日期 pending 依赖的成员不能停用。
  const depKey = 'batch-dependency-0001';
  const depBatch = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, mother.id, { 'x-idempotency-key': depKey }), body: { targetDate: '2026-09-09', items: [{ dishId: wings.id, note: '', sourceItemId: null }] } });
  assert.equal(depBatch.status, 201);
  const deactivate = await jsonRequest(base, `/api/members/${mother.id}/status`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { active: false } });
  assert.equal(deactivate.status, 409);
  assert.equal(deactivate.payload.error.code, 'MEMBER_IN_USE');

  // 单 active 投票、每成员可多选、参与人数按成员去重、并列由发起人选定，同轮最多加入一次。
  const voteStart = await jsonRequest(base, '/api/votes', { method: 'POST', headers: writeHeaders(system, husband.id), body: { title: '今晚吃什么？', dishIds: [pork.id, wings.id] } });
  assert.equal(voteStart.status, 201);
  const voteId = voteStart.payload.data.id;
  const secondVote = await jsonRequest(base, '/api/votes', { method: 'POST', headers: writeHeaders(system, wife.id), body: { title: '第二轮', dishIds: [pork.id, wings.id] } });
  assert.equal(secondVote.status, 409);
  assert.equal(secondVote.payload.error.code, 'ACTIVE_VOTE');

  const ballot1 = await jsonRequest(base, `/api/votes/${voteId}/my-ballot`, { method: 'PUT', headers: writeHeaders(system, husband.id), body: { dishIds: [pork.id, wings.id] } });
  assert.equal(ballot1.status, 200);
  assert.deepEqual(new Set(ballot1.payload.data.myDishIds), new Set([pork.id, wings.id]));
  assert.equal(ballot1.payload.data.participantCount, 1);
  const ballot2 = await jsonRequest(base, `/api/votes/${voteId}/my-ballot`, { method: 'PUT', headers: writeHeaders(system, wife.id), body: { dishIds: [wings.id] } });
  assert.equal(ballot2.status, 200);
  assert.equal(ballot2.payload.data.participantCount, 2);
  assert.equal(ballot2.payload.data.candidates.find((candidate) => candidate.dishId === wings.id).votes, 2);
  const ballotReplace = await jsonRequest(base, `/api/votes/${voteId}/my-ballot`, { method: 'PUT', headers: writeHeaders(system, husband.id), body: { dishIds: [pork.id] } });
  assert.equal(ballotReplace.status, 200);
  assert.equal(ballotReplace.payload.data.participantCount, 2);
  const tie = await jsonRequest(base, `/api/votes/${voteId}/finish`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { winnerDishId: null } });
  assert.equal(tie.status, 409);
  assert.equal(tie.payload.error.code, 'TIE_REQUIRES_SELECTION');
  const finished = await jsonRequest(base, `/api/votes/${voteId}/finish`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { winnerDishId: pork.id } });
  assert.equal(finished.status, 200);
  assert.equal(finished.payload.data.winnerDishId, pork.id);

  const addVoteItem = await jsonRequest(base, `/api/votes/${voteId}/menu-item`, { method: 'POST', headers: writeHeaders(system, wife.id), body: { targetDate: '2026-09-09' } });
  assert.equal(addVoteItem.status, 200);
  const addVoteReplay = await jsonRequest(base, `/api/votes/${voteId}/menu-item`, { method: 'POST', headers: writeHeaders(system, wife.id), body: { targetDate: '2026-09-09' } });
  assert.equal(addVoteReplay.status, 200);
  assert.equal(addVoteReplay.payload.data.id, addVoteItem.payload.data.id);

  // 跨日：历史自动按原 menu_date 派生，未完成事项继续保留原日期。
  fx.setInstant('2026-09-10T08:00:00.000Z');
  const sysNext = await jsonRequest(base, '/api/system');
  assert.equal(sysNext.payload.data.today, '2026-09-10');
  const history = await jsonRequest(base, '/api/history?limit=50', { headers: { 'x-member-id': wife.id } });
  assert.equal(history.status, 200);
  assert.equal(history.payload.data.items[0].menuDate, '2026-09-09');
  assert.equal(history.payload.data.items[0].hasUnfinished, false);
  assert.equal(history.payload.data.items[0].itemNames.includes('可乐鸡翅'), false);
  const archive = await jsonRequest(base, '/api/menu?date=2026-09-09&view=archive&limit=50', { headers: { 'x-member-id': wife.id } });
  assert.equal(archive.status, 200);
  assert.ok(archive.payload.data.items.every((item) => ['completed', 'cancelled'].includes(item.status)));
  const unfinished = await jsonRequest(base, '/api/menu/unfinished?limit=50', { headers: { 'x-member-id': wife.id } });
  assert.ok(unfinished.payload.data.items.some((item) => item.id === depBatch.payload.data.menuItemIds[0] && item.menuDate === '2026-09-09'));

  // 次日重放同一成功批次仍返回原回执；旧日期首次执行则拒绝。
  const replayNextDay = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, wife.id, { 'x-idempotency-key': key }), body: batchBody });
  assert.equal(replayNextDay.status, 201);
  assert.deepEqual(replayNextDay.payload.data.menuItemIds, firstBatch.payload.data.menuItemIds);
  const staleNew = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, wife.id, { 'x-idempotency-key': 'new-stale-batch-0001' }), body: batchBody });
  assert.equal(staleNew.status, 409);
  assert.equal(staleNew.payload.error.code, 'DATE_CHANGED');

  // 同一道菜在新的菜单日期完成后，可提交新一天的评价。
  const nextBatch = await jsonRequest(base, '/api/menu/batches', { method: 'POST', headers: writeHeaders(system, wife.id, { 'x-idempotency-key': 'next-day-review-0001' }), body: { targetDate: '2026-09-10', items: [{ dishId: pork.id, note: '', sourceItemId: null }] } });
  assert.equal(nextBatch.status, 201);
  const nextItemId = nextBatch.payload.data.menuItemIds[0];
  const nextItem = (await jsonRequest(base, `/api/menu-items/${nextItemId}`, { headers: { 'x-member-id': husband.id } })).payload.data;
  const nextClaim = await jsonRequest(base, `/api/menu-items/${nextItemId}/claim`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { expectedRevision: nextItem.revision } });
  const nextComplete = await jsonRequest(base, `/api/menu-items/${nextItemId}/complete`, { method: 'POST', headers: writeHeaders(system, husband.id), body: { expectedRevision: nextClaim.payload.data.revision } });
  assert.equal(nextComplete.status, 200);
  const nextReview = await jsonRequest(base, `/api/menu-items/${nextItemId}/my-review`, { method: 'PUT', headers: writeHeaders(system, wife.id), body: { rating: 5, comment: '新的一天' } });
  assert.equal(nextReview.status, 200);
  assert.equal(nextReview.payload.data.reviewDate, '2026-09-10');

  // 原图按字节上传保存；检测 MIME 与下载原字节分离。
  const pngBytes = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.from('original-bytes')]);
  const form = new FormData();
  form.append('file', new Blob([pngBytes], { type: 'application/octet-stream' }), '原图.png');
  const uploadRes = await fetch(`${base}/api/media`, { method: 'POST', headers: writeHeaders(system, husband.id), body: form });
  const uploadPayload = await uploadRes.json();
  assert.equal(uploadRes.status, 201, JSON.stringify(uploadPayload));
  assert.equal(uploadPayload.data.detectedMime, 'image/png');
  assert.equal(uploadPayload.data.byteSize, pngBytes.length);

  const contentRes = await fetch(`${base}${uploadPayload.data.contentUrl}`);
  assert.equal(contentRes.status, 200);
  assert.equal(contentRes.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await contentRes.arrayBuffer()), pngBytes);

  const extraPart = new FormData();
  extraPart.append('file', new Blob([pngBytes], { type: 'application/octet-stream' }), '多余字段.png');
  extraPart.append('note', 'not allowed');
  const extraPartRes = await fetch(`${base}/api/media`, { method: 'POST', headers: writeHeaders(system, husband.id), body: extraPart });
  assert.equal(extraPartRes.status, 400);
  assert.equal((await extraPartRes.json()).error.code, 'INVALID_INPUT');

  const downloadRes = await fetch(`${base}${uploadPayload.data.downloadUrl}`);
  assert.equal(downloadRes.status, 200);
  assert.deepEqual(Buffer.from(await downloadRes.arrayBuffer()), pngBytes);

  // 恢复/换代后旧数据代次的写意图不能自动穿透。
  app.database.db.prepare('UPDATE app_meta SET data_epoch=? WHERE singleton=1').run('epoch_after_restore');
  const oldEpochWrite = await jsonRequest(base, '/api/menu/batches', {
    method: 'POST',
    headers: writeHeaders(system, wife.id, { 'x-idempotency-key': 'old-epoch-0000001' }),
    body: { targetDate: '2026-09-10', items: [{ dishId: pork.id, note: '', sourceItemId: null }] },
  });
  assert.equal(oldEpochWrite.status, 409);
  assert.equal(oldEpochWrite.payload.error.code, 'DATA_EPOCH_CHANGED');
});


test('收齐启用成员后停收，并列裁决、公示、历史和一次加入形成闭环', async t => {
 const fx=await startFixture(t), {base}=fx;
 const {system,members,categories}=await setupFamily(base);
 const [a,b,c]=members, headers=writeHeaders(system,a.id);
 const x=await createDish(base,system,a,categories[0].id,'投票菜甲');
 const y=await createDish(base,system,a,categories[0].id,'投票菜乙');
 const v=(await jsonRequest(base,'/api/votes',{method:'POST',headers,body:{title:'三人多选',dishIds:[x.id,y.id]}})).payload.data;
 const cast=(m,ids,note='')=>jsonRequest(base,`/api/votes/${v.id}/my-ballot`,{method:'PUT',headers:writeHeaders(system,m.id),body:{dishIds:ids,note}});
 assert.equal((await cast(a,[x.id,y.id],'两道都爱吃')).payload.data.votingClosedAt,null);
 assert.equal((await cast(b,[x.id])).payload.data.status,'active');
 const last=(await cast(c,[y.id],'想吃清淡')).payload.data;
 assert.equal(last.participantCount,3);assert.equal(last.status,'active');assert.ok(last.votingClosedAt);
 assert.equal(last.ballots.length,3);assert.equal(last.ballots.find(n=>n.memberId===a.id).note,'两道都爱吃');
 assert.equal((await cast(b,[y.id])).payload.error.code,'VOTE_CLOSED');
 assert.throws(()=>fx.app.database.db.prepare('DELETE FROM vote_ballot WHERE vote_id=?').run(v.id),/VOTE_CLOSED/);
 assert.equal((await jsonRequest(base,'/api/votes',{method:'POST',headers,body:{title:'不能并行',dishIds:[x.id,y.id]}})).status,409);
 assert.equal((await jsonRequest(base,`/api/votes/${v.id}/finish`,{method:'POST',headers:writeHeaders(system,b.id),body:{winnerDishId:x.id}})).status,403);
 assert.equal((await jsonRequest(base,`/api/votes/${v.id}/finish`,{method:'POST',headers,body:{winnerDishId:null}})).payload.error.code,'TIE_REQUIRES_SELECTION');
 assert.equal((await jsonRequest(base,`/api/votes/${v.id}/finish`,{method:'POST',headers,body:{winnerDishId:x.id}})).payload.data.status,'finished');
 const adds=await Promise.all([a,b].map(m=>jsonRequest(base,`/api/votes/${v.id}/menu-item`,{method:'POST',headers:writeHeaders(system,m.id),body:{targetDate:system.today}})));
 assert.equal(adds[0].payload.data.id,adds[1].payload.data.id);assert.equal(adds[0].payload.data.status,'pending');
 const history=(await jsonRequest(base,'/api/votes?page_size=10',{headers})).payload.data;
 assert.equal(history.total,1);assert.equal(history.items[0].ballots.length,3);
 const v2=(await jsonRequest(base,'/api/votes',{method:'POST',headers,body:{title:'唯一最高',dishIds:[x.id,y.id]}})).payload.data;
 for(const m of members)await jsonRequest(base,`/api/votes/${v2.id}/my-ballot`,{method:'PUT',headers:writeHeaders(system,m.id),body:{dishIds:[y.id]}});
 const ended=(await jsonRequest(base,`/api/votes/${v2.id}`,{headers})).payload.data;
 assert.equal(ended.status,'finished');assert.equal(ended.winnerDishId,y.id);assert.ok(ended.closedAt);
});

test('停用未投成员按当前启用成员判断自动结束，已投成员停用仍保留票',async t=>{
 const {base}=await startFixture(t);const {system,members,categories}=await setupFamily(base);const [a,b,c]=members,headers=writeHeaders(system,a.id);
 const x=await createDish(base,system,a,categories[0].id,'启停甲'),y=await createDish(base,system,a,categories[0].id,'启停乙');
 const v=(await jsonRequest(base,'/api/votes',{method:'POST',headers,body:{title:'启停规则',dishIds:[x.id,y.id]}})).payload.data;
 for(const m of [a,b])await jsonRequest(base,`/api/votes/${v.id}/my-ballot`,{method:'PUT',headers:writeHeaders(system,m.id),body:{dishIds:[x.id]}});
 assert.equal((await jsonRequest(base,`/api/members/${c.id}/status`,{method:'POST',headers,body:{active:false}})).status,200);
 assert.equal((await jsonRequest(base,`/api/votes/${v.id}`,{headers})).payload.data.status,'finished');
 await jsonRequest(base,`/api/members/${b.id}/status`,{method:'POST',headers,body:{active:false}});
 const read=(await jsonRequest(base,`/api/votes/${v.id}`,{headers})).payload.data;
 assert.equal(read.participantCount,2);assert.equal(read.ballots.length,2);
});

test('照片语音头像原字节与历史、随机草稿提交、分页及看板',async t=>{
 const {base,app,setInstant}=await startFixture(t);const {system,members,categories}=await setupFamily(base);const [a,b]=members,headers=writeHeaders(system,a.id);
 async function upload(bytes,name){const form=new FormData();form.append('file',new Blob([bytes]),name);const r=await fetch(base+'/api/media',{method:'POST',headers,body:form});const p=await r.json();assert.equal(r.status,201,JSON.stringify(p));return p.data}
 const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]),audio=Buffer.from('ID3-test-original-recording');
 const photo=await upload(png,'成品.png'),voice=await upload(audio,'留言.mp3');
 assert.deepEqual(Buffer.from(await (await fetch(base+voice.contentUrl)).arrayBuffer()),audio);
 const av=await jsonRequest(base,'/api/me/avatar',{method:'PATCH',headers,body:{avatarMediaId:photo.id}});assert.equal(av.payload.data.avatarMediaId,photo.id);
 assert.equal((await jsonRequest(base,'/api/me/avatar',{method:'PATCH',headers,body:{avatarMediaId:voice.id}})).status,400);
 for(let i=0;i<12;i++)await createDish(base,system,a,categories[0].id,'随机菜'+i);
 const list=(await jsonRequest(base,'/api/dishes?page_size=10',{headers})).payload.data;assert.equal(list.items.length,10);assert.equal(list.total,12);
 const second=(await jsonRequest(base,'/api/dishes?page_size=10&cursor='+encodeURIComponent(list.nextCursor),{headers})).payload.data;assert.equal(second.items.length,2);
 assert.equal((await jsonRequest(base,'/api/dishes?page_size=20',{headers})).status,400);
 const random=(await jsonRequest(base,'/api/dishes/random?count=3',{headers})).payload.data.items;assert.equal(new Set(random.map(x=>x.id)).size,3);
 assert.equal(app.database.db.prepare('SELECT COUNT(*) n FROM menu_item').get().n,0);
 assert.equal((await jsonRequest(base,'/api/dishes/random?count=13',{headers})).payload.error.code,'NOT_ENOUGH_DISHES');
 const body={targetDate:system.today,items:random.map(d=>({dishId:d.id,note:'少盐',noteVoiceMediaId:voice.id,sourceItemId:null}))};
 const submit=()=>jsonRequest(base,'/api/menu/batches',{method:'POST',headers:{...headers,'x-idempotency-key':'random-with-voice'},body});
 const first=(await submit()).payload.data;assert.deepEqual((await submit()).payload.data,first);
 const id=first.menuItemIds[0],getItem=async()=>(await jsonRequest(base,`/api/menu-items/${id}`,{headers})).payload.data;
 let item=await getItem();assert.equal(item.status,'pending');assert.equal(item.noteVoiceMediaId,voice.id);
 item=(await jsonRequest(base,`/api/menu-items/${id}/claim`,{method:'POST',headers:writeHeaders(system,b.id),body:{expectedRevision:item.revision,voiceMediaId:voice.id}})).payload.data;
 const completion={expectedRevision:item.revision,photoMediaIds:[photo.id],voiceMediaId:voice.id,completionNote:'第一次成功'};
 assert.equal((await jsonRequest(base,`/api/menu-items/${id}/complete`,{method:'POST',headers,body:completion})).status,403);
 const bad=await jsonRequest(base,`/api/menu-items/${id}/complete`,{method:'POST',headers:writeHeaders(system,b.id),body:{...completion,photoMediaIds:[voice.id]}});assert.equal(bad.status,400);assert.equal((await getItem()).status,'cooking');
 const good=await jsonRequest(base,`/api/menu-items/${id}/complete`,{method:'POST',headers:writeHeaders(system,b.id),body:completion});assert.equal(good.status,200);assert.deepEqual(good.payload.data.photoMediaIds,[photo.id]);
 const review=await jsonRequest(base,`/api/menu-items/${id}/my-review`,{method:'PUT',headers,body:{rating:5,comment:'好吃',voiceMediaId:voice.id}});assert.equal(review.status,200);assert.equal(review.payload.data.voiceMediaId,voice.id);assert.ok(review.payload.data.createdAt);
 assert.throws(()=>app.database.db.prepare('UPDATE review SET voice_media_id=NULL').run(),/REVIEW_IMMUTABLE/);
 assert.throws(()=>app.database.db.prepare('DELETE FROM media WHERE id=?').run(photo.id),/FOREIGN KEY/);
 setInstant('2026-09-10T08:00:00.000Z');const history=(await jsonRequest(base,'/api/history?page_size=10',{headers})).payload.data.items[0];assert.deepEqual(history.photoMediaIds,[photo.id]);assert.ok(history.cooks.includes(b.name));
 const stats=(await jsonRequest(base,'/api/dashboard',{headers})).payload.data;assert.equal(stats.totals.completed,1);assert.equal(stats.totals.pending,2);assert.equal(stats.rating.average,5);assert.equal(stats.cooks[0].memberId,b.id);
});
