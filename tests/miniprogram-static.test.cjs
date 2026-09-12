'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mini = path.join(root, 'miniprogram');

function walk(dir, extension) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(target, extension));
    else if (!extension || target.endsWith(extension)) out.push(target);
  }
  return out;
}

test('app.json 声明的所有页面和全局组件文件完整', () => {
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  assert.equal(app.pages.length, 30);
  for (const page of app.pages) {
    for (const ext of ['.ts', '.wxml', '.scss', '.json']) {
      assert.ok(fs.existsSync(path.join(mini, `${page}${ext}`)), `${page}${ext} 缺失`);
    }
  }
  for (const componentPath of Object.values(app.usingComponents || {})) {
    const local = String(componentPath).replace(/^\//, '');
    for (const ext of ['.ts', '.wxml', '.scss', '.json']) {
      assert.ok(fs.existsSync(path.join(mini, `${local}${ext}`)), `${local}${ext} 缺失`);
    }
  }
  assert.deepEqual(app.tabBar.list.map((x) => x.text), ['首页', '点菜', '历史', '我的']);
});

test('正式小程序不包含浏览器演示入口、mock 数据或 wx.login 身份误用', () => {
  const source = walk(mini).filter((p) => /\.(ts|wxml|json|scss)$/.test(p)).map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  assert.equal(source.includes('__demo'), false);
  assert.equal(source.includes('演示场景'), false);
  assert.equal(source.includes('标准演示数据'), false);
  assert.equal(source.includes('wx.login'), false);
  assert.equal(source.includes('<web-view'), false);
});

test('WXML 不依赖 JavaScript String/Array 方法调用', () => {
  for (const file of walk(mini, '.wxml')) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(/\{\{[^}]*\.[A-Za-z_$][\w$]*\s*\(/.test(text), false, `${path.relative(root, file)} 含 WXML 方法调用`);
  }
});

test('小程序脚本不使用真机可能无法解析的可选链或空值合并语法', () => {
  for (const file of walk(mini, '.ts')) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file);
    assert.doesNotMatch(source, /\?\./, `${relative} 含可选链`);
    assert.doesNotMatch(source, /\?\?/, `${relative} 含空值合并`);
  }
});

