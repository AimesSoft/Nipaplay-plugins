"use strict";

const pluginManifest = {
  id: 'heylyx841.danmaku_limiter',
  name: '弹幕限制器',
  version: '1.1.0',
  minHostVersion: '1.10.6',
  description: '弹幕密度限制 + 相似弹幕合并（替代原生合并渲染）',
  author: 'Heylyx841',
  permissions: ['danmaku.modify', 'ui.dialog'],
  priority: 80
};

var enabled = true;
var limitEnabled = true;
var mergeEnabled = false;
var bigCompat = false;
var maxPerSec = 5;

// 合并参数，内置不暴露
var MERGE_WINDOW = 5;
var MERGE_THRESHOLD = 0.75;

var subDigits = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];

// 合并数标注，默认小字 ₍ɴ₎，兼容模式用大字 (N)
function toGroupLabel(n) {
  if (n <= 1) return '';
  if (bigCompat) return '(' + n + ')';
  var s = '';
  var num = n;
  while (num > 0) {
    s = subDigits[num % 10] + s;
    num = Math.floor(num / 10);
  }
  return '₍' + s + '₎';
}

function makeUI() {
  return [
    { id: 'toggle', title: '启用', description: '总开关，关闭后所有功能不生效', enabled: enabled },
    { id: 'limitToggle', title: '密度限制', description: '每秒弹幕数量上限', enabled: limitEnabled },
    { id: 'limit', title: '每秒上限', description: '默认5条，可修改', textSetting: { hintText: '5', default: String(maxPerSec) } },
    { id: 'merge', title: '合并弹幕', description: '相似弹幕合并，替代原生合并渲染', enabled: mergeEnabled },
    { id: 'bigCompat', title: '小字兼容', description: '设备无法显示₍ɴ₎下标时开启，改用(N)标注', enabled: bigCompat },
    // 用此条目将所有开关状态编码为字符串
    { id: '_cfg', title: '配置', description: '内部状态码，自动维护，勿手动修改', textSetting: { default: '1,1,0,0' } }
  ];
}

var pluginUIEntries = makeUI();

// 将开关状态编码写入 _cfg 条目
function saveSwitchConfig() {
  settings.setText('_cfg',
    (enabled ? 1 : 0) + ',' +
    (limitEnabled ? 1 : 0) + ',' +
    (mergeEnabled ? 1 : 0) + ',' +
    (bigCompat ? 1 : 0)
  );
}

// 恢复全部配置
function refreshConfig() {
  var cfg = settings.getText('_cfg');
  if (cfg) {
    var p = cfg.split(',');
    if (p.length >= 4) {
      enabled = p[0] === '1';
      limitEnabled = p[1] === '1';
      mergeEnabled = p[2] === '1';
      bigCompat = p[3] === '1';
    }
  }
  var n = settings.getText('limit');
  if (n) {
    var parsed = parseInt(n, 10);
    if (!isNaN(parsed) && parsed > 0) maxPerSec = parsed;
  }
}

function pluginOnInitialize() {
  refreshConfig();
  pluginUIEntries = makeUI();
}

function pluginOnDestroy() {
  dev.log('弹幕限制器已卸载');
}

// 手动清洗 + 压缩重复字符，比正则快很多
function normalize(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  var s = '';
  var lastChar = '';
  var repeat = 0;
  for (var i = 0; i < text.length; i++) {
    var c = text[i].toLowerCase();
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
  return s;
}

// 相似度，短文本够用
function similarity(a, b) {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  // 长度差太远直接跳，省计算
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.5) return 0;
  var ba = {};
  var countA = 0;
  for (var i = 0; i < a.length - 1; i++) {
    var gram = a.substring(i, i + 2);
    if (!ba[gram]) { ba[gram] = true; countA++; }
  }
  var bb = {};
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
  if (!enabled) return;

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
      // 时间窗口内找相似弹幕，超窗口 break 省遍历
      for (var j = i + 1; j < src.length; j++) {
        if (consumed[j]) continue;
        var dj = src[j];
        if (!dj || typeof dj.time !== 'number' || isNaN(dj.time)) continue;
        if (dj.time - d.time > MERGE_WINDOW) break;
        if (similarity(norms[i], norms[j]) >= MERGE_THRESHOLD) {
          group.push(dj);
          consumed[j] = true;
        }
      }

      // 2条及以上才合并，加标注；type/color 兜底防 undefined
      if (group.length > 1) {
        merged.push({
          time: group[0].time,
          content: toGroupLabel(group.length) + group[0].content,
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

    for (var i = 0; i < workList.length; i++) {
      var t = workList[i].time;
      // 统计已接纳列表中1秒窗口内的数量
      var count = 0;
      for (var j = out.length - 1; j >= 0; j--) {
        if (t - out[j].time < 1.0) count++;
        else break;
      }
      // 未合并模式：同时检查窗口内相似内容去重
      if (!mergeEnabled) {
        var norm_i = workList[i].norm;
        for (var j = out.length - 1; j >= 0; j--) {
          if (t - out[j].time >= 1.0) break;
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
    ui.showSnackBar('弹幕: ' + list.length + ' → ' + working.length);
  } else {
    ui.showSnackBar('无实际弹幕限制');
  }
}

function pluginHandleUIAction(id) {
  if (id === 'toggle') {
    enabled = !enabled;
    saveSwitchConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '弹幕限制器', content: enabled ? '已开启' : '已关闭' };
  }
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
  if (id === 'bigCompat') {
    bigCompat = !bigCompat;
    saveSwitchConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '小字兼容', content: bigCompat ? '已开启，使用(N)标注' : '已关闭，使用₍ɴ₎标注' };
  }
  if (id === '_cfg') {
    // 用户可能手动编辑了配置码，重新加载
    refreshConfig();
    pluginUIEntries = makeUI();
    return { type: 'text', title: '配置', content: '已重新加载配置' };
  }
  return null;
}
