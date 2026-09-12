'use strict';

const http = require('node:http');
const fs = require('node:fs');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const {
  MAX_JSON_BYTES,
  AppError,
  appError,
} = require('./core.cjs');
const { createDatabase, responseMeta } = require('./db.cjs');
const family = require('./family.cjs');
const catalog = require('./catalog.cjs');
const menu = require('./menu.cjs');
const vote = require('./vote.cjs');
const media = require('./media.cjs');
const { importRecipe } = require('./recipe-import.cjs');

function headerValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || null;
}

function contextHeaders(req) {
  return {
    memberId: headerValue(req, 'x-member-id'),
    instanceId: headerValue(req, 'x-instance-id'),
    dataEpoch: headerValue(req, 'x-data-epoch'),
  };
}

async function readJson(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw appError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 接口只接受 application/json');
  let size = 0;
  const chunks = [];
  for await (const chunkValue of req) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw appError(413, 'PAYLOAD_TOO_LARGE', 'JSON 请求体超过 256 KiB');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw appError(400, 'INVALID_INPUT', '请求体不是合法 JSON');
  }
}

function queryObject(url) {
  const out = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (Object.prototype.hasOwnProperty.call(out, key)) throw appError(400, 'INVALID_INPUT', `查询参数 ${key} 不能重复`);
    out[key] = value;
  }
  return out;
}

const QUERY_KEYS = Object.freeze({
  membersList: ['includeInactive'],
  memberDependencies: ['limit', 'cursor'],
  categoriesList: ['includeInactive'],
  dishesList: ['q', 'categoryId', 'active', 'cursor', 'limit'],
  dishReviews: ['cursor', 'limit'],
  menuList: ['date', 'status', 'view', 'cursor', 'limit'],
  menuUnfinished: ['cursor', 'limit'],
  itemReviews: ['cursor', 'limit'],
  myOrders: ['dateFrom', 'dateTo', 'status', 'cursor', 'limit'],
  myReviews: ['cursor', 'limit'],
  myTasks: ['cursor', 'limit'],
  history: ['beforeDate', 'cursor', 'limit'],
  voteHistory: ['cursor','limit'],
  randomDishes: ['count'],
});

function validateQuery(routeName, query) {
  const allowed = new Set(QUERY_KEYS[routeName] || []);
  if(allowed.has('limit')) { allowed.add('page_size'); if(query.page_size!==undefined) { if(query.page_size!=='10') throw appError(400,'INVALID_INPUT','page_size 必须为 10'); query.limit='10'; } }
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length) throw appError(400, 'INVALID_INPUT', '查询参数包含未定义字段', { unknownFields: unknown });
}