test('批次提交先同步持久化原意图，待确认重试保持同一 Key 与载荷', () => {
  const draft = fs.readFileSync(path.join(mini, 'pages/draft/index.ts'), 'utf8');
  const saveIndex = draft.indexOf('savePending(intent, scope)');
  const sendIndex = draft.indexOf('await this.sendIntent(intent)');
  assert.ok(saveIndex >= 0 && sendIndex > saveIndex, '必须先落盘提交凭据再发网络请求');
  assert.match(draft, /scopeForIntent\(intent\)/);
  assert.match(draft, /baseURL: intent\.baseURL/);
  assert.match(draft, /X-Member-Id': intent\.memberId/);
  assert.match(draft, /X-Instance-Id': intent\.instanceId/);
  assert.match(draft, /X-Data-Epoch': intent\.dataEpoch/);
  assert.match(draft, /X-Idempotency-Key': intent\.key/);
  assert.match(draft, /targetDate: intent\.targetDate, items: intent\.items/);
  assert.match(draft, /currentScope\(\) !== scope/);
  assert.match(draft, /RECEIPT_NOT_FOUND/);
  assert.doesNotMatch(draft, /RECEIPT_NOT_FOUND[\s\S]{0,400}uuidV4\(/);
});

test('关键方法和路由与 HTTP 契约一致', () => {
  const vote = fs.readFileSync(path.join(mini, 'pages/vote/index.ts'), 'utf8');
  assert.match(vote, /put<Vote>\(`\/api\/votes\/\$\{encodeURIComponent\(vote\.id\)\}\/my-ballot`,\{dishIds,note:this\.data\.note,voiceMediaId:this\.data\.voiceMediaId\}\)/);
  assert.match(vote, /selectedIds\.includes/);
  assert.match(vote, /async saveBallot/);
  assert.match(vote, /ballotDirty/);
  const review = fs.readFileSync(path.join(mini, 'pages/review/index.ts'), 'utf8');
  assert.match(review, /alreadySubmitted/);
  assert.doesNotMatch(review, /rating:\s*mine\?\.rating/);
  const api = fs.readFileSync(path.join(mini, 'utils/api.ts'), 'utf8');
  assert.match(api, /X-Member-Id/);
  assert.match(api, /X-Instance-Id/);
  assert.match(api, /X-Data-Epoch/);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  assert.equal(config.setting.urlCheck, false);
});

test('列表视图不会绕过媒体元信息策略直接自动拉取原图', () => {
  const listFiles = [
    'components/menu-card/index.ts',
    'pages/catalog/index.ts',
    'pages/manage/index.ts',
    'pages/vote-form/index.ts',
    'pages/vote/index.ts',
  ];
  for (const rel of listFiles) {
    const source = fs.readFileSync(path.join(mini, rel), 'utf8');
    assert.doesNotMatch(source, /\/api\/media\/[\s\S]{0,120}\/content/, `${rel} 不应直接拼接媒体原图地址`);
  }
});

test('上传后的内联图片优先使用本机临时文件预览', () => {
  const form = fs.readFileSync(path.join(mini, 'pages/dish-form/index.ts'), 'utf8');
  const markup = fs.readFileSync(path.join(mini, 'pages/dish-form/index.wxml'), 'utf8');
  assert.match(form, /media\.previewPolicy==='inline'\?path:/);
  assert.match(markup, /binderror="coverPreviewError"/);
  assert.match(markup, /原文件已上传，但当前设备无法显示预览/);
});

test('自定义组件自行声明盒模型且双栏操作不依赖 CSS Grid', () => {
  const menuCard = fs.readFileSync(path.join(mini, 'components/menu-card/index.scss'), 'utf8');
  const appStyle = fs.readFileSync(path.join(mini, 'app.scss'), 'utf8');
  assert.match(menuCard, /:host\s*\{[^}]*width:100%/);
  assert.match(menuCard, /view, text\s*\{\s*box-sizing:border-box/);
  assert.match(appStyle, /\.split\s*\{\s*display:\s*flex/);
  assert.doesNotMatch(appStyle, /\.split\s*\{[^}]*display:\s*grid/);
});

test('菜品分类使用下拉菜单，状态筛选换行且卡片快捷操作文字居中', () => {
  const appStyle = fs.readFileSync(path.join(mini, 'app.scss'), 'utf8');
  const catalog = fs.readFileSync(path.join(mini, 'pages/catalog/index.wxml'), 'utf8');
  const catalogScript = fs.readFileSync(path.join(mini, 'pages/catalog/index.ts'), 'utf8');
  const menuCardStyle = fs.readFileSync(path.join(mini, 'components/menu-card/index.scss'), 'utf8');
  const menuCardMarkup = fs.readFileSync(path.join(mini, 'components/menu-card/index.wxml'), 'utf8');
  assert.match(catalog, /<picker[^>]*class="category-picker"[^>]*mode="selector"[^>]*bindchange="categoryChange"/);
  assert.doesNotMatch(catalog, /class="pills|chooseCategory/);
  assert.match(catalogScript, /categoryNames:\s*\['全部分类'\]/);
  assert.match(catalogScript, /categoryChange\(e:\s*WechatMiniprogram\.PickerChange\)/);
  assert.match(appStyle, /\.pills-inner\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
  assert.match(appStyle, /\.pill\s*\{[^}]*min-height:\s*88rpx/);
  for (const rel of ['pages/menu/index.wxml', 'pages/my-orders/index.wxml']) {
    const markup = fs.readFileSync(path.join(mini, rel), 'utf8');
    assert.doesNotMatch(markup, /<scroll-view[^>]*class="pills"|<scroll-view[^>]*class="[^"]*pills[^"]*"/, `${rel} 不应再隐藏溢出的筛选项`);
  }
  assert.match(menuCardMarkup, /class="mini"[^>]*aria-role="button"[\s\S]*class="mini-label"/);
  assert.match(menuCardStyle, /\.mini\s*\{[^}]*display:flex;[^}]*align-items:center;[^}]*justify-content:center/);
  assert.match(menuCardStyle, /\.mini-label\s*\{[^}]*white-space:nowrap;[^}]*text-align:center/);
});

test('菜品列表读取媒体元信息并展示允许内联的封面', () => {
  const media = fs.readFileSync(path.join(mini, 'utils/media.ts'), 'utf8');
  const catalog = fs.readFileSync(path.join(mini, 'pages/catalog/index.ts'), 'utf8');
  const menuCard = fs.readFileSync(path.join(mini, 'components/menu-card/index.ts'), 'utf8');
  assert.match(media, /previewPolicy !== 'inline'/);
  assert.match(media, /wx\.downloadFile/);
  assert.match(catalog, /loadMediaPreviewURL\(base\.coverMediaId\)/);
  assert.match(menuCard, /loadMediaPreviewURL\(mediaId\)/);
});
