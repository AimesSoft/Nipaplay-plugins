const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function load() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'danmaku_regex_filter.js'), 'utf8'), context);
  return context;
}

function compile(entry) {
  const parts = entry.split('/');
  assert.equal(parts.length, 3, '规则不能包含裸斜杠');
  return new RegExp(parts[1]);
}

const group = compile(load().pluginBlockWords.find(entry => entry.startsWith('加群宣传/')));
const positives = [
  '相当老实的久留美群136582408欢迎加入',
  '新番群喵1108552493', '动漫同好喵1108552493',
  '韭留美剧情吹水聚集地，705241562',
  '动漫聊天群965056896欢迎', '新番交流群390015197，欢迎进群的说～',
  '新番交流1108552493', '新番群1108552493',
  '动画交流群536494252，欢迎加入',
  'ＱＱ：１１０８５５２４９３', 'q q群：1108552493',
  '群号：１１０ ８５５ ２４９３', '新番群喵 110-855-2493',
  '动漫同好：110\u200b855\u200b2493', '1108552493 群',
  'QQ群', '加群', '扣扣：1108552493', '交流：12345',
];
const negatives = [
  '有种投资诈骗群导师的感觉了（）', '正解，开投资群组才是最赚钱的',
  '群里有你老穆谷辉？', '发牛魔的新番群', '这相当于一群T-1000了',
  '看一群未成年妹子处理黑吃黑事件 有够滑稽',
  '当年的15万相当于现在的15000星声', '当年的15万相当于15000星琼',
  '2100000？全存进去了啊，一点不给自己剩', '今天20261030, 美股很惨要撑过去 = =',
  '写实恐怖QQ', 'QQ', '韭妹QQ', '高中久姐好孤单啊QAQ',
  '日本央行继续实施QQE，每年扩张基础货币60万亿至70万亿日元',
  '我是那个纽扣', '谁来把那颗扣子拆了', '群众', '新番20261030',
  '同好', '新番交流很好看', '群1234', '交流：1234', '123456789',
];
for (const text of positives) test(`屏蔽宣传：${text}`, () => assert.equal(group.test(text), true));
for (const text of negatives) test(`保留正常讨论：${text}`, () => assert.equal(group.test(text), false));

test('全部规则可按宿主分隔格式编译，单独关闭加群规则后漏网样本恢复', () => {
  const plugin = load();
  assert.equal(plugin.pluginBlockWords.length, 7);
  plugin.pluginBlockWords.forEach(compile);
  const text = '动漫同好喵1108552493';
  assert(plugin.pluginBlockWords.some(entry => compile(entry).test(text)));
  plugin.pluginHandleUIAction('group');
  assert.equal(plugin.pluginBlockWords.length, 6);
  assert(!plugin.pluginBlockWords.some(entry => compile(entry).test(text)));
  plugin.pluginHandleUIAction('group');
  assert.equal(plugin.pluginBlockWords.length, 7);
});
