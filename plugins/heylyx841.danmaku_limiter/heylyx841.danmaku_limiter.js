"use strict";

const pluginManifest = {
  id: 'heylyx841.danmaku_limiter',
  name: '弹幕限制器',
  version: '1.1.2',
  minHostVersion: '1.10.8',
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
var mergeThreshold = 0.45;
var crossMode = true;

var SUB_DIGITS = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];

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
    { id: 'merge', title: '合并弹幕', description: '相似弹幕合并，使用原生相似度引擎', enabled: mergeEnabled },
    { id: 'crossMode', title: '跨类型合并', description: '不同类型弹幕也可合并，默认开启', enabled: crossMode },
    { id: 'bigCompat', title: '小字兼容', description: '设备无法显示₍ɴ₎下标时开启，改用(N)标注', enabled: bigCompat },
    { id: 'mergeWindow', title: '合并窗口(秒)', description: '时间窗口内的弹幕才会被合并，默认30', textSetting: { hintText: '30', default: '30' } },
    { id: 'mergeThreshold', title: '相似度阈值', description: '0.0~1.0，越高越严格，默认0.45', textSetting: { hintText: '0.45', default: '0.45' } }
  ];
}

var pluginUIEntries = makeUI();

// 恢复全部配置（从 Dart 持久化层读取）
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
    if (!isNaN(pt) && pt >= 0.0 && pt <= 1.0) mergeThreshold = pt;
  }
}

function pluginOnInitialize() {
  dev.log('弹幕限制器已初始化，配置将在首次弹幕加载时恢复');
}

function pluginOnDestroy() {
  dev.log('弹幕限制器已卸载');
}

// 弹幕类型字符串 → mode 数值（与 C++ 引擎一致）
function typeToMode(type) {
  if (type === 'top') return 1;
  if (type === 'bottom') return 2;
  return 0;
}

// 使用原生相似度引擎做模糊去重（仅保留代表，不合并不标注）
// 达到 maxPerSec 后提前终止，避免过度去重
function nativeDedup(bucket, limit) {
  // 桶内数量已不超限，无需去重
  if (bucket.length <= limit) return bucket.slice();

  if (!danmaku.similarityAvailable || !danmaku.similarityAvailable()) {
    dev.log('原生相似度引擎不可用，跳过去重');
    return bucket.slice();
  }

  var items = [];
  for (var j = 0; j < bucket.length; j++) {
    items.push({
      text: bucket[j].content || '',
      mode: typeToMode(bucket[j].type),
      time_seconds: bucket[j].time
    });
  }

  var config = {
    max_dist: 5,
    max_cosine: Math.round(mergeThreshold * 100),
    use_pinyin: true,
    cross_mode: crossMode,
    time_window: 1
  };

  var result = danmaku.checkSimilarity(items, config);
  if (!result || !result.groups || result.groups.length === 0) return bucket.slice();

  // 按组大小降序排列，优先去除大组（每组合并更多重复）
  var groups = result.groups.filter(function(g) { return g && g.length >= 2; });
  groups.sort(function(a, b) { return b.length - a.length; });

  var consumed = {};
  var removed = 0;
  var needRemove = bucket.length - limit; // 需要移除的最小数量

  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    // 已移除足够多，停止去重
    if (removed >= needRemove) break;
    // 仅保留代表 group[0]，其余标记为已消费
    for (var k = 1; k < group.length; k++) {
      consumed[group[k]] = true;
      removed++;
    }
  }

  var deduped = [];
  for (var j = 0; j < bucket.length; j++) {
    if (!consumed[j]) deduped.push(bucket[j]);
  }
  return deduped;
}

