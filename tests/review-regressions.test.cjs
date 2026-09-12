'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pageFromArray } = require('../server/src/core.cjs');
const { receiveSingleMultipart } = require('../server/src/media.cjs');
const { parseNote, parseState, allowedURL, publicIPv4, textBlocks } = require('../server/src/recipe-import.cjs');

function load(file, mocks, extra = {}) {
  const exports = {}; let page;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText,
    { exports, require: () => mocks, Page: p => { page = p; }, wx: {}, ...extra });
  if (page) { page.setData = function (data) { Object.assign(this.data, data); }; return page; }
  return exports;
}

test('稳定游标不会因前页条目退出筛选而漏项，拒绝篡改和跨筛选游标', () => {
  const items = ['a', 'b', 'c'].map(id => ({ id }));
  const first = pageFromArray(items, { limit: 1, filter: { status: 'pending' } });
  const next = pageFromArray(items.slice(1), { limit: 1, cursor: first.nextCursor, filter: { status: 'pending' } });
  assert.equal(next.items[0].id, 'b');
  assert.equal(next.total, 2);
  assert.throws(() => pageFromArray(items, { cursor: first.nextCursor, filter: { status: 'cooking' } }), /游标/);
  assert.throws(() => pageFromArray(items, { cursor: first.nextCursor.slice(0, -2) + '!!' }), /游标/);
});

test('上传边界在任意网络分块处均保存相同原字节，拒绝第二个部分', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diancai-upload-regression-'));
  fs.mkdirSync(path.join(root, 'uploads'));
  const pre = Buffer.from('--abc\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\n\r\n');
  const data = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(70000, 1), Buffer.from('\r\n--abcXY-not-a-boundary')]);
  const end = Buffer.from('\r\n--abc--\r\n');
  const all = Buffer.concat([pre, data, end]);
  const request = chunks => ({ headers: { 'content-type': 'multipart/form-data; boundary=abc' }, async *[Symbol.asyncIterator]() { yield* chunks; } });
  for (const cut of [1, pre.length - 1, pre.length, 65536, ...Array.from({ length: end.length }, (_, i) => pre.length + data.length + i)]) {
    const received = await receiveSingleMultipart(request([all.subarray(0, cut), all.subarray(cut)]), root);
    assert.deepEqual(fs.readFileSync(received.tempPath), data);
  }
  await assert.rejects(receiveSingleMultipart(request([Buffer.concat([pre, data, Buffer.from('\r\n--abc\r\nmore')])]), root), /只接受一个/);
});

test('连续勾选只改本地选择，一次保存包含全部候选并阻止重复点击', async () => {
  const calls = []; let resolve;
  const p = load('miniprogram/pages/vote/index.ts', { currentScope: () => 's', put: (_path, body) => { calls.push(body); return new Promise(r => { resolve = r; }); } });
  p.data.vote = { id: 'v', status: 'active', myDishIds: [] };
  p.data.candidates = [{ dishId: 'a' }, { dishId: 'b' }]; p.load = async () => {};
  p.ballot({ currentTarget: { dataset: { dish: 'a' } } }); p.ballot({ currentTarget: { dataset: { dish: 'b' } } });
  assert.equal(calls.length, 0);
  const saving = p.saveBallot(); await p.saveBallot();
  assert.equal(calls.length, 1); assert.deepEqual(Array.from(calls[0].dishIds), ['a', 'b']);
  resolve({}); await saving; assert.equal(p.data.ballotDirty, false);
});

test('搜索旧请求不覆盖新条件，列表无需等图片下载', async () => {
  const pending = [];
  const list = load('miniprogram/utils/list.ts', { get: () => new Promise(r => pending.push(r)), currentScope: () => 's' });
  const p = load('miniprogram/pages/catalog/index.ts', { ...list, getDraft: () => [], categoryTone: () => '', ratingText: () => '', loadMediaPreviewURL: () => new Promise(() => {}) });
  const first = p.loadDishes(true); p.data.q = 'new'; const second = p.loadDishes(true);
  pending[1]({ data: { items: [{ id: 'new', rating: {} }], nextCursor: null, total: 1 } }); await second;
  assert.equal(p.data.dishes[0].id, 'new');
  pending[0]({ data: { items: [{ id: 'old', rating: {} }], nextCursor: null, total: 1 } }); await first;
  assert.equal(p.data.dishes[0].id, 'new');
});

