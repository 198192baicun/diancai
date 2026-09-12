'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, context) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, ...context });
  return exports;
}

test('列表源码不使用 declare 或类字段初始化，项目 TypeScript 编译不输出类字段', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/utils/list.ts'), 'utf8');
  const sourceTree = ts.createSourceFile('list.ts', source, ts.ScriptTarget.Latest, true);
  function checkSource(node) {
    if (ts.isPropertyDeclaration(node)) {
      assert.equal(node.initializer, undefined, '微信预览不支持类字段初始化');
      assert.equal((node.modifiers || []).some(m => m.kind === ts.SyntaxKind.DeclareKeyword), false,
        '微信 TypeScript 插件未开启 allowDeclareFields');
    }
    ts.forEachChild(node, checkSource);
  }
  checkSource(sourceTree);
  const config = ts.readConfigFile(path.join(__dirname, '..', 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const options = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, path.join(__dirname, '..'));
  assert.equal(options.errors.length, 0);
  const js = ts.transpileModule(source, { compilerOptions: options.options }).outputText;
  const parsed = ts.createSourceFile('list.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function check(node) {
    assert.equal(ts.isPropertyDeclaration(node), false, 'TypeScript 编译产物不能包含类字段');
    ts.forEachChild(node, check);
  }
  check(parsed);
  const exports = {};
  vm.runInNewContext(js, { exports, require: () => ({}) });
  const first = new exports.ListLoader();
  const second = new exports.ListLoader();
  assert.equal(first.version, 0);
  assert.equal(first.loading, false);
  assert.equal(first.cursor, null);
  assert.equal(first.scope, null);
  assert.equal(first.items.length, 0);
  first.items.push('独立列表');
  assert.equal(second.items.length, 0);
});

test('完整列表读取第二页并拒绝跨成员拼接', async () => {
  let scope = 'a';
  const requests = [];
  const app = { globalData: { baseURL: 'http://localhost', member: { id: 'a' } } };
  const api = load('miniprogram/utils/api.ts', {
    require: () => ({ currentScope: () => scope }),
    getApp: () => app,
    wx: { request: r => requests.push(r) },
  });
  const promise = api.getAll('/api/me/orders', { limit: 50, status: 'completed' });
  requests[0].success({ statusCode: 200, data: { data: { items: Array.from({ length: 50 }, (_, id) => ({ id })), nextCursor: 'next' } } });
  await Promise.resolve();
  assert.match(requests[1].url, /status=completed.*cursor=next/);
  requests[1].success({ statusCode: 200, data: { data: { items: [{ id: 50 }], nextCursor: null } } });
  assert.equal((await promise).data.items.length, 51);
  const changed = api.getAll('/api/me/orders');
  scope = 'b';
  requests[2].success({ statusCode: 200, data: { data: { items: [], nextCursor: null } } });
  await assert.rejects(changed, /成员或家庭已切换/);
});

for (const page of ['menu', 'my-orders']) {
  test(`${page} 快速筛选时旧响应不能覆盖新列表`, async () => {
    let definition;
    const pending = [];
    const listModule = load('miniprogram/utils/list.ts', { require: () => ({ get: () => new Promise(resolve => pending.push(resolve)), currentScope: () => 'same' }) });
    load(`miniprogram/pages/${page}/index.ts`, {
      require: () => ({ ...listModule, showError: e => { throw e; } }),
      Page: p => { definition = p; },
    });
    definition.setData = function (values) { Object.assign(this.data, values); };
    const first = definition.load();
    definition.data.status = 'completed';
    const second = definition.load();
    const summary = { counts: { pending: 0, cooking: 0, completed: 1, cancelled: 0 } };
    pending[1]({ data: { items: [{ id: 'new' }], summary } });
    await second;
    pending[0]({ data: { items: [{ id: 'old' }], summary } });
    await first;
    assert.equal(definition.data.items[0].id, 'new');
    assert.equal(definition.data.loading, false);
  });
}


test('顶部头像更新与清空，迟到图片不覆盖新头像', async () => {
  let component;
  const pending = {};
  load('miniprogram/components/app-header/index.ts', {
    Component: value => { component = value; },
    require: () => ({ loadMediaPreviewURL: id => id ? new Promise(resolve => { pending[id] = resolve; }) : Promise.resolve('') }),
  });
  const header = { data: { avatarId: 'old', avatarSrc: '' }, setData(value) { Object.assign(this.data, value); } };
  const old = component.observers.avatarId.call(header, 'old');
  header.data.avatarId = 'new';
  const next = component.observers.avatarId.call(header, 'new');
  pending.new('/new.png');
  await next;
  assert.equal(header.data.avatarSrc, '/new.png');
  pending.old('/old.png');
  await old;
  assert.equal(header.data.avatarSrc, '/new.png');
  header.data.avatarId = '';
  await component.observers.avatarId.call(header, '');
  assert.equal(header.data.avatarSrc, '');
});
