'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  TIMEZONE,
  appError,
  assert,
  shanghaiToday,
  utcNow,
} = require('./core.cjs');

const SCHEMA_VERSION = 3;
const MIN_SQLITE = [3, 51, 3];

function compareVersion(actual, minimum) {
  const parts = String(actual).split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((parts[i] || 0) > minimum[i]) return 1;
    if ((parts[i] || 0) < minimum[i]) return -1;
  }
  return 0;
}

function ensureDataRoot(dataRoot, allowCreate) {
  if (!fs.existsSync(dataRoot)) {
    if (!allowCreate) throw new Error(`数据目录不存在：${dataRoot}`);
    fs.mkdirSync(dataRoot, { recursive: true, mode: 0o750 });
  }
  for (const name of ['media', 'uploads']) {
    const target = path.join(dataRoot, name);
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true, mode: 0o750 });
  }
}

function applyMigrations(db, migrationsDir) {
  const files = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    const version = Number(name.slice(0, 3));
    if (version > SCHEMA_VERSION) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
    const digest = crypto.createHash('sha256').update(sql).digest('hex');
    const hasMigrationTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration'").get();
    const applied = hasMigrationTable
      ? db.prepare('SELECT sha256 FROM schema_migration WHERE version=?').get(version)
      : null;
    if (applied) {
      if (applied.sha256 !== digest) throw new Error(`数据库迁移 ${version} 的校验值与应用不一致`);
      continue;
    }
    db.exec(sql);
    db.prepare('INSERT INTO schema_migration(version, sha256, applied_at) VALUES(?,?,?)')
      .run(version, digest, new Date().toISOString());
  }
}

function createDatabase(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || process.env.FAMILY_DATA_ROOT || path.join(__dirname, '..', '.local-data', 'current'));
  const allowCreate = options.allowCreate ?? (process.env.NODE_ENV !== 'production' || process.env.INIT_EMPTY_DATASET === '1');
  ensureDataRoot(dataRoot, allowCreate);
  const dbPath = path.join(dataRoot, 'app.db');
  if (!fs.existsSync(dbPath) && !allowCreate) throw new Error(`数据库不存在：${dbPath}`);

  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const allowUnsupported = options.allowUnsupportedSqlite ?? process.env.ALLOW_UNSUPPORTED_SQLITE === '1';
  if (production && !allowUnsupported && compareVersion(sqliteVersion, MIN_SQLITE) < 0) {
    db.close();
    throw new Error(`SQLite ${sqliteVersion} 低于项目生产门槛 3.51.3`);
  }

  const migrationsDir = options.migrationsDir || path.join(__dirname, '..', 'migrations');
  applyMigrations(db, migrationsDir);

  const userVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (userVersion > SCHEMA_VERSION) {
    db.close();
    throw new Error(`数据库 schema ${userVersion} 高于应用支持版本 ${SCHEMA_VERSION}`);
  }

  const meta = db.prepare('SELECT * FROM app_meta WHERE singleton=1').get();
  if (meta && meta.timezone !== TIMEZONE) {
    db.close();
    throw new Error(`数据库业务时区必须为 ${TIMEZONE}`);
  }

  return { db, dataRoot, dbPath, sqliteVersion, schemaVersion: SCHEMA_VERSION };
}

function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore secondary rollback error */ }
    throw error;
  }
}

function getMeta(db) {
  return db.prepare('SELECT * FROM app_meta WHERE singleton=1').get() || null;
}

function requireInitialized(db) {
  const meta = getMeta(db);
  if (!meta) throw appError(409, 'NOT_INITIALIZED', '家庭服务尚未初始化');
  return meta;
}

function memberRow(db, memberId) {
  if (!memberId) return null;
  return db.prepare('SELECT * FROM member WHERE id=?').get(memberId) || null;
}

function requireMember(db, memberId, { active = false } = {}) {
  const row = memberRow(db, memberId);
  if (!row) throw appError(403, 'FORBIDDEN', '当前成员不存在');
  if (active && !row.active) throw appError(403, 'MEMBER_INACTIVE', '当前成员已停用，请重新选择');
  return row;
}

function requireReadContext(db, headers, options = {}) {
  const meta = requireInitialized(db);
  const member = requireMember(db, headers.memberId, { active: options.active ?? false });
  return { meta, member };
}

function requireWriteContext(db, headers, options = {}) {
  const meta = requireInitialized(db);
  assert(headers.instanceId, 409, 'INSTANCE_CHANGED', '缺少或已变更服务实例标识');
  assert(headers.dataEpoch, 409, 'DATA_EPOCH_CHANGED', '缺少或已变更家庭数据代次');
  if (headers.instanceId !== meta.instance_id) throw appError(409, 'INSTANCE_CHANGED', '家庭服务实例已变化，请重新连接', { currentInstanceId: meta.instance_id });
  if (headers.dataEpoch !== meta.data_epoch) throw appError(409, 'DATA_EPOCH_CHANGED', '家庭数据已重新载入，请核对菜单后重新选择', { currentDataEpoch: meta.data_epoch });
  const member = requireMember(db, headers.memberId, { active: options.active ?? true });
  return { meta, member };
}

function responseMeta(db, requestId, clock) {
  const meta = getMeta(db);
  return {
    requestId,
    instanceId: meta ? meta.instance_id : null,
    dataEpoch: meta ? meta.data_epoch : null,
    today: shanghaiToday(clock),
  };
}

function ensureMediaExists(db, mediaId) {
  if (mediaId == null) return null;
  const row = db.prepare('SELECT * FROM media WHERE id=?').get(mediaId);
  if (!row) throw appError(400, 'INVALID_INPUT', '引用的图片不存在');
  return row;
}

function touchUpdatedAt(clock) {
  return utcNow(clock);
}

module.exports = {
  SCHEMA_VERSION,
  MIN_SQLITE,
  compareVersion,
  createDatabase,
  transaction,
  getMeta,
  requireInitialized,
  memberRow,
  requireMember,
  requireReadContext,
  requireWriteContext,
  responseMeta,
  ensureMediaExists,
  touchUpdatedAt,
};