test('上传期间删除步骤不会把图片挂到下一个步骤', async () => {
  let resolve; const p = load('miniprogram/pages/dish-form/index.ts', { currentScope: () => 's', uploadMedia: () => ({ task: {}, promise: new Promise(r => { resolve = r; }) }), bytesText: () => '' });
  p.scope = 's'; p.markDirty = () => {}; p.data.steps = [{ key: 'a' }, { key: 'b' }];
  const uploading = p.upload('step', 'a', 'tmp'); p.removeStep({ currentTarget: { dataset: { index: 0 } } });
  resolve({ id: 'image-a', previewPolicy: 'inline' }); await uploading;
  assert.equal(p.data.steps[0].key, 'b'); assert.equal(p.data.steps[0].mediaId, undefined);
});

test('评价页回到前台保留尚未提交的评分和正文', async () => {
  const p = load('miniprogram/pages/review/index.ts', { currentScope:()=>null, get: async route => ({ data: route.endsWith('/reviews') ? { items: [] } : { allowedActions: ['review'] } }) }, { getApp: () => ({ globalData: { member: { id: 'm' } } }) });
  p.data.id = 'item'; p.data.rating = 5; p.data.comment = '尚未发送';
  await p.onShow(); assert.equal(p.data.rating, 5); assert.equal(p.data.comment, '尚未发送');
});

test('代次变化仍显示提示，其他成员迟到错误不触发刷新', async () => {
  let scope = 'old', shown = 0, refreshed = 0;
  const p = load('miniprogram/pages/draft/index.ts', { currentScope: () => scope, scopeForIntent: () => 'old', refreshSystem: async () => { refreshed++; scope = 'new'; } }, { wx: { showModal: () => { shown++; } }, getApp: () => ({globalData:{baseURL:'url',member:{id:'m'}}}) });
  await p.handleSubmitError({ code: 'DATA_EPOCH_CHANGED' }, {baseURL:'url',memberId:'m'}); assert.equal(shown, 1);
  await p.handleSubmitError({ code: 'DATA_EPOCH_CHANGED' }, {baseURL:'url',memberId:'m'}); assert.equal(refreshed, 1);
});

test('菜谱草稿按上下文和菜品隔离，存储失败明确抛出且不保存临时预览路径', () => {
  const values = new Map(); let scope = 'a', fail = false;
  const drafts = load('miniprogram/utils/recipe-draft.ts', { currentScope: () => scope }, { wx: { getStorageSync: k => values.get(k), setStorageSync: (k, v) => { if (fail) throw new Error('full'); values.set(k, v); } } });
  drafts.saveRecipeDraft({ id: 'dish', name: 'A', steps: [{ previewURL: 'temp' }] });
  assert.equal(drafts.getRecipeDraft('dish').steps[0].previewURL, ''); scope = 'b'; assert.equal(drafts.getRecipeDraft('dish'), null);
  fail = true; assert.throws(() => drafts.saveRecipeDraft({ id: 'dish', steps: [] }), /full/);
});

