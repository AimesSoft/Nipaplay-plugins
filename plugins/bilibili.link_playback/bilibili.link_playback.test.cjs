const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, 'bilibili.link_playback.js'), 'utf8');
function resolver() {
  const context = vm.createContext({});
  vm.runInContext(script, context);
  return input => JSON.parse(JSON.stringify(context.pluginResolveUrl(input)));
}
function info(resolve, url, pages) {
  const start = resolve({ url });
  assert.equal(start.type, 'request');
  return resolve({ url, state: start.state, response: { status: 200,
    body: JSON.stringify({ code: 0, data: { bvid: 'BV1xx411c7mD', title: '示例标题', pages } }) } });
}
const pages = [{ cid: 11, page: 1, part: '第一话' }, { cid: 22, page: 2, part: '第二话' }];
test('unrelated and lookalike hosts are ignored', () => {
  const resolve = resolver();
  for (const url of ['https://example.com/test.mp4', 'https://www.bilibili.com.evil.test/video/BV123',
    'https://bilibili.com@evil.test/video/BV123', 'file:///tmp/test']) assert.equal(resolve({ url }), null);
});
test('single item retains original title', () => {
  const resolve = resolver();
  const selection = info(resolve, 'https://www.bilibili.com/video/BV1xx411c7mD', [pages[0]]);
  const play = resolve({ state: selection.state, selectedId: '11' });
  const result = resolve({ state: play.state, response: { status: 200, body: JSON.stringify({
    code: 0, data: { durl: [{ url: 'https://media.test/sample.mp4' }] }
  }) } });
  assert.equal(result.title, '示例标题');
  assert.equal(result.searchTitle, '示例标题');
  assert.equal(result.sourceUrl, 'https://www.bilibili.com/video/BV1xx411c7mD/?p=1');
  assert.equal(result.headers.Referer, 'https://www.bilibili.com/');
});
test('multiple items honor requested index and carry selected identity', () => {
  const resolve = resolver();
  const selection = info(resolve, 'https://m.bilibili.com/video/BV1xx411c7mD?p=2&share_source=copy', pages);
  assert.equal(selection.items.length, 2);
  assert.equal(selection.preferredId, '22');
  const play = resolve({ state: selection.state, selectedId: '22' });
  assert.match(play.request.url, /cid=22&/);
  assert.match(play.state.sourceUrl, /\?p=2$/);
  assert.match(play.state.displayTitle, /第二话/);
  assert.throws(() => resolve({ state: selection.state, selectedId: '999' }), /不存在/);
});
test('legacy identifier and short redirects resolve', () => {
  const resolve = resolver();
  assert.match(resolve({ url: 'https://www.bilibili.com/video/av170001/' }).request.url, /aid=170001$/);
  const start = resolve({ url: 'https://b23.tv/example' });
  const next = resolve({ state: start.state, response: { status: 302,
    headers: { location: 'https://www.bilibili.com/video/BV1xx411c7mD?p=2' } } });
  assert.equal(next.state.page, 2);
  assert.throws(() => resolve({ state: start.state, response: { status: 302,
    headers: { location: 'https://evil.test/' } } }), /不支持/);
});
test('redirect loops stop', () => {
  const resolve = resolver();
  let result = resolve({ url: 'https://b23.tv/loop' });
  for (let i = 0; i < 5; i++) result = resolve({ state: result.state,
    response: { status: 302, headers: { location: '/loop' } } });
  assert.throws(() => resolve({ state: result.state,
    response: { status: 302, headers: { location: '/loop' } } }), /次数过多/);
});
test('remote errors and unsupported payloads remain errors', () => {
  const resolve = resolver();
  const start = resolve({ url: 'https://www.bilibili.com/video/BV1xx411c7mD' });
  assert.throws(() => resolve({ state: start.state, response: { status: 412 } }), /HTTP 412/);
  assert.throws(() => resolve({ state: start.state, response: { status: 200, body: '<html>' } }), /有效的数据/);
  assert.throws(() => resolve({ state: start.state, response: { status: 200,
    body: '{"code":-404,"message":"missing"}' } }), /missing/);
  const selection = info(resolve, 'https://www.bilibili.com/video/BV1xx411c7mD', pages);
  const play = resolve({ state: selection.state, selectedId: '11' });
  for (const data of [{ dash: {} }, { durl: [{ url: 'https://a.test' }, { url: 'https://b.test' }] }]) {
    assert.throws(() => resolve({ state: play.state, response: { status: 200,
      body: JSON.stringify({ code: 0, data }) } }));
  }
});
