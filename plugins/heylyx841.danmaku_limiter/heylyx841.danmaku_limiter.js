"use strict";

const pluginManifest = {
  id: 'heylyx841.danmaku_limiter',
  name: '弹幕限制器',
  version: '1.1.1',
  minHostVersion: '1.10.7',
  description: '弹幕密度限制 + 相似弹幕合并（替代原生合并渲染）',
  author: 'Heylyx841',
  permissions: ['danmaku.modify'],
  priority: 80
};

var limitEnabled = true;
var mergeEnabled = false;
var bigCompat = false;
var maxPerSec = 5;
var mergeWindow = 30;
var mergeThreshold = 0.75;
var crossMode = false;

var SUB_DIGITS = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];

// 全角→半角映射
var WIDTH_TABLE = {
  '１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9','０':'0',
  '！':'!','＠':'@','＃':'#','＄':'$','％':'%','＾':'^','＆':'&','＊':'*',
  '（':'(','）':')','－':'-','＝':'=','＿':'_','＋':'+',
  '［':'[','］':']','｛':'{','｝':'}','；':';','：':':',
  '，':',','．':'.','／':'/','＜':'<','＞':'>','？':'?','｜':'|','～':'~',
  'ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g','ｈ':'h',
  'ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n','ｏ':'o','ｐ':'p',
  'ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t','ｕ':'u','ｖ':'v','ｗ':'w','ｘ':'x','ｙ':'y','ｚ':'z',
  'Ａ':'A','Ｂ':'B','Ｃ':'C','Ｄ':'D','Ｅ':'E','Ｆ':'F','Ｇ':'G','Ｈ':'H',
  'Ｉ':'I','Ｊ':'J','Ｋ':'K','Ｌ':'L','Ｍ':'M','Ｎ':'N','Ｏ':'O','Ｐ':'P',
  'Ｑ':'Q','Ｒ':'R','Ｓ':'S','Ｔ':'T','Ｕ':'U','Ｖ':'V','Ｗ':'W','Ｘ':'X','Ｙ':'Y','Ｚ':'Z',
  '　':' '
};

// 常见变体归一化规则，使 "233"/"2333"/"23333" 等归为同一文本
var PATTERN_ALIAS = [
  [/^23{2,}$/, '23333'],
  [/^6{2,}$/, '66666']
];

// 合并数标注，默认小字 ₍ɴ₎，兼容模式用大字 (N)
function toGroupLabel(n) {
  if (n <= 1) return '';
  if (bigCompat) return '(' + n + ')';
  var s = '';
  var num = n;
  while (num > 0) {
    s = SUB_DIGITS[num % 10] + s;
    num = Math.floor(num / 10);
  }
  return '₍' + s + '₎';
}

function makeUI() {
  return [
    { id: 'limitToggle', title: '密度限制', description: '每秒弹幕数量上限', enabled: limitEnabled },
    { id: 'limit', title: '每秒上限', description: '默认5条，可修改', textSetting: { hintText: '5', default: String(maxPerSec) } },
    { id: 'merge', title: '合并弹幕', description: '相似弹幕合并，替代原生合并渲染', enabled: mergeEnabled },
    { id: 'crossMode', title: '跨类型合并', description: '开启后不同类型弹幕也可合并', enabled: crossMode },
    { id: 'bigCompat', title: '小字兼容', description: '设备无法显示₍ɴ₎下标时开启，改用(N)标注', enabled: bigCompat },
    { id: 'mergeWindow', title: '合并窗口(秒)', description: '时间窗口内的弹幕才会被合并，默认30', textSetting: { hintText: '30', default: '30' } },
    { id: 'mergeThreshold', title: '相似度阈值', description: '0.5~1.0，越高越严格，默认0.75', textSetting: { hintText: '0.75', default: '0.75' } }
  ];
}

var pluginUIEntries = makeUI();

// 持久化开关状态
function saveSwitchConfig() {
  settings.setSwitch('limitToggle', limitEnabled);
  settings.setSwitch('merge', mergeEnabled);
  settings.setSwitch('bigCompat', bigCompat);
  settings.setSwitch('crossMode', crossMode);
}

// 恢复全部配置
function refreshConfig() {
  limitEnabled = settings.getSwitch('limitToggle');
  mergeEnabled = settings.getSwitch('merge');
  bigCompat = settings.getSwitch('bigCompat');
  crossMode = settings.getSwitch('crossMode');
  var n = settings.getText('limit');
  if (n) {
    var parsed = parseInt(n, 10);
    if (!isNaN(parsed) && parsed > 0) maxPerSec = parsed;
  }
  var mw = settings.getText('mergeWindow');
  if (mw) {
    var pw = parseFloat(mw);
    if (!isNaN(pw) && pw > 0) mergeWindow = pw;
  }
  var mt = settings.getText('mergeThreshold');
  if (mt) {
    var pt = parseFloat(mt);
    if (!isNaN(pt) && pt >= 0.5 && pt <= 1.0) mergeThreshold = pt;
  }
}