test('删除菜谱草稿须确认，隔离上下文并保留取消或存储失败的草稿', () => {
  const values = new Map(); let scope = 'a', fail = false, modal; const messages = [];
  const wx = { getStorageSync: k => values.get(k), setStorageSync: (k,v) => { if(fail) throw new Error('full'); values.set(k,v); }, showModal: options => { modal = options; }, showToast: options => messages.push(options.title) };
  const drafts = load('miniprogram/utils/recipe-draft.ts', { currentScope: () => scope }, { wx });
  for (const s of ['a','b']) for (const id of ['', 'dish']) drafts.saveRecipeDraft({id,name:id,steps:[]},s);
  const p = load('miniprogram/pages/recipe-drafts/index.ts', { ...drafts, currentScope: () => scope }, { wx });
  const remove = id => p.remove({ currentTarget: { dataset: { id } } });
  p.onShow(); remove(''); modal.success({confirm:false}); assert.equal(drafts.listRecipeDrafts().length,2);
  remove(''); fail = true; modal.success({confirm:true}); assert.equal(p.data.drafts.length,2); assert.match(messages.pop(),/删除失败/); fail = false;
  remove(''); scope = 'b'; modal.success({confirm:true}); assert.equal(drafts.listRecipeDrafts('a').length,2); assert.equal(drafts.listRecipeDrafts('b').length,2);
  scope = 'a'; p.onShow(); remove(''); modal.success({confirm:true}); assert.equal(drafts.getRecipeDraft(''),null); assert.equal(p.data.drafts.length,1);
  remove('dish'); modal.success({confirm:true}); assert.equal(p.data.drafts.length,0); p.onShow(); assert.equal(p.data.drafts.length,0);
  assert.equal(drafts.listRecipeDrafts('b').length,2);
});

test('导入只解析目标笔记、保留 undefined 字样，不执行页面脚本并拒绝内网及伪造域名', () => {
  assert.equal(parseState('{"a":undefined,"b":"undefined"}').b, 'undefined');
  assert.throws(() => parseState('{"a":(()=>42)()}'));
  const id = '123456789012345678901234';
  const note = { noteId: id, type: 'normal', title: '测试', desc: '正文', imageList: [{ urlDefault: 'http://sns-webpic-qc.xhscdn.com/image' }], user: { nickname: '作者' } };
  const result = parseNote(`<script>window.__INITIAL_STATE__=${JSON.stringify({ note: { noteDetailMap: { [id]: { note } } } })}</script>`, `https://www.xiaohongshu.com/explore/${id}`);
  assert.equal(result.images.length, 1); assert.equal(result.text, '正文');
  for (const url of ['https://127.0.0.1', 'https://www.xiaohongshu.com.evil.test/a', 'https://u:p@www.xiaohongshu.com/a', 'https://www.xiaohongshu.com:8080/a']) assert.throws(() => allowedURL(url));
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '198.18.1.1', '169.254.169.254']) assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4('8.8.8.8'), true);
  assert.equal(textBlocks('😀'.repeat(2001)).length, 2);
  assert.throws(() => parseNote('<html>登录</html>', 'https://www.douyin.com/note/123'), /无法自动读取/);
});

test('导入管线保存图片原字节与顺序，但不创建菜品；图片失败不返回成功草稿', async () => {
  const { Readable } = require('node:stream');
  const { createDatabase } = require('../server/src/db.cjs');
  const family = require('../server/src/family.cjs');
  const { importRecipe } = require('../server/src/recipe-import.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diancai-import-regression-'));
  const { db } = createDatabase({ dataRoot: root });
  try {
    const clock = () => new Date('2026-09-11T00:00:00Z');
    const system = family.setup(db, { familyName: '测试', members: [{ name: '成员' }] }, clock);
    const headers = { memberId: family.listMembers(db, {}, {})[0].id, instanceId: system.instanceId, dataEpoch: system.dataEpoch };
    const id = '123456789012345678901234';
    const imageURL = 'https://sns-webpic-qc.xhscdn.com/test';
    const note = { noteId: id, type: 'normal', title: '菜', desc: '完整正文', user: { nickname: '作者' }, imageList: [{ urlDefault: imageURL }, { urlDefault: imageURL + '2' }] };
    const html = `<script>window.__INITIAL_STATE__=${JSON.stringify({ note: { noteDetailMap: { [id]: { note } } } })}</script>`;
    const bytes = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
    const open = async (url, image) => ({ response: Readable.from([image ? bytes : Buffer.from(html)]), url: image ? url : `https://www.xiaohongshu.com/explore/${id}` });
    const result = await importRecipe(db, headers, { shareText: 'https://xhslink.cn/o/test' }, root, clock, open);
    assert.equal(result.media.length, 2); assert.equal(result.steps[1].mediaId, result.media[0].id); assert.equal(result.steps[2].mediaId, result.media[1].id);
    assert.equal(result.steps[0].content, '菜\n\n完整正文');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM dish').get().n, 0);
    for (const media of result.media) { const row = db.prepare('SELECT storage_key FROM media WHERE id=?').get(media.id); assert.deepEqual(fs.readFileSync(path.join(root, 'media', row.storage_key)), bytes); }
    await assert.rejects(importRecipe(db, headers, { shareText: 'https://xhslink.cn/o/test' }, root, clock, async (url, image) => { if (image) throw new Error('offline'); return open(url, false); }), /未创建菜品/);
  } finally { db.close(); }
});

