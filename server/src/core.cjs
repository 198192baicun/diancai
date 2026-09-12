'use strict';

const crypto = require('node:crypto');
const { map: CASE_FOLD_MAP, unicodeVersion: CASE_FOLD_UNICODE_VERSION } = require('./casefold-map.json');

const API_VERSION = '1.0';
const TIMEZONE = 'Asia/Shanghai';
const MAX_JSON_BYTES = 256 * 1024;
const MAX_MEDIA_BYTES = 52_428_800;

class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function appError(status, code, message, details) {
  return new AppError(status, code, message, details);
}

function assert(condition, status, code, message, details) {
  if (!condition) throw appError(status, code, message, details);
}

function codePointLength(value) {
  return Array.from(String(value)).length;
}

function cleanText(value, max, required = false, field = '内容') {
  const text = value == null ? '' : String(value).trim();
  const length = codePointLength(text);
  if ((required && length === 0) || length > max) {
    throw appError(400, 'INVALID_INPUT', `${field}${required ? '不能为空且' : ''}不能超过 ${max} 字`);
  }
  return text;
}


function cleanName(value, max, field = '名称') {
  // 产品名称显示值与判重键使用同一 NFKC 基础，避免界面继续展示兼容字符变体。
  const text = value == null ? '' : String(value).normalize('NFKC').trim();
  const length = codePointLength(text);
  if (length === 0 || length > max) {
    throw appError(400, 'INVALID_INPUT', `${field}不能为空且不能超过 ${max} 字`);
  }
  return text;
}

function normalizeName(value) {
  const input = String(value ?? '').trim().normalize('NFKC');
  let out = '';
  for (const ch of input) out += CASE_FOLD_MAP[ch] ?? ch;
  return out;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function utcNow(clock = () => new Date()) {
  return clock().toISOString();
}

function shanghaiToday(clock = () => new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(clock());
  const map = Object.create(null);
  for (const part of parts) map[part.type] = part.value;
  return `${map.year}-${map.month}-${map.day}`;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestHash(method, path, targetDate, body) {
  return sha256(`${String(method).toUpperCase()}\n${path}\n${targetDate}\n${stableJson(body)}`);
}

function parseBoolean(value, fallback = undefined) {
  if (value == null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw appError(400, 'INVALID_INPUT', '布尔参数不合法');
}

function parseInteger(value, { min, max, fallback, field = '数值' } = {}) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || (min != null && n < min) || (max != null && n > max)) {
    throw appError(400, 'INVALID_INPUT', `${field}不合法`);
  }
  return n;
}

const cursorSecret = crypto.randomBytes(32);
function encodeCursor(payload) {
  const value = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${value}.${crypto.createHmac('sha256', cursorSecret).update(value).digest('base64url')}`;
}

function decodeCursor(cursor, expectedFilterHash) {
  if (!cursor) return null;
  try {
    if (typeof cursor !== 'string' || cursor.length > 4096) throw new Error('invalid');
    const [value, signature, extra] = cursor.split('.');
    const expected = crypto.createHmac('sha256', cursorSecret).update(value).digest('base64url');
    if (extra || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('invalid');
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(payload.position) || payload.filterHash !== expectedFilterHash) throw new Error('invalid');
    return payload;
  } catch {
    throw appError(400, 'INVALID_INPUT', '分页游标无效或与筛选条件不匹配');
  }
}

function pageFromArray(items, { limit = 10, cursor = null, filter = {}, key = (item) => [item.id], descending = [] } = {}) {
  const clamped = parseInteger(limit, { min: 1, max: 50, fallback: 10, field: 'limit' });
  const filterHash = sha256(stableJson(filter));
  const payload = decodeCursor(cursor, filterHash);
  const compare = (a, b) => {
    for (let i = 0; i < a.length; i++) {
      const order = a[i] < b[i] ? -1 : a[i] > b[i] ? 1 : 0;
      if (order) return descending[i] ? -order : order;
    }
    return 0;
  };
  const ordered = [...items].sort((a, b) => compare(key(a), key(b)));
  const remaining = payload ? ordered.filter((item) => compare(key(item), payload.position) > 0) : ordered;
  const pageItems = remaining.slice(0, clamped);
  return {
    items: pageItems,
    total: items.length,
    nextCursor: remaining.length > clamped ? encodeCursor({ position: key(pageItems[pageItems.length - 1]), filterHash }) : null,
  };
}

function exactObject(body, allowedKeys) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_INPUT', '请求体必须是 JSON 对象');
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  assert(unknown.length === 0, 400, 'INVALID_INPUT', '请求体包含未定义字段', { unknownFields: unknown });
  return body;
}

function sameSemantic(a, b) {
  return stableJson(a) === stableJson(b);
}

function mediaDownloadName(name) {
  // Content-Disposition 的 filename= 使用纯 ASCII 回退名；真实 Unicode 名称由 filename*=UTF-8'' 提供。
  return String(name || 'file').replace(/[\r\n\0"\\/]/g, '_').replace(/[^\x20-\x7e]/g, '_').slice(0, 180) || 'file';
}

module.exports = {
  API_VERSION,
  TIMEZONE,
  MAX_JSON_BYTES,
  MAX_MEDIA_BYTES,
  CASE_FOLD_UNICODE_VERSION,
  AppError,
  appError,
  assert,
  codePointLength,
  cleanText,
  cleanName,
  normalizeName,
  randomId,
  utcNow,
  shanghaiToday,
  isDate,
  stableJson,
  sha256,
  requestHash,
  parseBoolean,
  parseInteger,
  encodeCursor,
  decodeCursor,
  pageFromArray,
  exactObject,
  sameSemantic,
  mediaDownloadName,
};
