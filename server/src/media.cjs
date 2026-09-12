'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  MAX_MEDIA_BYTES,
  appError,
  assert,
  randomId,
  mediaDownloadName,
  utcNow,
} = require('./core.cjs');
const { transaction, requireWriteContext } = require('./db.cjs');
const { mediaDto } = require('./dto.cjs');

const SNIFF_BYTES = 8192;
const MULTIPART_OVERHEAD_LIMIT = 1024 * 1024;

function detectImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', preview: 'inline' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { mime: 'image/png', preview: 'inline' };
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) return { mime: 'image/gif', preview: 'inline' };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', preview: 'inline' };
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return { mime: 'image/bmp', preview: 'download' };
  if (buffer.length >= 4 && (buffer.subarray(0,4).equals(Buffer.from([0x49,0x49,0x2a,0x00])) || buffer.subarray(0,4).equals(Buffer.from([0x4d,0x4d,0x00,0x2a])))) return { mime: 'image/tiff', preview: 'download' };
  if (buffer.length >= 4 && buffer.subarray(0,4).equals(Buffer.from([0,0,1,0]))) return { mime: 'image/x-icon', preview: 'download' };
  if (buffer.length >= 16 && buffer.subarray(4,8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8,16).toString('ascii');
    if (/avif|avis/.test(brand)) return { mime: 'image/avif', preview: 'download' };
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brand)) return { mime: 'image/heic', preview: 'download' };
  }
  const text = buffer.subarray(0, Math.min(buffer.length, SNIFF_BYTES)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if ((text.startsWith('<svg') || (text.startsWith('<?xml') && /<svg[\s>]/i.test(text))) && /<svg[\s>]/i.test(text)) {
    return { mime: 'image/svg+xml', preview: 'download' };
  }
  return null;
}

function detectAudio(b) {
 if(b.length>=3 && (b.toString('ascii',0,3)==='ID3' || (b[0]===255 && (b[1]&224)===224))) return {mime:'audio/mpeg',preview:'inline'};
 if(b.length>=12 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WAVE') return {mime:'audio/wav',preview:'inline'};
 return null;
}
function parseContentDisposition(value) {
  const name = /(?:^|;)\s*name="([^"]*)"/i.exec(value)?.[1] || '';
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(value)?.[1] || '';
  return { name, filename };
}

async function receiveSingleMultipart(req, dataRoot) {
  const contentType = String(req.headers['content-type'] || '');
  const boundaryMatch = /multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!boundaryMatch) throw appError(415, 'UNSUPPORTED_MEDIA_TYPE', '文件上传必须使用 multipart/form-data');
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  assert(boundary && boundary.length <= 200, 400, 'INVALID_INPUT', 'multipart boundary 不合法');
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > MAX_MEDIA_BYTES + MULTIPART_OVERHEAD_LIMIT) throw appError(413, 'FILE_TOO_LARGE', '单文件上限 50 MiB（约 52.4 MB）');

  const tempName = `${randomId('upload')}.partial`;
  const tempPath = path.join(dataRoot, 'uploads', tempName);
  const fd = fs.openSync(tempPath, 'wx', 0o600);
  const marker = Buffer.from(`\r\n--${boundary}`);
  let headerBuffer = Buffer.alloc(0);
  let bodyStarted = false;
  let bodyEnded = false;
  let tail = Buffer.alloc(0);
  let bytes = 0;
  let receivedBytes = 0;
  let sniff = Buffer.alloc(0);
  let originalName = 'image';
  const hash = crypto.createHash('sha256');

  function writeBody(buf) {
    if (!buf.length) return;
    bytes += buf.length;
    if (bytes > MAX_MEDIA_BYTES) throw appError(413, 'FILE_TOO_LARGE', '单文件上限 50 MiB（约 52.4 MB）');
    if (sniff.length < SNIFF_BYTES) sniff = Buffer.concat([sniff, buf.subarray(0, SNIFF_BYTES - sniff.length)]);
    fs.writeSync(fd, buf);
    hash.update(buf);
  }

  try {
    for await (const chunkValue of req) {
      receivedBytes += chunkValue.length;
      if (receivedBytes > MAX_MEDIA_BYTES + MULTIPART_OVERHEAD_LIMIT) throw appError(413, 'FILE_TOO_LARGE', '上传请求过大');
      if (bodyEnded) continue;
      const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
      if (!bodyStarted) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const split = headerBuffer.indexOf('\r\n\r\n');
        if (split > 64 * 1024 || (split < 0 && headerBuffer.length > 64 * 1024)) throw appError(400, 'INVALID_INPUT', 'multipart 头过大');
        if (split < 0) continue;
        const prelude = headerBuffer.subarray(0, split).toString('utf8');
        const firstLine = prelude.split('\r\n')[0];
        if (firstLine !== `--${boundary}`) throw appError(400, 'INVALID_INPUT', 'multipart 起始边界不合法');
        const headerLines = prelude.split('\r\n').slice(1);
        const headers = Object.create(null);
        for (const line of headerLines) {
          const i = line.indexOf(':');
          if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
        const disposition = parseContentDisposition(headers['content-disposition'] || '');
        if (disposition.name !== 'file' || !disposition.filename) throw appError(400, 'INVALID_INPUT', 'multipart 只接受名为 file 的单个文件');
        originalName = disposition.filename;
        bodyStarted = true;
        tail = headerBuffer.subarray(split + 4);
        headerBuffer = Buffer.alloc(0);
      } else {
        tail = Buffer.concat([tail, chunk]);
      }

      if (bodyStarted && !bodyEnded) {
        let idx = tail.indexOf(marker);
        // 文件中的相似前缀不是 MIME 分隔符，必须原样保留。
        while (idx >= 0 && tail.length >= idx + marker.length + 2) {
          const suffix = tail.subarray(idx + marker.length, idx + marker.length + 2).toString('ascii');
          if (suffix === '--' || suffix === '\r\n') break;
          idx = tail.indexOf(marker, idx + 1);
        }
        if (idx >= 0) {
          // 结束标记的后缀可能位于下一个网络数据块。
          if (tail.length < idx + marker.length + 2) continue;
          writeBody(tail.subarray(0, idx));
          const ending = tail.subarray(idx + marker.length).toString('ascii');
          if (!ending.startsWith('--')) throw appError(400, 'INVALID_INPUT', 'multipart 只接受一个 file 部分，不能包含额外字段或第二个文件');
          bodyEnded = true;
          tail = Buffer.alloc(0);
        } else {
          const keep = marker.length + 8;
          if (tail.length > keep) {
            writeBody(tail.subarray(0, tail.length - keep));
            tail = tail.subarray(tail.length - keep);
          }
        }
      }
    }
    if (!bodyStarted || !bodyEnded) throw appError(400, 'INVALID_INPUT', 'multipart 文件不完整');
    if (bytes <= 0) throw appError(415, 'UNSUPPORTED_MEDIA_TYPE', '空文件不能作为图片');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* ignore */ }
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw error;
  }

  return { tempPath, originalName, byteSize: bytes, sha256: hash.digest('hex'), sniff };
}

