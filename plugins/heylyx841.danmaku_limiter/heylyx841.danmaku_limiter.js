"use strict";

const pluginManifest = {
  id: 'heylyx841.danmaku_limiter',
  name: '弹幕数量控制器',
  version: '1.0.4',
  minHostVersion: '1.10.6',
  description: '自定义每秒弹幕上限，超出后自动去重稀释',
  author: 'Heylyx841',
  permissions: ['danmaku.modify', 'ui.dialog'],
  priority: 50
};

var enabled = true;
var maxPerSec = 5;

function makeUI() {
  return [
    { id: 'toggle', title: '启用', description: '限制弹幕密度并去重', enabled: enabled },
    { id: 'limit', title: '每秒上限', description: '默认5条，可修改', textSetting: { hintText: '5', default: String(maxPerSec) } }
  ];
}

var pluginUIEntries = makeUI();

function pluginOnInitialize() {
  var s = settings.getText('enabled');
  if (s === 'true') enabled = true;
  else if (s === 'false') enabled = false;
  var n = settings.getText('limit');
  if (n) {
    var parsed = parseInt(n, 10);
    if (!isNaN(parsed) && parsed > 0) maxPerSec = parsed;
  }
  pluginUIEntries = makeUI();
}

function pluginOnDestroy() {
  dev.log('弹幕数量控制器已卸载');
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

function pluginOnEvent(e) {
  if (!enabled || e.name !== 'danmakuLoaded') return;
  
  var list = e.data && e.data.danmaku;
  if (!Array.isArray(list) || list.length === 0) return;

  // 使用稀疏数组替代 Object
  var buckets = []; 
  var minSec = Infinity;
  var maxSec = -Infinity;
  
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    // 过滤掉 time 缺失或非法的弹幕，避免污染桶
    if (!d || typeof d.time !== 'number' || isNaN(d.time)) continue;
    var sec = Math.floor(d.time);
    if (sec < minSec) minSec = sec;
    if (sec > maxSec) maxSec = sec;
    if (!buckets[sec]) buckets[sec] = [];
    buckets[sec].push(d);
  }

  // 全部弹幕都没有合法时间，直接退出
  if (minSec === Infinity) return;

  var out = [];
  
  // 按秒顺序遍历，天然保证输出按时间有序，省去最终 sort
  for (var sec = minSec; sec <= maxSec; sec++) {
    var arr = buckets[sec];
    if (!arr) continue;
    
    if (arr.length <= maxPerSec) {
      for (var j = 0; j < arr.length; j++) out.push(arr[j]);
      continue;
    }

    var seen = {};
    var deduped = [];
    for (var k = 0; k < arr.length; k++) {
      var item = arr[k];
      var key = normalize(item.content);
      if (!seen[key]) {
        seen[key] = true;
        deduped.push(item);
      }
    }

    if (deduped.length > maxPerSec) {
      var step = deduped.length / maxPerSec;
      for (var m = 0; m < maxPerSec; m++) {
        out.push(deduped[Math.floor(m * step)]);
      }
    } else {
      for (var j = 0; j < deduped.length; j++) out.push(deduped[j]);
    }
  }

  // 只有在发生实际拦截/过滤时，才触发宿主的 IPC 通信
  if (out.length !== list.length) {
    // 保证传入参数格式符合 { count, comments } 规范要求
    danmaku.replace({ count: out.length, comments: out });
    ui.showSnackBar('弹幕: ' + list.length + ' → ' + out.length);
  }
}

function pluginHandleUIAction(id) {
  if (id === 'toggle') {
    enabled = !enabled;
    settings.setText('enabled', String(enabled));
    pluginUIEntries = makeUI();
    return { type: 'text', title: '弹幕数量控制器', content: enabled ? '已开启' : '已关闭' };
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
  return null;
}