const pluginManifest = {
  id: 'better_danmaku_filter',
  name: '智能弹幕精选',
  version: '1.1.2',
  minHostVersion: '1.10.6',
  description: '智能精选弹幕，过滤低质量弹幕，保留优质内容',
  author: 'Retr0',
  permissions: ['danmaku.modify', 'ui.dialog'],
  priority: 40
};

var params = {
  ratio: 30,
  expectedDanmakuCount: 0,
  windowSec: 5,
  minLen: 3,
  repeatThreshold: 60,
  penalty: 30,
  filterDuplicate: true,
  filterSpam: true,
  filterShort: true,
  filterNoise: true,
  allowEmoji: true,
  filterAdvanced: true
};

function loadParams() {
  params.ratio = parseInt(settings.getText('ratio')) || 30;
  params.expectedDanmakuCount = parseInt(settings.getText('expectedDanmakuCount')) || 0;
  params.windowSec = parseInt(settings.getText('windowSec')) || 5;
  params.minLen = parseInt(settings.getText('minLen')) || 3;
  params.repeatThreshold = parseInt(settings.getText('repeatThreshold')) || 60;
  params.penalty = parseInt(settings.getText('penalty')) || 30;
  params.filterDuplicate = settings.getText('filterDuplicate') === 'true';
  params.filterSpam = settings.getText('filterSpam') === 'true';
  params.filterShort = settings.getText('filterShort') === 'true';
  params.filterNoise = settings.getText('filterNoise') === 'true';
  params.allowEmoji = settings.getText('allowEmoji') === 'true';
  params.filterAdvanced = settings.getText('filterAdvanced') === 'true';
}

function buildUIEntries() {
  return [
    {
      id: 'expectedDanmakuCount',
      title: '期望弹幕数',
      description: '目标保留弹幕数（以千为单位，0表示使用最终保留比例）',
      textSetting: { hintText: '0', default: '0' }
    },
    {
      id: 'ratio',
      title: '最终保留比例',
      description: '保留弹幕的百分比（5-80）',
      textSetting: { hintText: '30', default: '30' }
    },
    {
      id: 'windowSec',
      title: '时间窗口',
      description: '去重时间窗口（秒）（1-30）',
      textSetting: { hintText: '5', default: '5' }
    },
    {
      id: 'minLen',
      title: '最短弹幕长度',
      description: '弹幕最小字符数（1-10）',
      textSetting: { hintText: '3', default: '3' }
    },
    {
      id: 'repeatThreshold',
      title: '重复字符阈值',
      description: '重复字符占比阈值（30-100）',
      textSetting: { hintText: '60', default: '60' }
    },
    {
      id: 'penalty',
      title: '全英数惩罚',
      description: '全英文/数字弹幕惩罚值（0-80）',
      textSetting: { hintText: '30', default: '30' }
    },
    {
      id: 'filterDuplicate',
      title: '过滤相似弹幕',
      description: '过滤编辑距离相似的弹幕',
      enabled: params.filterDuplicate
    },
    {
      id: 'filterSpam',
      title: '过滤刷屏弹幕',
      description: '过滤短时间内重复发送的弹幕',
      enabled: params.filterSpam
    },
    {
      id: 'filterShort',
      title: '过滤过短弹幕',
      description: '过滤长度小于阈值的弹幕',
      enabled: params.filterShort
    },
    {
      id: 'filterNoise',
      title: '过滤无意义短串',
      description: '过滤无意义的短数字/字母串（如 111、aaa、123），保留常见网络用语',
      enabled: params.filterNoise
    },
    {
      id: 'allowEmoji',
      title: '允许纯Emoji降权',
      description: '纯Emoji弹幕适当降权而非直接过滤',
      enabled: params.allowEmoji
    },
    {
      id: 'filterAdvanced',
      title: '高级语义评分',
      description: '启用多样性加权和时间分布优化',
      enabled: params.filterAdvanced
    }
  ];
}

var pluginUIEntries = buildUIEntries();

function charDiversity(s) {
  if (!s.length) return 0;
  var set = {};
  for (var i = 0; i < s.length; i++) {
    set[s[i]] = true;
  }
  return Object.keys(set).length / s.length;
}