async function uploadMedia(db, headers, req, dataRoot, clock) {
  requireWriteContext(db, headers);
  // 上传文件的长 I/O 在数据库写事务之外完成。
  const received = await receiveSingleMultipart(req, dataRoot);
  const detected = detectImage(received.sniff) || detectAudio(received.sniff);
  if (!detected) {
    try { fs.unlinkSync(received.tempPath); } catch { /* ignore */ }
    throw appError(415, 'UNSUPPORTED_MEDIA_TYPE', '无法识别为支持的图片或语音文件');
  }
  const storageKey = randomId('mediafile');
  const finalPath = path.join(dataRoot, 'media', storageKey);
  fs.renameSync(received.tempPath, finalPath);
  try {
    const fd = fs.openSync(finalPath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch { /* rename 后文件已完整落盘；目录 fsync 由目标 Linux 运维验收覆盖。 */ }

  const id = randomId('media');
  const createdAt = utcNow(clock);
  try {
    return transaction(db, () => {
      requireWriteContext(db, headers);
      db.prepare(`INSERT INTO media(id,storage_key,original_name,detected_mime,byte_size,sha256,preview_policy,created_at)
                  VALUES(?,?,?,?,?,?,?,?)`)
        .run(id, storageKey, received.originalName, detected.mime, received.byteSize, received.sha256, detected.preview, createdAt);
      return mediaDto(db.prepare('SELECT * FROM media WHERE id=?').get(id));
    });
  } catch (error) {
    // 若数据库登记失败，保留完整最终文件作为孤儿，按停服维护规则清理，避免在线竞争删除。
    throw error;
  }
}

function getMedia(db, id) {
  const row = db.prepare('SELECT * FROM media WHERE id=?').get(id);
  if (!row) throw appError(404, 'NOT_FOUND', '图片不存在');
  return row;
}

function mediaMetadata(db, id) {
  return mediaDto(getMedia(db, id));
}

function streamMedia(db, id, dataRoot, download = false) {
  const row = getMedia(db, id);
  if (!download && row.preview_policy !== 'inline') throw appError(415, 'MEDIA_NOT_INLINE', '该原文件不支持在小程序内直接预览，请使用下载地址');
  const filePath = path.join(dataRoot, 'media', row.storage_key);
  if (!fs.existsSync(filePath)) throw appError(500, 'MEDIA_MISSING', '图片原文件缺失');
  return {
    row,
    filePath,
    headers: {
      'Content-Type': row.detected_mime,
      'Content-Length': String(row.byte_size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
      ...(download ? {
        'Content-Disposition': `attachment; filename="${mediaDownloadName(row.original_name)}"; filename*=UTF-8''${encodeURIComponent(row.original_name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
      } : {}),
    },
  };
}

module.exports = {
  detectImage,
  receiveSingleMultipart,
  uploadMedia,
  getMedia,
  mediaMetadata,
  streamMedia,
};
