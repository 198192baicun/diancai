'use strict';

const https = require('node:https');
const dns = require('node:dns').promises;
const crypto = require('node:crypto');
const { assert, appError, exactObject, MAX_MEDIA_BYTES } = require('./core.cjs');
const { requireWriteContext } = require('./db.cjs');
const { uploadMedia } = require('./media.cjs');

const PAGE_HOSTS = new Set(['xhslink.cn', 'xhslink.com', 'www.xiaohongshu.com', 'xiaohongshu.com']);
const IMAGE_DOMAINS = ['xhscdn.com'];
function publicIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}
function allowedURL(input, image = false) {
  let url;
  try { url = new URL(input); } catch { throw appError(400, 'INVALID_IMPORT_URL', '请粘贴小红书的分享链接'); }
  const allowed = image ? IMAGE_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) : PAGE_HOSTS.has(url.hostname);
  assert(allowed && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 400, 'INVALID_IMPORT_URL', '只支持小红书的公开 HTTPS 图文链接和配图');
  return url;
}
// 固定解析服务地址并保留 TLS 证书校验，避免系统 Fake-IP 再次影响解析服务。
async function resolveHTTPS(hostname) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      agent: false,
      lookup: (_host, options, cb) => options.all ? cb(null, [{ address: '1.1.1.1', family: 4 }]) : cb(null, '1.1.1.1', 4),
      headers: { Accept: 'application/dns-json' },
    }, async response => {
      try {
        if (response.statusCode !== 200) { response.resume(); throw new Error('DNS response status'); }
        let size = 0; const chunks = [];
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 65536) { response.destroy(); throw new Error('DNS response too large'); }
          chunks.push(chunk);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data.Status !== 0) throw new Error('DNS lookup failed');
        resolve((data.Answer || []).filter(row => row.type === 1).map(row => ({ address: row.data, family: 4 })));
      } catch (error) { reject(error); }
    });
    const timer = setTimeout(() => req.destroy(new Error('DNS timeout')), 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  });
}
async function resolvePublic(hostname, lookup = dns.lookup.bind(dns), fallback = resolveHTTPS) {
  let addresses;
  try { addresses = await lookup(hostname, { all: true, family: 4 }); } catch { addresses = []; }
  const valid = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row => typeof row.address === 'string' && publicIPv4(row.address));
  if (!valid(addresses)) {
    try { addresses = await fallback(hostname); } catch { addresses = []; }
  }
  assert(valid(addresses), 422, 'IMPORT_UNAVAILABLE', '无法取得小红书的安全公网地址，请检查服务端网络后重试，或使用图片导入');
  return addresses[0].address;
}
const resolutionCache = new Map();
async function cachedPublic(hostname) {
  const old=resolutionCache.get(hostname);
  if(old && old.expires>Date.now()) return old.promise;
  const entry={expires:Date.now()+30000,promise:resolvePublic(hostname)};
  resolutionCache.set(hostname,entry);
  try{return await entry.promise}catch(e){resolutionCache.delete(hostname);throw e}
}
async function orderedConcurrent(items, concurrency, work) {
  const results=new Array(items.length);let next=0,failure=null;
  async function worker(){while(!failure && next<items.length){const index=next++;try{results[index]=await work(items[index],index)}catch(e){failure=failure||e}}}
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));
  if(failure)throw failure;
  return results;
}
async function openPublic(input, image = false, hops = 0, signal) {
  assert(hops <= 5, 422, 'IMPORT_UNAVAILABLE', '分享链接跳转过多');
  const url = allowedURL(input, image);
  const address = await cachedPublic(url.hostname);
  const response = await new Promise((resolve, reject) => {
    const req = https.get(url, {
      signal,
      agent: false,
      // 固定本次已检查的地址，避免校验后再次解析到内网。
      lookup: (_host, options, callback) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4),
      headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'FamilyRecipeImporter/1.0' },
    }, resolve);
    const deadline=setTimeout(()=>req.destroy(new Error('request deadline')),25000);
    req.on('close',()=>clearTimeout(deadline));
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    assert(response.headers.location, 422, 'IMPORT_UNAVAILABLE', '分享链接跳转无效');
    return openPublic(new URL(response.headers.location, url).href, image, hops + 1, signal);
  }
  if (response.statusCode !== 200) { response.resume(); throw appError(422, 'IMPORT_UNAVAILABLE', '平台暂未提供可读取的公开图文，请改用保存图片导入'); }
  return { response, url: url.href };
}
// INITIAL_STATE 是数据，不执行其中任何 JavaScript；仅接受 JSON 和裸 undefined 值。
function parseState(raw) {
  let out = '', quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quoted) { out += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') { quoted = true; out += ch; }
    else if (raw.slice(i, i + 9) === 'undefined') { out += 'null'; i += 8; }
    else out += ch;
  }
  return JSON.parse(out.replace(/;\s*$/, ''));
}
function parseNote(html, finalURL) {
  const id = /\/(?:item|explore)\/([a-f0-9]{24})/i.exec(new URL(finalURL).pathname)?.[1];
  const match = /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/i.exec(html);
  if (!id || !match) throw appError(422, 'IMPORT_UNAVAILABLE', '此链接暂时无法自动读取完整图文。可在原应用保存教程图片，再从这里选择图片导入。');
  let state;
  try { state = parseState(match[1]); } catch { throw appError(422, 'IMPORT_UNAVAILABLE', '平台页面格式已变化，暂时无法读取'); }
  const note = state.note?.noteDetailMap?.[id]?.note;
  assert(note && note.noteId === id && note.type === 'normal', 422, 'IMPORT_UNAVAILABLE', '只支持可公开读取的图文笔记');
  const images = (note.imageList || []).map(image => image.urlDefault || image.url || '').map(url => String(url).replace(/^http:/, 'https:'));
  assert(images.length > 0 && images.length <= 50 && images.every(Boolean), 422, 'IMPORT_UNAVAILABLE', '未能获取完整配图或配图数量超出范围');
  images.forEach(url => allowedURL(url, true));
  return { title: String(note.title || ''), text: String(note.desc || ''), author: String(note.user?.nickname || ''), sourceURL: `https://www.xiaohongshu.com/explore/${id}`, images };
}
function textBlocks(text) {
  const chars = Array.from(text);
  const blocks = [];
  for (let i = 0; i < chars.length; i += 2000) blocks.push(chars.slice(i, i + 2000).join(''));
  return blocks;
}
async function importRecipe(db, headers, body, dataRoot, clock, open = openPublic) {
  exactObject(body, ['shareText']);
  requireWriteContext(db, headers);
  assert(typeof body.shareText === 'string' && body.shareText.length <= 10000, 400, 'INVALID_INPUT', '分享内容过长或无效');
  const urls = body.shareText.match(/https:\/\/[^\s<>"，。；！）)]+/g) || [];
  assert(urls.length === 1, 400, 'INVALID_IMPORT_URL', '请每次粘贴一条教程的分享链接');
  allowedURL(urls[0]);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),100000);
  if(open===openPublic)open=(url,image=false)=>openPublic(url,image,0,controller.signal);
  try {
    const { response, url } = await open(urls[0]);
    let size = 0;
    const chunks = [];
    for await (const chunk of response) { size += chunk.length; if (size > 4 * 1024 * 1024) { response.destroy(); throw appError(422, 'IMPORT_UNAVAILABLE', '平台页面过大'); } chunks.push(chunk); }
    const note = parseNote(Buffer.concat(chunks).toString('utf8'), url);
    const blocks = textBlocks(`${note.title}\n\n${note.text}`);
    assert(blocks.length + note.images.length <= 50, 422, 'IMPORT_UNAVAILABLE', '教程超过 50 个内容段，请分开整理');
    let total = 0;
    // 最多同时下载三张，结果始终按原配图顺序返回。
    const media = await orderedConcurrent(note.images,3,async (imageURL,index) => {
      requireWriteContext(db, headers);
      let opened;
      try {opened=await open(imageURL,true)} catch(error) {if(error.status)throw error;opened=await open(imageURL,true)}
      const image=opened.response;
      const boundary = crypto.randomBytes(24).toString('hex');
      const req = {
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tutorial-${index + 1}"\r\n\r\n`);
          let bytes = 0;
          for await (const chunk of image) {
            bytes += chunk.length; total += chunk.length;
            if (bytes > MAX_MEDIA_BYTES || total > 200 * 1024 * 1024) { image.destroy(); throw appError(413, 'FILE_TOO_LARGE', '单图不能超过 50 MiB，一次教程不能超过 200 MiB'); }
            yield chunk;
          }
          yield Buffer.from(`\r\n--${boundary}--\r\n`);
        },
      };
      const saved=await uploadMedia(db, headers, req, dataRoot, clock);
      assert(saved.detectedMime.startsWith('image/'),415,'UNSUPPORTED_MEDIA_TYPE','教程配图必须是图片');
      return saved;
    });
    requireWriteContext(db, headers);
    return {
      name: Array.from(note.title).slice(0, 50).join(''),
      introduction: `来源：小红书 · ${note.author}\n${note.sourceURL}\n保留公开页面图文，配图按页面提供的字节保存。`,
      coverMediaId: media[0].id,
      steps: [...blocks.map(content => ({ content, mediaId: null })), ...media.map((image, i) => ({ content: `教程原图 ${i + 1}（请查看图片内容）`, mediaId: image.id }))],
      media, sourceURL: note.sourceURL,
      notice: '已保留正文和配图顺序，请核对菜名、分类及内容后保存。配图是平台公开页面提供的版本，不能保证是作者上传前的原始文件。',
    };
  } catch (error) {
    if (error.status) throw error;
    throw appError(422, 'IMPORT_UNAVAILABLE', '平台暂时无法读取或图片下载中断，未创建菜品。请稍后重试，或使用保存图片导入。');
  } finally {clearTimeout(timer);controller.abort()}
}
module.exports = { orderedConcurrent, importRecipe, parseNote, parseState, textBlocks, allowedURL, publicIPv4, resolvePublic, openPublic };