function isPureEmoji(s) {
  var noEmoji = s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2B00}-\u{2BFF}]/gu, '').trim();
  return noEmoji.length === 0 && s.length > 0;
}

function isPureAlphaNum(s) {
  return /^[a-zA-Z0-9\s]+$/.test(s.trim());
}

function isPureDigits(s) {
  return /^[0-9\s]+$/.test(s.trim());
}

function isPureLetters(s) {
  return /^[a-zA-Z\s]+$/.test(s.trim());
}

function hasCJK(s) {
  return /[一-鿿㐀-䶿]/.test(s);
}

// 常见有意义的纯英文/数字网络用语，命中后不被当作无意义短串过滤
var MEANINGFUL_ALPHANUM = {
  '666': 1, '6666': 1, '66666': 1,
  '999': 1, '996': 1,
  '888': 1, '777': 1, '555': 1, '111': 1,
  '233': 1, '2333': 1, '23333': 1,
  'hhh': 1, 'hhhh': 1, 'hhhhh': 1, 'haha': 1, 'hahaha': 1,
  'lol': 1, 'lolol': 1, 'lmao': 1,
  'gg': 1, 'nb': 1,
  'qaq': 1, 'qwq': 1, 'qwp': 1, 'tvt': 1,
  'awsl': 1, 'xswl': 1, 'yyds': 1, 'kksk': 1, 'kkp': 1,
  'ojbk': 1, 'wdnmd': 1, 'omg': 1,
  'thx': 1, 'ok': 1
};

// 优质弹幕常见关键词，命中给予加分，引导精选偏好
var QUALITY_KEYWORDS = [
  '前方高能', '高能', '预警', '名场面', '彩蛋', '致敬', '伏笔', '隐喻',
  '细节', '细思极恐', '神仙', '泪目', '泪崩', '破防', '笑死', '笑不活了',
  '催更', '完结', '甜', '刀', '爷青回', '百看不厌', '循环', '单曲循环'
];

function isSingleCharRepeat(s) {
  if (s.length < 3) return false;
  var c = s[0];
  for (var i = 1; i < s.length; i++) {
    if (s[i] !== c) return false;
  }
  return true;
}

// 判断是否为无意义的短数字/字母串：单字符堆叠、纯短英数等
function isLowInfoNoise(s) {
  var t = s.trim();
  if (!t) return true;
  // 完全无中文/英数字符（纯标点/符号/空白）
  if (!/[一-鿿㐀-䶿a-zA-Z0-9]/.test(t)) return true;

  var lower = t.toLowerCase();
  if (MEANINGFUL_ALPHANUM[lower]) return false;

  // 单个 ASCII 字符堆叠，如 111 / aaa / ....
  if (isSingleCharRepeat(t) && /[a-zA-Z0-9]/.test(t[0])) return true;

  // 纯英数字且较短（<=4），多为无意义串，如 123 / abc / 1a2 / 4567
  if (isPureAlphaNum(t) && t.length <= 4) return true;

  return false;
}

function maxCharRatio(s) {
  if (!s.length) return 0;
  var freq = {};
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    freq[c] = (freq[c] || 0) + 1;
  }
  var max = 0;
  for (var key in freq) {
    if (freq[key] > max) max = freq[key];
  }
  return max / s.length;
}