test('菜谱冲突逐项选择后保留本机输入，版本基于最新资料继续检查', () => {
  const p = load('miniprogram/pages/dish-form/index.ts', { loadMediaPreviewURL: async () => '', currentScope: () => 's' });
  p.scope = 's'; p.markDirty = () => {}; p.loadImages = async () => {};
  Object.assign(p.data, { name: '我的菜名', categoryId: 'c', introduction: '我的简介', steps: [], categories: [{ id: 'c', name: '分类', active: true }] });
  p.showConflict({ revision: 8, name: '别人菜名', categoryId: 'c', introduction: '别人简介', estimatedMinutes: null, coverMediaId: null, steps: [] });
  assert.equal(p.data.mergeReady, false); p.mergeConflict(); assert.equal(p.data.revision, 1);
  for (const f of p.data.conflicts) p.chooseConflict({ currentTarget: { dataset: { key: f.key, choice: f.key === 'name' ? 'local' : 'remote' } } });
  p.mergeConflict(); assert.equal(p.data.name, '我的菜名'); assert.equal(p.data.introduction, '别人简介'); assert.equal(p.data.revision, 8);
});

test('导入响应迟到不会覆盖另一成员草稿，存储失败不跳转', () => {
  let saved = 0, navigated = 0;
  const p = load('miniprogram/pages/recipe-import/index.ts', { currentScope: () => 'b', saveRecipeDraft: () => { saved++; throw new Error('full'); } }, { wx: { redirectTo: () => { navigated++; } } });
  const result = { steps: [], media: [], name: '菜' };
  assert.throws(() => p.store(result, 'a'), /切换/); assert.equal(saved, 0);
  assert.throws(() => p.store(result, 'b'), /full/); assert.equal(navigated, 0);
});

test('有链接点击导入立即反馈，请求失败弹窗并允许重试', async () => {
  let rejectRequest, calls = 0, modal;
  const p = load('miniprogram/pages/recipe-import/index.ts', {
    currentScope: () => 'a', getRecipeDraft: () => null,
    request: () => { calls++; return new Promise((_resolve, reject) => { rejectRequest = reject; }); }
  }, { wx: { showModal: options => { modal = options; } } });
  p.field({ currentTarget: { dataset: { field: 'shareText' } }, detail: { value: 'https://xhslink.cn/o/AQkLjy02F52' } });
  const pending = p.importLink();
  assert.equal(p.data.busy, true); assert.match(p.data.message, /正在读取/);
  await Promise.resolve(); assert.equal(calls, 1);
  await p.importLink(); assert.equal(calls, 1);
  rejectRequest(new Error('network failure')); await pending;
  assert.equal(p.data.busy, false); assert.equal(modal.title, '未能完成导入'); assert.ok(p.data.message);
});

test('导入空输入和跳转失败均有明确反馈', async () => {
  let toast, saved = 0;
  const p = load('miniprogram/pages/recipe-import/index.ts', {
    currentScope: () => 'a', saveRecipeDraft: () => saved++
  }, { wx: { showToast: options => { toast = options; }, redirectTo: options => options.fail() } });
  await p.importLink(); assert.match(toast.title, /粘贴/); assert.equal(p.data.busy, false);
  p.store({ steps: [], media: [], name: '菜' }, 'a');
  assert.equal(saved, 1); assert.match(p.data.message, /草稿已保存/);
});