// 使用原生相似度引擎做批量查重 + 合并
function nativeMerge(list) {
  if (!danmaku.similarityAvailable || !danmaku.similarityAvailable()) {
    dev.log('原生相似度引擎不可用，跳过合并');
    return list;
  }

  var items = [];
  // itemToOrig: items 数组索引 → 原始列表索引，O(1) 反向查找
  var itemToOrig = [];
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (!d || typeof d.time !== 'number' || isNaN(d.time)) continue;
    itemToOrig.push(i);
    items.push({
      text: d.content || '',
      mode: typeToMode(d.type),
      time_seconds: d.time
    });
  }

  if (items.length === 0) return list;

  var config = {
    max_dist: 5,
    max_cosine: Math.round(mergeThreshold * 100),
    use_pinyin: true,
    cross_mode: crossMode,
    time_window: mergeWindow
  };

  var result = danmaku.checkSimilarity(items, config);
  if (!result || !result.groups || result.groups.length === 0) return list;

  // consumed: 原始列表索引集合，被合并掉的弹幕
  var consumed = {};
  // repOrigIdx: 原始列表索引集合，作为 group 代表的弹幕（已在 groups 遍历中处理）
  var repOrigIdx = {};

  var merged = [];

  for (var g = 0; g < result.groups.length; g++) {
    var group = result.groups[g];
    if (!group || group.length < 2) continue;

    var repOrig = itemToOrig[group[0]];
    var rep = list[repOrig];
    repOrigIdx[repOrig] = true;

    // 标记组内其他弹幕为已消费
    for (var k = 1; k < group.length; k++) {
      consumed[itemToOrig[group[k]]] = true;
    }

    merged.push({
      time: rep.time,
      content: toGroupLabel(group.length) + rep.content,
      type: rep.type || 'scroll',
      color: rep.color || 'rgb(255,255,255)'
    });
  }

  // 添加未被合并且非代表的弹幕
  for (var i = 0; i < list.length; i++) {
    if (consumed[i] || repOrigIdx[i]) continue;
    var d = list[i];
    if (!d || typeof d.time !== 'number' || isNaN(d.time)) {
      if (!limitEnabled) merged.push(d);
      continue;
    }
    merged.push(d);
  }

  merged.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
  return merged;
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

  // 合并：使用原生相似度引擎
  var merged;
  if (mergeEnabled) {
    try {
      merged = nativeMerge(src);
    } catch (ex) {
      dev.log('原生合并异常，回退不合并: ' + ex);
      merged = src;
    }
  } else {
    merged = src;
  }

  // 限流：先去重，再均匀pop
  var working;
  if (limitEnabled) {
    // 分离有时间/无时间的弹幕（无时间弹幕不受限流影响）
    var timed = [];
    var untimed = [];
    for (var i = 0; i < merged.length; i++) {
      var d = merged[i];
      if (d && typeof d.time === 'number' && !isNaN(d.time)) {
        timed.push(d);
      } else if (d) {
        untimed.push(d);
      }
    }

    if (timed.length === 0) {
      working = merged;
    } else {
      // 按时间排序（限流需时间有序）
      timed.sort(function(a, b) { return a.time - b.time; });

      // 按1秒窗口分桶
      var buckets = {};
      for (var i = 0; i < timed.length; i++) {
        var key = Math.floor(timed[i].time);
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(timed[i]);
      }

      var out = [];
      var sortedKeys = Object.keys(buckets).sort(function(a, b) { return +a - +b; });
      for (var k = 0; k < sortedKeys.length; k++) {
        var bucket = buckets[sortedKeys[k]];

        // 阶段1：模糊去重（合并已开启时跳过，因合并阶段已完成相似去重）
        var deduped;
        if (mergeEnabled) {
          deduped = bucket;
        } else {
          try {
            deduped = nativeDedup(bucket, maxPerSec);
          } catch (ex) {
            dev.log('模糊去重异常，回退不去重: ' + ex);
            deduped = bucket;
          }
        }

        // 阶段2：均匀pop（去重后仍超限则均匀采样）
        if (deduped.length <= maxPerSec) {
          for (var j = 0; j < deduped.length; j++) out.push(deduped[j]);
        } else {
          for (var j = 0; j < maxPerSec; j++) {
            var idx = Math.floor(j * deduped.length / maxPerSec);
            out.push(deduped[idx]);
          }
        }
      }

      // 保留无时间的弹幕
      for (var i = 0; i < untimed.length; i++) out.push(untimed[i]);

      working = out;
    }
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
    // Dart 侧已在调用此 handler 前通过 setSwitchSettingValue 设置了新值
    // 直接从 Dart 读取，避免 JS 变量与 Dart 持久化值脱同步导致翻转方向错误
    limitEnabled = settings.getSwitch('limitToggle');
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
    // 同上：从 Dart 读取已设置的新值，而非从 JS 变量翻转
    mergeEnabled = settings.getSwitch('merge');
    pluginUIEntries = makeUI();
    return { type: 'text', title: '合并弹幕', content: mergeEnabled ? '已开启' : '已关闭' };
  }
  if (id === 'crossMode') {
    crossMode = settings.getSwitch('crossMode');
    pluginUIEntries = makeUI();
    return { type: 'text', title: '跨类型合并', content: crossMode ? '已开启' : '已关闭' };
  }
  if (id === 'bigCompat') {
    bigCompat = settings.getSwitch('bigCompat');
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
    if (!isNaN(pt) && pt >= 0.0 && pt <= 1.0) mergeThreshold = pt;
    settings.setText('mergeThreshold', String(mergeThreshold));
    pluginUIEntries = makeUI();
    return { type: 'text', title: '已保存', content: '相似度阈值 ' + mergeThreshold };
  }
  return null;
}