function json(res, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function allowedEnvironment(req, options) {
  const host = String(req.headers.host || '').toLowerCase();
  const allowedHosts = options.allowedHosts || (process.env.ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowedHosts.length && !allowedHosts.includes(host)) throw appError(403, 'HOST_NOT_ALLOWED', '请求 Host 不在家庭服务允许列表');
  const origin = req.headers.origin;
  const allowedOrigins = options.allowedOrigins || (process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) throw appError(403, 'ORIGIN_NOT_ALLOWED', '请求来源不在允许列表');
  return origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

function match(pathname, pattern) {
  const names = [];
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  const result = new RegExp(`^${source}$`).exec(pathname);
  if (!result) return null;
  const params = Object.create(null);
  try {
    names.forEach((name, i) => { params[name] = decodeURIComponent(result[i + 1]); });
  } catch {
    throw appError(400, 'INVALID_INPUT', '路径参数编码不合法');
  }
  return params;
}

function route(method, pathname) {
  const defs = [
    ['GET', '/health/live', 'live'],
    ['GET', '/health/ready', 'ready'],
    ['GET', '/api/system', 'system'],
    ['POST', '/api/setup', 'setup'],
    ['GET', '/api/members', 'membersList'],
    ['POST', '/api/members', 'membersCreate'],
    ['PATCH', '/api/members/:id', 'membersUpdate'],
    ['GET', '/api/members/:id/dependencies', 'memberDependencies'],
    ['POST', '/api/members/:id/status', 'memberStatus'],
    ['GET', '/api/categories', 'categoriesList'],
    ['POST', '/api/categories', 'categoriesCreate'],
    ['PATCH', '/api/categories/:id', 'categoriesUpdate'],
    ['POST', '/api/categories/:id/status', 'categoryStatus'],
    ['PATCH', '/api/family', 'familyRename'],
    ['GET', '/api/dishes', 'dishesList'],
    ['GET', '/api/dishes/random', 'randomDishes'],
    ['GET', '/api/dashboard', 'dashboard'],
    ['PATCH', '/api/me/avatar', 'avatar'],
    ['GET', '/api/dishes/:id', 'dishGet'],
    ['POST', '/api/dishes', 'dishCreate'],
    ['PUT', '/api/dishes/:id', 'dishUpdate'],
    ['POST', '/api/dishes/:id/status', 'dishStatus'],
    ['GET', '/api/dishes/:id/reviews', 'dishReviews'],
    ['GET', '/api/menu', 'menuList'],
    ['GET', '/api/menu/unfinished', 'menuUnfinished'],
    ['POST', '/api/menu/batches', 'menuBatch'],
    ['GET', '/api/menu/batches/receipts/:key', 'menuReceipt'],
    ['GET', '/api/menu-items/:id', 'menuItemGet'],
    ['PATCH', '/api/menu-items/:id/note', 'menuItemNote'],
    ['POST', '/api/menu-items/:id/claim', 'menuItemClaim'],
    ['POST', '/api/menu-items/:id/unclaim', 'menuItemUnclaim'],
    ['POST', '/api/menu-items/:id/complete', 'menuItemComplete'],
    ['POST', '/api/menu-items/:id/cancel', 'menuItemCancel'],
    ['GET', '/api/menu-items/:id/reviews', 'itemReviews'],
    ['PUT', '/api/menu-items/:id/my-review', 'itemMyReview'],
    ['GET', '/api/me/orders', 'myOrders'],
    ['GET', '/api/me/reviews', 'myReviews'],
    ['GET', '/api/me/tasks', 'myTasks'],
    ['GET', '/api/history', 'history'],
    ['GET', '/api/votes/entry', 'voteEntry'],
    ['GET', '/api/votes', 'voteHistory'],
    ['GET', '/api/votes/:id', 'voteGet'],
    ['POST', '/api/votes', 'voteCreate'],
    ['PUT', '/api/votes/:id/my-ballot', 'voteBallot'],
    ['POST', '/api/votes/:id/finish', 'voteFinish'],
    ['POST', '/api/votes/:id/cancel', 'voteCancel'],
    ['POST', '/api/votes/:id/menu-item', 'voteAddItem'],
    ['POST', '/api/media', 'mediaUpload'],
    ['POST', '/api/recipe-imports', 'recipeImport'],
    ['GET', '/api/media/:id', 'mediaGet'],
    ['GET', '/api/media/:id/content', 'mediaContent'],
    ['GET', '/api/media/:id/download', 'mediaDownload'],
  ];
  for (const [m, pattern, name] of defs) {
    if (m !== method) continue;
    const params = match(pathname, pattern);
    if (params) return { name, params };
  }
  return null;
}

function createApp(options = {}) {
  const clock = options.clock || (() => new Date());
  const database = options.database || createDatabase(options.databaseOptions || options);
  const { db, dataRoot } = database;

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    let corsHeaders = {};
    try {
      corsHeaders = allowedEnvironment(req, options);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...corsHeaders,
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,X-Member-Id,X-Instance-Id,X-Data-Epoch,X-Idempotency-Key',
          'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
      }
      const url = new URL(req.url || '/', 'http://family-meal.local');
      const found = route(req.method || 'GET', url.pathname);
      if (!found) throw appError(404, 'NOT_FOUND', '接口不存在');
      const headers = contextHeaders(req);
      const query = queryObject(url);
      validateQuery(found.name, query);
      let data;
      let status = 200;

      switch (found.name) {
        case 'live': data = { status: 'alive' }; break;
        case 'ready': {
          db.prepare('SELECT 1').get();
          data = { status: 'ready' };
          break;
        }
        case 'system': data = family.system(db, clock); break;
        case 'setup': data = family.setup(db, await readJson(req), clock); status = 201; break;
        case 'membersList': data = family.listMembers(db, headers, query); break;
        case 'membersCreate': data = family.saveMember(db, headers, await readJson(req), null, clock); status = 201; break;
        case 'membersUpdate': data = family.saveMember(db, headers, await readJson(req), found.params.id, clock); break;
        case 'memberDependencies': data = family.memberDependencies(db, headers, found.params.id, query); break;
        case 'memberStatus': data = family.setMemberStatus(db, headers, found.params.id, await readJson(req), clock); break;
        case 'categoriesList': data = family.listCategories(db, headers, query); break;
        case 'categoriesCreate': data = family.saveCategory(db, headers, await readJson(req), null, clock); status = 201; break;
        case 'categoriesUpdate': data = family.saveCategory(db, headers, await readJson(req), found.params.id, clock); break;
        case 'categoryStatus': data = family.setCategoryStatus(db, headers, found.params.id, await readJson(req)); break;
        case 'familyRename': data = family.renameFamily(db, headers, await readJson(req)); break;
        case 'dishesList': data = catalog.listDishes(db, headers, query); break;
        case 'dishGet': data = catalog.getDish(db, headers, found.params.id); break;
        case 'dishCreate': data = catalog.saveDish(db, headers, await readJson(req), null, clock); status = 201; break;
        case 'dishUpdate': data = catalog.saveDish(db, headers, await readJson(req), found.params.id, clock); break;
        case 'dishStatus': data = catalog.setDishStatus(db, headers, found.params.id, await readJson(req), clock); break;
        case 'dishReviews': data = catalog.dishReviews(db, headers, found.params.id, query); break;
        case 'menuList': data = menu.listMenu(db, headers, query); break;
        case 'menuUnfinished': data = menu.unfinished(db, headers, query, clock); break;
        case 'menuBatch': data = menu.batchSubmit(db, headers, headerValue(req, 'x-idempotency-key'), await readJson(req), clock); status = 201; break;
        case 'menuReceipt': data = menu.getReceipt(db, headers, found.params.key); break;
        case 'menuItemGet': data = menu.getMenuItem(db, headers, found.params.id); break;
        case 'menuItemNote': data = menu.mutateMenuItem(db, headers, found.params.id, await readJson(req), 'note', clock); break;
        case 'menuItemClaim': data = menu.mutateMenuItem(db, headers, found.params.id, await readJson(req), 'claim', clock); break;
        case 'menuItemUnclaim': data = menu.mutateMenuItem(db, headers, found.params.id, await readJson(req), 'unclaim', clock); break;
        case 'menuItemComplete': data = menu.mutateMenuItem(db, headers, found.params.id, await readJson(req), 'complete', clock); break;
        case 'menuItemCancel': data = menu.mutateMenuItem(db, headers, found.params.id, await readJson(req), 'cancel', clock); break;
        case 'itemReviews': data = menu.itemReviews(db, headers, found.params.id, query); break;
        case 'itemMyReview': data = menu.putMyReview(db, headers, found.params.id, await readJson(req), clock); break;
        case 'myOrders': data = menu.myOrders(db, headers, query); break;
        case 'myTasks': data = menu.myTasks(db, headers, query); break;
        case 'myReviews': data = menu.myReviews(db, headers, query); break;
        case 'history': data = menu.history(db, headers, query, clock); break;
        case 'voteHistory': data=vote.voteHistory(db,headers,query); break;
        case 'randomDishes': data=require('./insights.cjs').randomDishes(db,headers,query); break;
        case 'dashboard': data=require('./insights.cjs').dashboard(db,headers,clock); break;
        case 'avatar': data=require('./insights.cjs').avatar(db,headers,await readJson(req)); break;
        case 'voteEntry': data = vote.voteEntry(db, headers); break;
        case 'voteGet': data = vote.getVote(db, headers, found.params.id); break;
        case 'voteCreate': data = vote.startVote(db, headers, await readJson(req), clock); status = 201; break;
        case 'voteBallot': data = vote.ballot(db, headers, found.params.id, await readJson(req), clock); break;
        case 'voteFinish': data = vote.finishVote(db, headers, found.params.id, await readJson(req), clock); break;
        case 'voteCancel': data = vote.cancelVote(db, headers, found.params.id, await readJson(req), clock); break;
        case 'voteAddItem': data = vote.addWinnerToMenu(db, headers, found.params.id, await readJson(req), clock); break;
        case 'recipeImport': data = await importRecipe(db, headers, await readJson(req), dataRoot, clock); break;
        case 'mediaUpload': data = await media.uploadMedia(db, headers, req, dataRoot, clock); status = 201; break;
        case 'mediaGet': data = media.mediaMetadata(db, found.params.id); break;
        case 'mediaContent':
        case 'mediaDownload': {
          const result = media.streamMedia(db, found.params.id, dataRoot, found.name === 'mediaDownload');
          res.writeHead(200, { ...corsHeaders, ...result.headers });
          fs.createReadStream(result.filePath).pipe(res);
          return;
        }
        default: throw appError(500, 'INTERNAL_ERROR', '路由尚未实现');
      }

      const isHealth = found.name === 'live' || found.name === 'ready';
      const payload = isHealth ? data : { data, meta: responseMeta(db, requestId, clock) };
      json(res, status, payload, corsHeaders);
      if (options.logger !== false && !isHealth) {
        console.log(JSON.stringify({ time: new Date().toISOString(), requestId, method: req.method, path: url.pathname, status, durationMs: Date.now() - started }));
      }
    } catch (error) {
      const e = error instanceof AppError ? error : appError(500, 'INTERNAL_ERROR', '服务器内部错误');
      const payload = {
        error: { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) },
        meta: responseMeta(db, requestId, clock),
      };
      if (!res.headersSent) json(res, e.status, payload, corsHeaders);
      else res.destroy();
      if (options.logger !== false) {
        console.error(JSON.stringify({ time: new Date().toISOString(), requestId, method: req.method, path: req.url, status: e.status, code: e.code, durationMs: Date.now() - started, ...(e.status >= 500 ? { cause: error?.message } : {}) }));
      }
    }
  });

  server.on('close', () => {
    if (!options.database) {
      try { db.close(); } catch { /* ignore */ }
    }
  });
  return { server, database };
}

module.exports = { createApp, readJson, contextHeaders, match, validateQuery };