function similarity(a, b) {
  var la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  if (a === b) return 1;
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.5) return 0;
  
  var dp = [];
  for (var i = 0; i <= la; i++) {
    dp[i] = [i];
  }
  for (var j = 0; j <= lb; j++) {
    dp[0][j] = j;
  }
  
  for (var i = 1; i <= la; i++) {
    for (var j = 1; j <= lb; j++) {
      if (a[i-1] === b[j-1]) {
        dp[i][j] = dp[i-1][j-1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
  }
  
  var dist = dp[la][lb];
  return 1 - dist / Math.max(la, lb);
}

function scoreItem(item, p) {
  var text = String(item.content || '').trim();
  var score = 50;
  var reasons = [];

  var len = text.length;
  if (len <= 2) score -= 30;
  else if (len <= 5) score += 5;
  else if (len <= 15) score += 15;
  else if (len <= 30) score += 10;
  else score += 5;

  var div = charDiversity(text);
  score += Math.round(div * 20);

  var repRatio = maxCharRatio(text);
  if (repRatio > p.repeatThreshold / 100) {
    var pen = Math.round((repRatio - p.repeatThreshold / 100) * 60);
    score -= pen;
    reasons.push('重复字');
  }

  if (isPureEmoji(text)) {
    if (p.allowEmoji) {
      score -= 10;
    } else {
      score -= 40;
    }
    reasons.push('纯emoji');
  }

  // 含中文的弹幕通常信息量更高，给予加分
  if (hasCJK(text)) {
    score += 8;
  }

  // 全英文/数字弹幕分级处理：网络用语轻微降权，纯数字重罚，其余按设定惩罚
  if (isPureAlphaNum(text)) {
    var lower = text.toLowerCase();
    if (MEANINGFUL_ALPHANUM[lower]) {
      score -= Math.round(p.penalty * 0.3);
      reasons.push('网络用语');
    } else if (isPureDigits(text)) {
      score -= p.penalty + 15;
      reasons.push('纯数字');
    } else {
      score -= p.penalty;
      reasons.push('全英数');
    }
  }

  // 标点符号占比过高降权
  var punctRatio = (text.match(/[，。！？、,.!?;:~…]/g) || []).length / Math.max(1, len);
  if (punctRatio > 0.4) {
    score -= 10;
    reasons.push('标点多');
  }

  // 命中优质关键词加分，引导精选偏好
  for (var k = 0; k < QUALITY_KEYWORDS.length; k++) {
    if (text.indexOf(QUALITY_KEYWORDS[k]) !== -1) {
      score += 8;
      reasons.push('优质词');
      break;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

function filterDanmaku(items, p) {
  var result = [];
  
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var text = String(item.content || '').trim();
    var dropReasons = [];
    
    if (p.filterShort && text.length < p.minLen) {
      dropReasons.push('太短');
    }

    if (p.filterNoise && dropReasons.length === 0 && isLowInfoNoise(text)) {
      dropReasons.push('无意义短串');
    }
    
    result.push({
      ...item,
      _text: text,
      _dropReasons: dropReasons,
      _prefiltered: dropReasons.length > 0
    });
  }
  
  if (p.filterSpam) {
    result.sort(function(a, b) { return a.time - b.time; });
    var recentContents = [];
    for (var i = 0; i < result.length; i++) {
      var item = result[i];
      if (item._prefiltered) continue;
      
      var cutoff = item.time - p.windowSec;
      while (recentContents.length && recentContents[0].time < cutoff) {
        recentContents.shift();
      }
      
      var exactCount = 0;
      for (var j = 0; j < recentContents.length; j++) {
        if (recentContents[j].text === item._text) exactCount++;
      }
      
      var spamLimit = (item.type === 'scroll') ? 3 : 2;
      if (exactCount >= spamLimit) {
        item._dropReasons.push('刷屏');
        item._prefiltered = true;
      }
      recentContents.push({ time: item.time, text: item._text });
    }
  }
  
  if (p.filterDuplicate) {
    result.sort(function(a, b) { return a.time - b.time; });
    for (var i = 0; i < result.length; i++) {
      if (result[i]._prefiltered) continue;
      for (var j = i + 1; j < result.length; j++) {
        if (result[j].time - result[i].time > p.windowSec) break;
        if (result[j]._prefiltered) continue;
        var sim = similarity(result[i]._text, result[j]._text);
        var dupThreshold = (result[j].type === 'scroll') ? 0.93 : 0.82;
        if (sim > dupThreshold) {
          result[j]._dropReasons.push('近似重复');
          result[j]._prefiltered = true;
        }
      }
    }
  }
  
  for (var i = 0; i < result.length; i++) {
    var item = result[i];
    if (item._prefiltered) {
      item._score = 0;
      item._scoreReasons = [];
      continue;
    }
    var scored = scoreItem(item, p);
    item._score = scored.score;
    item._scoreReasons = scored.reasons;
  }
  
  if (p.filterAdvanced) {
    var times = [];
    for (var i = 0; i < result.length; i++) {
      if (!isNaN(result[i].time)) times.push(result[i].time);
    }
    if (times.length) {
      var tMin = Math.min.apply(null, times);
      var tMax = Math.max.apply(null, times);
      var segCount = Math.max(1, Math.ceil((tMax - tMin) / 30));
      var segSize = (tMax - tMin) / segCount;
      var segCounts = new Array(segCount).fill(0);
      
      for (var i = 0; i < result.length; i++) {
        var item = result[i];
        if (!item._prefiltered) {
          var seg = Math.min(segCount - 1, Math.floor((item.time - tMin) / segSize));
          segCounts[seg]++;
        }
      }
      
      for (var i = 0; i < result.length; i++) {
        var item = result[i];
        if (item._prefiltered) continue;
        var seg = Math.min(segCount - 1, Math.floor((item.time - tMin) / segSize));
        if (segCounts[seg] < 3) {
          item._score = Math.min(100, item._score + 15);
        }
      }
    }
  }
  
  var candidates = result.filter(function(r) { return !r._prefiltered; });
  candidates.sort(function(a, b) { return b._score - a._score; });
  
  var keepCount;
  
  if (p.expectedDanmakuCount > 0) {
    keepCount = Math.max(1, Math.round(p.expectedDanmakuCount * 1000));
  } else {
    keepCount = Math.max(1, Math.round(candidates.length * p.ratio / 100));
  }

  var kept = candidates.slice(0, Math.min(keepCount, candidates.length));
  
  var keptIndices = new Set();
  for (var i = 0; i < kept.length; i++) {
    var keptItem = kept[i];
    for (var j = 0; j < result.length; j++) {
      if (result[j] === keptItem) {
        keptIndices.add(j);
        break;
      }
    }
  }
  
  for (var i = 0; i < result.length; i++) {
    var item = result[i];
    if (item._prefiltered) {
      item._kept = false;
    } else {
      item._kept = keptIndices.has(i);
      if (!item._kept) item._dropReasons.push('分数不足(' + item._score + ')');
    }
  }
  
  var finalKept = result.filter(function(r) { return r._kept; }).map(function(r) {
    return {
      time: r.time,
      content: r.content,
      type: r.type,
      color: r.color
    };
  });
  
  finalKept.sort(function(a, b) { return a.time - b.time; });
  
  return finalKept;
}

function pluginOnInitialize() {
  loadParams();
  ui.showSnackBar('弹幕精选插件已启用');
}

function pluginOnDestroy() {
  ui.showSnackBar('弹幕精选插件已禁用');
}

function pluginOnEvent(event) {
  if (event.name === 'danmakuLoaded') {
    var danmakuData = event.data.danmaku;

    var commentsArray;
    var originalCount = 0;

    if (danmakuData && danmakuData.comments && Array.isArray(danmakuData.comments)) {
      commentsArray = danmakuData.comments;
      originalCount = danmakuData.count || commentsArray.length;
    } else if (Array.isArray(danmakuData)) {
      commentsArray = danmakuData;
      originalCount = danmakuData.length;
    } else {
      return;
    }

    loadParams();

    var filtered = filterDanmaku(commentsArray, params);
    var filteredCount = filtered.length;

    danmaku.replace({
      count: filteredCount,
      comments: filtered
    });

    ui.showSnackBar('弹幕精选完成: ' + originalCount + ' -> ' + filteredCount);
  }
}

function pluginHandleUIAction(actionId) {
  var switchActions = ['filterDuplicate', 'filterSpam', 'filterShort', 'filterNoise', 'allowEmoji', 'filterAdvanced'];
  
  if (switchActions.includes(actionId)) {
    params[actionId] = !params[actionId];
    settings.setText(actionId, params[actionId].toString());
    pluginUIEntries = buildUIEntries();
    
    return {
      type: 'text',
      title: params[actionId] ? '已启用' : '已禁用',
      content: '「' + pluginUIEntries.find(function(e) { return e.id === actionId; }).title + '」' + (params[actionId] ? '已启用' : '已禁用')
    };
  }
  
  return {
    type: 'text',
    title: '弹幕精选',
    content: '参数已保存，下次加载弹幕时生效'
  };
}