function pluginOnInitialize() {
  dev.log('弹幕限制器已初始化，配置将在首次弹幕加载时恢复');
}

function pluginOnDestroy() {
  dev.log('弹幕限制器已卸载');
}

// 手动清洗 + 压缩重复字符 + 全角半角转换 + 变体归一化，比正则快很多
function normalize(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  var s = '';
  var lastChar = '';
  var repeat = 0;
  for (var i = 0; i < text.length; i++) {
    var c = (WIDTH_TABLE[text[i]] || text[i]).toLowerCase();
    var code = c.charCodeAt(0);
    // 只保留中文、英文、数字
    var keep = (code >= 0x4e00 && code <= 0x9fa5) ||
               (code >= 0x30 && code <= 0x39) ||
               (code >= 0x61 && code <= 0x7a);
    if (!keep) continue;
    if (c === lastChar) {
      if (repeat < 1) s += c;
      repeat++;
    } else {
      lastChar = c;
      repeat = 0;
      s += c;
    }
  }
  if (s.length === 0) return '\x00' + text;
  // 变体归一化，重复压缩后应用确保模式匹配
  for (var t = 0; t < PATTERN_ALIAS.length; t++) {
    if (PATTERN_ALIAS[t][0].test(s)) { s = PATTERN_ALIAS[t][1]; break; }
  }
  return s;
}

// 相似度，短文本够用；Object.create(null) 避免原型链污染
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  // 长度差太远直接跳，省计算
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.5) return 0;
  var ba = Object.create(null);
  var countA = 0;
  for (var i = 0; i < a.length - 1; i++) {
    var gram = a.substring(i, i + 2);
    if (!ba[gram]) { ba[gram] = true; countA++; }
  }
  var bb = Object.create(null);
  var countB = 0;
  for (var j = 0; j < b.length - 1; j++) {
    var gram = b.substring(j, j + 2);
    if (!bb[gram]) { bb[gram] = true; countB++; }
  }
  var common = 0;
  for (var key in ba) {
    if (bb[key]) common++;
  }
  if (countA + countB === 0) return 0;
  return (2 * common) / (countA + countB);
}