test('随机刷新不提交菜单，确认一次追加独立草稿并保留待确认保护',async()=>{
 let saved=[],redirects=0,scope='s',pending=false;
 const p=load('miniprogram/pages/random/index.ts',{currentScope:()=>scope,get:async()=>({data:{items:[{id:'a',name:'菜甲'},{id:'b',name:'菜乙'}]}}),getDraft:()=>saved,saveDraft:x=>{saved=x},getPending:()=>pending,makeLocalId:(()=>{let i=0;return()=>String(++i)})(),showError:e=>{throw e}},{wx:{navigateTo:()=>redirects++,showToast:()=>{}}});
 p.onLoad();await p.refresh();assert.equal(saved.length,0);p.confirm();assert.equal(saved.length,2);assert.equal(new Set(saved.map(x=>x.localId)).size,2);assert.equal(p.data.items.length,0);
 p.confirm();assert.equal(saved.length,2);await p.refresh();pending=true;p.confirm();assert.equal(saved.length,2);assert.equal(redirects,2);
 pending=false;scope='other';p.confirm();assert.equal(saved.length,2);
});

test('语音管理器只注册一次，录音/上传隔离成员且不会把旧回调挂到新录音',async()=>{
 let def,stopCallback,errorCallback,registrations=0,uploads=0,resolveUpload,scope='a';
 const recorder={onStop:f=>{stopCallback=f;registrations++},onError:f=>{errorCallback=f},start:()=>{},stop:()=>{}};
 const mocks={currentScope:()=>scope,uploadMedia:()=>{uploads++;return{promise:new Promise(r=>{resolveUpload=r})}},loadMediaPreviewURL:async()=>''};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../miniprogram/components/voice-note/index.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText,{exports:{},require:()=>mocks,Component:x=>{def=x},wx:{getRecorderManager:()=>recorder},Math});
 const make=()=>({data:{...def.data,disabled:false,mediaId:''},events:[],setData(x){Object.assign(this.data,x)},triggerEvent(type,detail){this.events.push({type,detail})},...def.methods});
 const a=make(),b=make();a.record();scope='b';await stopCallback({tempFilePath:'old'});assert.equal(uploads,0);assert.equal(a.data.recording,false);
 a.record();const work=stopCallback({tempFilePath:'new'});b.record();assert.equal(b.data.recording,false);assert.equal(uploads,1);scope='c';resolveUpload({id:'voice-b'});await work;assert.equal(a.events.filter(x=>x.type==='change').length,0);
 b.record();def.pageLifetimes.hide.call(b);a.record();assert.equal(a.data.recording,false);await stopCallback({tempFilePath:'hidden'});assert.equal(uploads,1);assert.equal(registrations,1);assert.equal(typeof errorCallback,'function');
});

test('语音表单绑定、所有图可放大、分页大小和底栏回归约束',()=>{
 for(const name of ['draft','review','vote','item','dish-form']){
  const text=fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.wxml'),'utf8');assert.match(text,/<voice-note[^>]+bindchange=/,name);
 }
 const list=fs.readFileSync(path.join(__dirname,'../miniprogram/utils/list.ts'),'utf8');assert.match(list,/page_size: 10/);
 const css=fs.readFileSync(path.join(__dirname,'../miniprogram/app.scss'),'utf8');assert.match(css,/button\.checkout[^}]+width:auto/);
 const files=fs.readdirSync(path.join(__dirname,'../miniprogram/pages'));
 for(const name of files){const p=path.join(__dirname,'../miniprogram/pages',name,'index.wxml');if(!fs.existsSync(p))continue;const text=fs.readFileSync(p,'utf8');for(const tag of text.match(/<image\s[^>]+>/g)||[])assert.match(tag,/(bindtap|catchtap)=/,name);assert.doesNotMatch(text,/>加载更多<|>更多评价<|>更多待处理事项</)}
});
