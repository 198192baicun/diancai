'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePublic, allowedURL } = require('../server/src/recipe-import.cjs');

test('系统 Fake-IP 与解析失败回退至经过检查的公网地址', async () => {
  for (const lookup of [async () => [{ address: '198.18.4.54' }], async () => { throw new Error('DNS offline'); }]) {
    let calls = 0;
    assert.equal(await resolvePublic('xhslink.cn', lookup, async host => {
      calls++; assert.equal(host, 'xhslink.cn'); return [{ address: '118.195.253.242' }];
    }), '118.195.253.242');
    assert.equal(calls, 1);
  }
});

test('正常系统公网解析不调用回退服务', async () => {
  assert.equal(await resolvePublic('xhslink.cn', async () => [{ address: '118.195.253.242' }], async () => { assert.fail('unexpected fallback'); }), '118.195.253.242');
});

test('回退仍拒绝私网、保留、混合、空结果与解析服务故障', async () => {
  for (const rows of [[], [{ address: '127.0.0.1' }], [{ address: '198.18.4.54' }], [{ address: '118.195.253.242' }, { address: '192.168.1.1' }]]) {
    await assert.rejects(resolvePublic('xhslink.cn', async () => [], async () => rows), { code: 'IMPORT_UNAVAILABLE' });
  }
  await assert.rejects(resolvePublic('xhslink.cn', async () => [], async () => { throw new Error('timeout'); }), { code: 'IMPORT_UNAVAILABLE' });
});

test('小红书链接和配图白名单拒绝抖音、伪装域名、凭据与非标准端口', () => {
  assert.equal(allowedURL('https://xhslink.cn/o/example').hostname, 'xhslink.cn');
  assert.equal(allowedURL('https://sns-webpic-qc.xhscdn.com/example', true).hostname, 'sns-webpic-qc.xhscdn.com');
  for (const url of ['https://v.douyin.com/example', 'https://www.douyin.com/example', 'https://xhslink.cn.evil.com/a', 'https://user@xhslink.cn/a', 'https://xhslink.cn:444/a']) {
    assert.throws(() => allowedURL(url), { code: 'INVALID_IMPORT_URL' });
  }
  for (const domain of ['douyinpic.com', 'byteimg.com', 'douyinstatic.com']) {
    assert.throws(() => allowedURL(`https://image.${domain}/a`, true), { code: 'INVALID_IMPORT_URL' });
  }
});


test('导入配图最多三路并发，完成乱序仍按原顺序返回，失败等待在途结束',async()=>{
 const {orderedConcurrent}=require('../server/src/recipe-import.cjs');
 let active=0,max=0;const values=await orderedConcurrent([0,1,2,3,4,5],3,async i=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,(6-i)*2));active--;return i});
 assert.deepEqual(values,[0,1,2,3,4,5]);assert.equal(max,3);assert.equal(active,0);
 await assert.rejects(orderedConcurrent([0,1,2,3,4],3,async i=>{active++;try{await new Promise(r=>setTimeout(r,5));if(i===0)throw new Error('broken');return i}finally{active--}}),/broken/);
 assert.equal(active,0);
});