function pluginOnEvent(e) {
  if (e.name !== 'danmakuLoaded') return;
  // 刷新配置，确保用户在设置页的修改即时生效
  refreshConfig();

  var list = e.data && e.data.danmaku;
  if (!Array.isArray(list) || list.length === 0) return;

  // 两个子功能都没开，不用处理
  if (!limitEnabled && !mergeEnabled) return;

  // 合并需时间有序；限流阶段内自行排序
  var src = mergeEnabled
    ? list.slice().sort(function(a, b) { return (a.time || 0) - (b.time || 0); })
    : list;

  // 归一化只算一次
  var norms = new Array(src.length);
  for (var i = 0; i < src.length; i++) {
    norms[i] = normalize(src[i] && src[i].content);
  }

  // 合并
  var merged;
  if (mergeEnabled) {
    var consumed = new Array(src.length);
    merged = [];
    for (var i = 0; i < src.length; i++) {
      if (consumed[i]) continue;
      var d = src[i];
      // time 非法弹幕：仅合并模式下保留，双开模式下丢弃
      if (!d || typeof d.time !== 'number' || isNaN(d.time)) {
        if (!limitEnabled) merged.push(d);
        continue;
      }

      var group = [d];
      var groupNorms = [norms[i]]; // 追踪归一化文本，用于选择频次最高的代表
      // 时间窗口内找相似弹幕，超窗口 break 省遍历
      for (var j = i + 1; j < src.length; j++) {
        if (consumed[j]) continue;
        var dj = src[j];
        if (!dj || typeof dj.time !== 'number' || isNaN(dj.time)) continue;
        if (dj.time - d.time > mergeWindow) break;
        // 跨类型检查
        if (!crossMode && dj.type !== d.type) continue;
        // 完全相同直接合并，跳过相似度计算
        if (norms[i] === norms[j]) {
          group.push(dj);
          groupNorms.push(norms[j]);
          consumed[j] = true;
          continue;
        }
        if (similarity(norms[i], norms[j]) >= mergeThreshold) {
          group.push(dj);
          groupNorms.push(norms[j]);
          consumed[j] = true;
        }
      }

      // 2条及以上才合并，选择频次最高的归一化文本对应的原文作为代表；type/color 兜底防 undefined
      if (group.length > 1) {
        var textCounts = Object.create(null);
        var bestIdx = 0, bestCount = 0;
        for (var k = 0; k < groupNorms.length; k++) {
          textCounts[groupNorms[k]] = (textCounts[groupNorms[k]] || 0) + 1;
          if (textCounts[groupNorms[k]] > bestCount) {
            bestCount = textCounts[groupNorms[k]];
            bestIdx = k;
          }
        }
        merged.push({
          time: group[0].time,
          content: toGroupLabel(group.length) + group[bestIdx].content,
          type: group[0].type || 'scroll',
          color: group[0].color || 'rgb(255,255,255)'
        });
      } else {
        merged.push(d);
      }
    }
  } else {
    merged = src;
  }

  // 限流
  var working;
  if (limitEnabled) {
    // 滑动窗口限流：消除硬分桶的秒边界效应
    var out = [];
    var workList;
    if (mergeEnabled) {
      // 已按时间排序，过滤非法时间即可
      workList = [];
      for (var i = 0; i < merged.length; i++) {
        var d = merged[i];
        if (d && typeof d.time === 'number' && !isNaN(d.time)) workList.push(d);
      }
    } else {
      // 未合并：携带 norm 后排序
      workList = [];
      for (var i = 0; i < merged.length; i++) {
        var d = merged[i];
        if (!d || typeof d.time !== 'number' || isNaN(d.time)) continue;
        workList.push({ d: d, norm: norms[i], time: d.time });
      }
      workList.sort(function(a, b) { return a.time - b.time; });
    }

    // 全部弹幕都没有合法时间，直接退出
    if (workList.length === 0) return;

    // 前向指针扫描，O(n) 替代反向遍历 O(n·w)
    var windowStart = 0;
    for (var i = 0; i < workList.length; i++) {
      var t = workList[i].time;
      // 推进窗口左边界，排除超过1秒的旧项
      while (windowStart < out.length && t - out[windowStart].time >= 1.0) windowStart++;
      var count = out.length - windowStart;
      // 未合并模式：窗口内相同归一化内容去重
      if (!mergeEnabled) {
        var norm_i = workList[i].norm;
        for (var j = windowStart; j < out.length; j++) {
          if (out[j].norm === norm_i) { count = maxPerSec; break; }
        }
      }
      if (count < maxPerSec) out.push(workList[i]);
    }
    // 未合并模式下 out 存的是 { d, norm, time } 包装，需提取弹幕
    working = mergeEnabled ? out : out.map(function(e) { return e.d; });
  } else {
    working = merged;
  }

  // 只有在发生实际拦截/过滤时，才触发宿主的 IPC 通信
  if (working.length !== list.length) {
    // 保证传入参数格式符合 { count, comments } 规范要求
    danmaku.replace({ count: working.length, comments: working });
    dev.log('收到' + list.length + '条→输出' + working.length + '条');
  } else {
    dev.log('无实际弹幕限制');
  }
}

function pluginHandleUIAction(id) {
  if (id === 'limitToggle') {
    limitEnabled = !limitEnabled;
    saveSwitchConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '密度限制', content: limitEnabled ? '已开启' : '已关闭' };
  }
  if (id === 'limit') {
    var v = settings.getText('limit');
    var parsed = parseInt(v, 10);
    // 拒绝 NaN、0 和负数，避免除零和逻辑异常
    if (!isNaN(parsed) && parsed > 0) maxPerSec = parsed;
    settings.setText('limit', String(maxPerSec));
    pluginUIEntries = makeUI();
    return { type: 'text', title: '已保存', content: '每秒最多 ' + maxPerSec + ' 条' };
  }
  if (id === 'merge') {
    mergeEnabled = !mergeEnabled;
    saveSwitchConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '合并弹幕', content: mergeEnabled ? '已开启' : '已关闭' };
  }
  if (id === 'crossMode') {
    crossMode = !crossMode;
    saveSwitchConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '跨类型合并', content: crossMode ? '已开启' : '已关闭' };
  }
  if (id === 'bigCompat') {
    bigCompat = !bigCompat;
    saveSwitchConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '小字兼容', content: bigCompat ? '已开启，使用(N)标注' : '已关闭，使用₍ɴ₎标注' };
  }
  if (id === 'mergeWindow') {
    var mw = settings.getText('mergeWindow');
    var pw = parseFloat(mw);
    if (!isNaN(pw) && pw > 0) mergeWindow = pw;
    settings.setText('mergeWindow', String(mergeWindow));
    pluginUIEntries = makeUI();
    return { type: 'text', title: '已保存', content: '合并窗口 ' + mergeWindow + ' 秒' };
  }
  if (id === 'mergeThreshold') {
    var mt = settings.getText('mergeThreshold');
    var pt = parseFloat(mt);
    if (!isNaN(pt) && pt >= 0.5 && pt <= 1.0) mergeThreshold = pt;
    settings.setText('mergeThreshold', String(mergeThreshold));
    pluginUIEntries = makeUI();
    return { type: 'text', title: '已保存', content: '相似度阈值 ' + mergeThreshold };
  }
  return null;
}
