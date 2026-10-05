const pluginManifest = {
  id: 'better_danmaku_filter',
  name: '智能弹幕精选',
  version: '1.4.0',
  minHostVersion: '1.10.6',
  description: '智能精选弹幕，过滤低质量弹幕，保留优质内容',
  author: 'Retr0',
  permissions: ['danmaku.modify', 'ui.dialog'],
  priority: 40
};

var params = {
  adaptiveMode: false,
  adaptiveDensity: 3,
  ratio: 30,
  expectedDanmakuCount: 0,
  filterByRatioWhenBelowExpected: false,
  windowSec: 5,
  minLen: 3,
  repeatThreshold: 60,
  penalty: 30,
  filterDuplicate: true,
  filterSpam: true,
  filterShort: true,
  filterNoise: true,
  allowEmoji: true,
  filterDistraction: true,
  filterAdvanced: true
};

function readIntSetting(id, defaultValue) {
  var raw = settings.getText(id);
  var value = parseInt(raw, 10);
  return isFinite(value) ? value : defaultValue;
}

function readNumberSetting(id, defaultValue) {
  var raw = settings.getText(id);
  if (raw === null || raw === undefined || String(raw).trim() === '') return defaultValue;
  var value = Number(raw);
  return isFinite(value) ? value : defaultValue;
}

function readBoolSetting(id, defaultValue) {
  if (settings.getSwitch) {
    var switchValue = settings.getSwitch(id);
    if (switchValue === true || switchValue === false) return switchValue;
  }

  var raw = settings.getText(id);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return defaultValue;
}

function loadParams() {
  params.ratio = Math.max(1, Math.min(100, readIntSetting('ratio', 30)));
  params.adaptiveMode = readBoolSetting('adaptiveMode', false);
  params.adaptiveDensity = Math.max(0.2, Math.min(10, readNumberSetting('adaptiveDensity', 3)));
  params.expectedDanmakuCount = Math.max(0, readNumberSetting('expectedDanmakuCount', 0));
  params.filterByRatioWhenBelowExpected = readBoolSetting('filterByRatioWhenBelowExpected', false);
  params.windowSec = Math.max(1, Math.min(30, readIntSetting('windowSec', 5)));
  params.minLen = Math.max(1, Math.min(10, readIntSetting('minLen', 3)));
  params.repeatThreshold = Math.max(30, Math.min(100, readIntSetting('repeatThreshold', 60)));
  params.penalty = Math.max(0, Math.min(80, readIntSetting('penalty', 30)));
  params.filterDuplicate = readBoolSetting('filterDuplicate', true);
  params.filterSpam = readBoolSetting('filterSpam', true);
  params.filterShort = readBoolSetting('filterShort', true);
  params.filterNoise = readBoolSetting('filterNoise', true);
  params.allowEmoji = readBoolSetting('allowEmoji', true);
  params.filterDistraction = readBoolSetting('filterDistraction', true);
  params.filterAdvanced = readBoolSetting('filterAdvanced', true);
}

function buildUIEntries() {
  return [
    {
      id: 'adaptiveMode',
      title: '自适应模式',
      description: '使用概率统计模型自动精选；开启后优先于期望数和保留比例',
      enabled: params.adaptiveMode
    },
    {
      id: 'adaptiveDensity',
      title: '自适应舒适密度',
      description: '每秒舒适弹幕数（0.2-10，默认3）；越小越严格，仅自适应模式生效',
      textSetting: { hintText: '3', default: '3' }
    },
    {
      id: 'expectedDanmakuCount',
      title: '期望弹幕数',
      description: '目标保留数（千条，支持0.5等小数）；0使用比例，自适应关闭时生效',
      textSetting: { hintText: '0', default: '0' }
    },
    {
      id: 'ratio',
      title: '最终保留比例',
      description: '相对插件收到的原始条数（1-100）；优先满足数量，高比例可能保留低分内容',
      textSetting: { hintText: '30', default: '30' }
    },
    {
      id: 'filterByRatioWhenBelowExpected',
      title: '未达期望时按比例过滤',
      description: '实际弹幕数少于期望数时，仍按最终保留比例进行精选过滤',
      enabled: params.filterByRatioWhenBelowExpected
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
      description: '对时间窗口内的近似重复内容降权，优先淘汰',
      enabled: params.filterDuplicate
    },
    {
      id: 'filterSpam',
      title: '过滤刷屏弹幕',
      description: '对短时间内反复出现的相同内容降权，优先淘汰',
      enabled: params.filterSpam
    },
    {
      id: 'filterShort',
      title: '过滤过短弹幕',
      description: '对过短内容降权，保护泪目、哈哈、常见网络用语等情绪表达',
      enabled: params.filterShort
    },
    {
      id: 'filterNoise',
      title: '过滤无意义短串',
      description: '对无意义短串降权，保护常见网络用语、番剧缩写和纯Emoji',
      enabled: params.filterNoise
    },
    {
      id: 'allowEmoji',
      title: '允许纯Emoji降权',
      description: '开启时轻微降权；关闭时强降权，固定数量模式仍优先满足数量',
      enabled: params.allowEmoji
    },
    {
      id: 'filterDistraction',
      title: '过滤离题与攻击内容',
      description: '对独立签到、日期、观看次数、广告和明确人身攻击降权',
      enabled: params.filterDistraction
    },
    {
      id: 'filterAdvanced',
      title: '稀疏时段保护',
      description: '为30秒内不足3条的稀疏时段适当加分',
      enabled: params.filterAdvanced
    },
    {
      id: 'lastFilterStats',
      title: '最近筛选结果',
      description: '查看实际保留率、筛选原因与自适应门槛'
    }
  ];
}

var pluginUIEntries = buildUIEntries();

function charDiversity(s) {
  var chars = Array.from(s);
  if (!chars.length) return 0;
  var set = Object.create(null);
  for (var i = 0; i < chars.length; i++) {
    set[chars[i]] = true;
  }
  return Object.keys(set).length / chars.length;
}

function isPureEmoji(s) {
  var noEmoji = s.replace(/[0-9#*]\uFE0F?\u20E3/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').trim();
  return noEmoji.length === 0 && /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2B00}-\u{2BFF}\u20E3]/u.test(s);
}

function isPureAlphaNum(s) {
  return /^[a-zA-Z0-9\s]+$/.test(s.trim());
}

function isPureDigits(s) {
  return /^[0-9\s]+$/.test(s.trim());
}

function hasCJK(s) {
  return /[一-鿿㐀-䶿]/.test(s);
}

// 常见有意义的纯英文/数字网络用语，命中后不被当作无意义短串过滤
var MEANINGFUL_ALPHANUM = {
  '666': 1, '6666': 1, '66666': 1,
  '999': 1, '996': 1,
  '888': 1, '777': 1, '555': 1,
  '233': 1, '2333': 1, '23333': 1,
  'hhh': 1, 'hhhh': 1, 'hhhhh': 1, 'haha': 1, 'hahaha': 1,
  'lol': 1, 'lolol': 1, 'lmao': 1,
  'gg': 1, 'nb': 1,
  'qaq': 1, 'qwq': 1, 'qwp': 1, 'tvt': 1,
  'awsl': 1, 'xswl': 1, 'yyds': 1, 'kksk': 1, 'kkp': 1,
  'ojbk': 1, 'wdnmd': 1, 'omg': 1,
  'thx': 1, 'ok': 1, 'wow': 1, 'love': 1, 'nice': 1, 'good': 1,
  'op': 1, 'ed': 1, 'bgm': 1, 'ost': 1, 'mio': 1, 'yui': 1, 'cl': 1, 'syd': 1
};

// 只作弱启发式，不把“高能预警”等可能泄露剧情的提醒直接视作优质。
var QUALITY_KEYWORDS = ['细节', '伏笔', '隐喻', '致敬', '彩蛋'];

function isMeaningfulAlphaNum(s) {
  var lower = s.toLowerCase();
  return Object.prototype.hasOwnProperty.call(MEANINGFUL_ALPHANUM, lower) ||
    /^(?:233+|666+|555+|888+|999+|h{3,}|(?:ha){2,}|y[o]+)$/.test(lower);
}

function isReaction(s) {
  var core = s.replace(/[?？!！~～。.…]+$/g, '');
  return isMeaningfulAlphaNum(core) || isKaomoji(s) || /^[?？!！]{1,6}$/.test(s) ||
    /^(?:[哈呵嘿嘻啊哦噢哇诶唉嗯]+|泪目|泪崩|好萌|好甜|好帅|可爱|卧槽)$/.test(core);
}

function isKaomoji(s) {
  return Array.from(s).length <= 24 && !/[一-鿿㐀-䶿a-z0-9]/i.test(s) &&
    ((/[（(].*[)）]/.test(s) && /[╹╯╰﹏ωзಠ・･^▽Д｜☆]/.test(s)) ||
      /[⊙☆●ಠ].*[∀ωД▽﹏_].*[⊙☆●ಠ]/.test(s));
}

// 基于真实弹幕数据整理的日期/打卡类离题特征：覆盖内嵌日期、脏分隔符与打卡占位词。
var DATE_SEP = '[.。·、,，_\\-\\/／]';
var DATE_SPAM_RE = new RegExp(
  '\\d{1,2}\\s*' + DATE_SEP + '\\s*\\d{1,2}\\s*' + DATE_SEP + '\\s*(?:19|20)\\d{2}' +          // 月/日/年（7/9/2012）
  '|\\b\\d{2,5}\\s*' + DATE_SEP + '{1,2}\\s*\\d{1,2}\\s*' + DATE_SEP + '{1,2}\\s*\\d{1,2}\\b' +  // 年/月/日（11.8.14、20125-8-21）
  '|\\b(?:19|20)\\d{2}\\s*' + DATE_SEP + '\\s*\\d{1,2}\\b' +                                   // 年.月（2014.6）
  '|\\b\\d{4}\\s*' + DATE_SEP + '\\s*\\d{3,4}\\b' +                                            // 年.月日连写（2011.1204）
  '|\\b\\d{4}\\s*[yY]\\s*\\d{1,2}\\s*[mM]\\s*\\d{1,2}\\s*[dD]?\\b' +                            // 2012y7m28d
  '|\\b\\d{2,5}\\s*年\\s*\\d{1,2}\\s*月(?:\\s*\\d{1,2}\\s*[日号]?)?' +                            // 2014年8月、14年6月16号
  '|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*[日号]' +                                                    // 7月14号
  '|\\b(?:19|20)\\d{2}\\s*年' +                                                               // 2011年
  '|\\b\\d{4}\\s*除夕' +                                                                      // 2014除夕
  '|\\b(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\b' +                         // 20140315（8 位）
  '|\\b\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\b' +                                 // 130629（6 位）
  '|\\b(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\b' +                                       // 0922（4 位月日）
  '|\\b(?:19|20)\\d{2}\\b' +                                                                // 独立年份
  '|\\b\\d{2}\\s+\\d{1,2}\\s+\\d{1,2}\\b' +                                                  // 23 12 30
  '|^\\s*(?:0?[1-9]|1[0-2])\\s*' + DATE_SEP + '\\s*(?:0?[1-9]|[12]\\d|3[01])\\s*$' +           // 整条 8.5、6/14
  '|(?:存活|补完|完结|撒花|纪念|留念|留恋|签到|打卡|考古|留名|路过|周目|补习|参上|确认)[^A-Za-z0-9]{0,6}(?:0?[1-9]|1[0-2])\\s*' + DATE_SEP + '\\s*(?:0?[1-9]|[12]\\d|3[01])' + // 存活 6.3
  '|(?:0?[1-9]|1[0-2])\\s*' + DATE_SEP + '\\s*(?:0?[1-9]|[12]\\d|3[01])[^A-Za-z0-9]{0,6}(?:存活|补完|完结|撒花|纪念|留念|留恋|签到|打卡|考古|留名|路过|周目|补习|参上|确认)' // 6.12…补完
);
// 整条仅由打卡词与标点、数字组成的占位弹幕（补完纪念/完结撒花/存活确认/留名…），带情感的不匹配。
var CHECKIN_PLACEHOLDER_RE = /^(?=[\s\S]*?(?:补完|完结|撒花|存活|留念|留恋|纪念|留名|考古|路过|参上|签到|打卡|周目|存货|卍解|守望|确认|完毕))[补完完结撒花存活留念留恋纪念留名考古路过参上签到打卡周目存货卍解守望确认完毕彻底一二三四五六七八九十百千万两第次遍刷个+＋~～!！。.…、,，\s\d·:：\-]*$/;

// 只匹配独立离题表达与明确攻击对象，避免把台词、剧情讨论或番剧题材误判。
function distractionPenalty(s) {
  if (DATE_SPAM_RE.test(s) || CHECKIN_PLACEHOLDER_RE.test(s) ||
      /^(?:(?:第)?[一二三四五六七八九十百\dNn]+(?:周目|刷)(?:开始|走起|打卡)?|签到|打卡|报到|报道|留名|第一|我来了)[\s~～!！。+＋\d]*$/.test(s)) {
    return { penalty: 28, reason: '签到/离题' };
  }
  if (/(?:加|加入|进)(?:QQ|qq|Q|q|微信|粉丝|福利|交流)?群[：:号\s]*\d{5,}|(?:https?:\/\/|www\.)\S+.*(?:购买|优惠|领券|福利)/i.test(s)) {
    return { penalty: 45, reason: '广告' };
  }
  if (/^(?:你们?|您|楼上(?:的)?|前面(?:的)?|弹幕(?:里的)?)[，,！! ]*(?:就是|都是|是个?|这群|个|一群|真是|这些)?[，,！! ]*(?:傻[逼比bB]|脑残|智障|废物)|^(?:傻[逼比bB]|脑残|智障)[，,！! ]*(?:闭嘴|滚)/.test(s)) {
    return { penalty: 40, reason: '人身攻击' };
  }
  return { penalty: 0, reason: '' };
}

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
  if (isPureEmoji(t) || isReaction(t)) return false;
  if (!/[一-鿿㐀-䶿ぁ-ヿ가-힣a-zA-Z0-9]/.test(t)) return true;

  var lower = t.toLowerCase();
  if (isMeaningfulAlphaNum(lower)) return false;

  // 单个 ASCII 字符堆叠，如 111 / aaa / ....
  if (isSingleCharRepeat(t) && /[a-zA-Z0-9]/.test(t[0])) return true;

  // 纯英数字且较短（<=4），多为无意义串，如 123 / abc / 1a2 / 4567
  if (isPureAlphaNum(t) && t.length <= 4) return true;

  return false;
}

function maxCharRatio(s) {
  var chars = Array.from(s);
  if (!chars.length) return 0;
  var freq = Object.create(null);
  for (var i = 0; i < chars.length; i++) {
    var c = chars[i];
    freq[c] = (freq[c] || 0) + 1;
  }
  var max = 0;
  for (var key in freq) {
    if (freq[key] > max) max = freq[key];
  }
  return max / chars.length;
}

function shouldUseRatio(totalCount, p) {
  if (p.adaptiveMode) return false;
  if (p.expectedDanmakuCount <= 0) return true;
  var expectedCount = Math.max(1, Math.round(p.expectedDanmakuCount * 1000));
  return p.filterByRatioWhenBelowExpected && totalCount < expectedCount;
}

function getTargetKeepCount(totalCount, p, useRatio) {
  if (useRatio === undefined) useRatio = shouldUseRatio(totalCount, p);
  if (!totalCount) return 0;
  if (p.adaptiveMode) return totalCount;
  var target = useRatio ? Math.round(totalCount * p.ratio / 100) : Math.round(p.expectedDanmakuCount * 1000);
  return Math.min(totalCount, Math.max(1, target));
}

function similarity(a, b) {
  var la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  if (a === b) return 1;
  if (Math.abs(la - lb) / Math.max(la, lb) > 0.5) return 0;
  // 滚动行避免为每次比较分配完整矩阵。
  var previous = [], current = [];
  for (var j = 0; j <= lb; j++) previous[j] = j;
  for (var i = 1; i <= la; i++) {
    current[0] = i;
    for (var j = 1; j <= lb; j++) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] :
        1 + Math.min(previous[j], current[j - 1], previous[j - 1]);
    }
    var swap = previous; previous = current; current = swap;
  }
  return 1 - previous[lb] / Math.max(la, lb);
}

function scoreItem(item, p) {
  var text = String(item.content || '').trim();
  var score = 50, reasons = [];
  var len = Array.from(text).length;
  var reaction = isReaction(text);
  if (len <= 2) score += reaction || (len === 2 && hasCJK(text)) ? 5 : -10;
  else if (len <= 5) score += 5;
  else if (len <= 15) score += 15;
  else if (len <= 30) score += 10;
  else score += 5;

  // 情绪重复可正常表达，屏幕占用和同一时刻重复仍会单独扣分。
  var compact = reaction ? text.replace(/(.)\1{3,}/g, '$1$1$1') : text;
  score += Math.round(charDiversity(compact) * 20);
  var repRatio = maxCharRatio(text);
  if (!reaction && len >= 3 && repRatio > p.repeatThreshold / 100) {
    score -= Math.round((repRatio - p.repeatThreshold / 100) * 60);
    reasons.push('重复字');
  }
  // 普通情绪与常见番剧缩写不是低质量内容；拥挤时主要淘汰重复出现的副本。
  if (reaction) score = Math.max(80, score);
  if (len > 40) {
    score -= Math.min(35, Math.round((len - 40) / 2));
    reasons.push('过长遮挡');
  }
  if (isPureEmoji(text)) {
    score -= p.allowEmoji ? 10 : 40;
    reasons.push('纯Emoji');
  }
  if (hasCJK(text)) score += 8;
  if (isPureAlphaNum(text)) {
    if (isMeaningfulAlphaNum(text)) {
      score -= Math.round(p.penalty * 0.15);
      reasons.push('网络用语/缩写');
    } else if (isPureDigits(text)) {
      score -= p.penalty + 15;
      reasons.push('纯数字');
    } else {
      score -= p.penalty;
      reasons.push('全英数');
    }
  }
  var punctRatio = (text.match(/[，。！？、,.!?;:~…]/g) || []).length / Math.max(1, text.length);
  if (!reaction && punctRatio > 0.4) {
    score -= 10;
    reasons.push('标点多');
  }
  for (var k = 0; k < QUALITY_KEYWORDS.length; k++) {
    if (text.indexOf(QUALITY_KEYWORDS[k]) !== -1) {
      score += 5;
      reasons.push('内容线索');
      break;
    }
  }
  if (p.filterDistraction) {
    var distraction = distractionPenalty(text);
    score -= distraction.penalty;
    if (distraction.reason) reasons.push(distraction.reason);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons: reasons };
}

function median(values) {
  if (!values.length) return 0;
  var sorted = values.slice().sort(function(a, b) { return a - b; });
  var middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scoreDistribution(records) {
  var scores = records.map(function(r) { return r._baseScore; });
  var center = median(scores);
  // MAD 比均值/标准差更能抵抗重复刷屏与极低分尾部；8分下限处理大量同分。
  var spread = Math.max(8, 1.4826 * median(scores.map(function(s) { return Math.abs(s - center); })));
  return { center: center, spread: spread };
}

// 简单到达模型：6秒展示期间超过舒适屏幕容量的概率 P(X > capacity)。
// 用实际分数分布的稳健低分尾部作门槛，不假定分数严格服从正态分布。
function poissonOverflow(lambda, capacity) {
  if (lambda <= 0) return 0;
  if (lambda > 120) return 1;
  var term = Math.exp(-lambda), cumulative = term;
  for (var k = 1; k <= capacity; k++) {
    term *= lambda / k;
    cumulative += term;
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

function explicitQualityReasons(item, p) {
  return item._dropReasons.concat(item._scoreReasons.filter(function(reason) {
    return reason === '签到/离题' || reason === '广告' || reason === '人身攻击' ||
      reason === '过长遮挡' || reason === '重复字' || reason === '标点多' ||
      reason === '纯数字' || (reason === '全英数' && p.penalty > 0) ||
      (reason === '纯Emoji' && !p.allowEmoji);
  }));
}

// 经验分布 F(score)=不高于该分数的普通弹幕占比；同分内容使用同一分位数。
function scorePercentile(sortedScores, score) {
  var left = 0, right = sortedScores.length;
  while (left < right) {
    var middle = Math.floor((left + right) / 2);
    if (sortedScores[middle] <= score) left = middle + 1;
    else right = middle;
  }
  return sortedScores.length ? left / sortedScores.length : 1;
}

function protectOrdinaryDanmaku(records, p, stats) {
  var ordinary = records.filter(function(item) { return explicitQualityReasons(item, p).length === 0; });
  var scores = ordinary.map(function(item) { return item._score; }).sort(function(a, b) { return a - b; });
  // 小样本的分数尾部不够稳定。1000为工程参考量，而非统计置信度。
  var volumeWeight = records.length / (records.length + 1000);
  stats.protected = 0;
  stats.volumeWeight = volumeWeight;
  stats.genericTailRange = [0, 0];
  var minTail = Infinity, maxTail = 0;
  for (var i = 0; i < ordinary.length; i++) {
    var item = ordinary[i];
    item._scorePercentile = scorePercentile(scores, item._score);
    item._genericTailLimit = 0.2 * volumeWeight * item._pressure;
    minTail = Math.min(minTail, item._genericTailLimit);
    maxTail = Math.max(maxTail, item._genericTailLimit);
    // 只有既低于质量门槛、又位于足够拥挤时的经验低分尾部，才仅因低分淘汰。
    if (!item._kept && item._scorePercentile > item._genericTailLimit) {
      item._kept = true;
      item._protectionReason = '稀疏/小样本低分保护';
      stats.protected++;
    }
  }
  if (ordinary.length) stats.genericTailRange = [minTail, maxTail];
}

function addPenalty(item, reason, penalty) {
  item._dropReasons.push(reason);
  item._score = Math.max(0, item._score - penalty);
}

function compareQuality(a, b) {
  // 同分均匀散布在时间轴，避免稳定排序只保留早期的一大段。
  return b._score - a._score || a._tie - b._tie || a._index - b._index;
}

function outputItem(r) {
  // 保留宿主可能提供的身份/字体等扩展字段，不向宿主泄露内部诊断字段。
  return r._original;
}

function analyzeDanmaku(items, p) {
  var target = getTargetKeepCount(items.length, p);
  var stats = { mode: p.adaptiveMode ? '自适应' : (shouldUseRatio(items.length, p) ? '比例' : '期望数'),
    original: items.length, target: p.adaptiveMode ? null : target, kept: 0,
    invalid: 0, reasons: {}, refilled: 0, skipped: false };
  if (!p.adaptiveMode && target >= items.length) {
    stats.kept = items.length;
    stats.skipped = true;
    return { comments: items.slice(), stats: stats, records: [] };
  }

  var records = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i], text = String(item.content || '').trim();
    if (!text || !isFinite(item.time) || Number(item.time) < 0 || item.time === null || item.time === '') {
      stats.invalid++;
      continue;
    }
    var scored = scoreItem(item, p);
    var record = { _original: item, time: Number(item.time), type: item.type,
      _text: text, _normalized: text.toLowerCase().replace(/[\s，。！？、,.!?;:~～…]+/g, '') || text,
      _index: i, _tie: ((i + 1) * 2654435761) % 4294967296,
      _baseScore: scored.score, _score: scored.score, _scoreReasons: scored.reasons,
      _dropReasons: [], _kept: false };
    if (p.filterShort && Array.from(text).length < p.minLen && !isReaction(text) && !(p.allowEmoji && isPureEmoji(text))) {
      // 两字中文可能是角色名或有效评论，轻降权而非一律归入垃圾尾部。
      addPenalty(record, '太短', Array.from(text).length === 2 && hasCJK(text) ? 12 : 18);
    }
    if (p.filterNoise && isLowInfoNoise(text)) addPenalty(record, '无意义短串', 45);
    records.push(record);
  }
  records.sort(function(a, b) { return a.time - b.time || a._index - b._index; });
  var distribution = scoreDistribution(records);

  // 精确重复用按文本分组的滑动队列；相似内容只与窗口内的代表比较。
  var exact = Object.create(null), anchors = Object.create(null), representatives = [], recentStart = 0;
  for (var i = 0; i < records.length; i++) {
    var item = records[i], cutoff = item.time - p.windowSec;
    var queue = exact[item._normalized];
    if (!queue) queue = exact[item._normalized] = { times: [], start: 0 };
    while (queue.start < queue.times.length && queue.times[queue.start] < cutoff) queue.start++;
    var exactCount = queue.times.length - queue.start;
    var anchor = anchors[item._normalized];
    var newWindow = !anchor || anchor.time < cutoff;
    if (newWindow) anchors[item._normalized] = item;
    var spamLimit = item.type === 'scroll' ? 3 : 2;
    // 以窗口代表为锚，不让连续重复无限续期，整段欢呼仍可每个窗口留一条。
    if (p.filterSpam && exactCount >= spamLimit && !newWindow) addPenalty(item, '刷屏', 45);
    var duplicate = false;
    if (p.filterDuplicate && !newWindow) {
      duplicate = true;
    } else if (p.filterDuplicate) {
      while (recentStart < representatives.length && representatives[recentStart].time < cutoff) recentStart++;
      // 超长弹幕仅精确去重；极密窗口最多比较最近200个代表，限制编辑距离开销。
      var start = Math.max(recentStart, representatives.length - 200);
      for (var j = representatives.length - 1; j >= start; j--) {
        var previous = representatives[j];
        if (item._normalized.length > 120 || previous._normalized.length > 120) continue;
        // 极短不同词（如“好萌”“好帅”）不做模糊合并。
        if (Math.min(item._normalized.length, previous._normalized.length) < 4) continue;
        var threshold = item.type === 'scroll' ? 0.93 : 0.82;
        if (similarity(previous._normalized, item._normalized) > threshold) {
          duplicate = true;
          break;
        }
      }
    }
    if (duplicate) addPenalty(item, '近似重复', 35);
    else representatives.push(item);
    queue.times.push(item.time);
  }

  // 对每条弹幕使用前后15秒的实际原始密度，空白时段不稀释局部高峰。
  var left = 0, right = 0;
  var minThreshold = Infinity, maxThreshold = -Infinity;
  for (var i = 0; i < records.length; i++) {
    var item = records[i];
    while (left < records.length && records[left].time < item.time - 15) left++;
    while (right < records.length && records[right].time <= item.time + 15) right++;
    item._density = (right - left) / 30;
    if (p.filterAdvanced && right - left < 3) item._score = Math.min(100, item._score + 8);
    if (p.adaptiveMode) {
      var pressure = poissonOverflow(item._density * 6, Math.max(1, Math.round((p.adaptiveDensity || 3) * 6)));
      item._pressure = pressure;
      item._threshold = Math.max(25, Math.min(75, distribution.center - distribution.spread * (3 - 1.5 * pressure)));
      minThreshold = Math.min(minThreshold, item._threshold);
      maxThreshold = Math.max(maxThreshold, item._threshold);
      item._kept = item._score >= item._threshold;
    }
  }
  if (!p.adaptiveMode) {
    var ranked = records.slice().sort(compareQuality);
    for (var i = 0; i < Math.min(target, ranked.length); i++) ranked[i]._kept = true;
  } else {
    protectOrdinaryDanmaku(records, p, stats);
    stats.distribution = distribution;
    stats.thresholdRange = records.length ? [minThreshold, maxThreshold] : [0, 0];
  }
  for (var i = 0; i < records.length; i++) {
    var item = records[i];
    var reasons = explicitQualityReasons(item, p);
    if (item._kept) {
      if (reasons.length) stats.refilled++;
      continue;
    }
    if (!reasons.length) reasons.push('低分');
    for (var j = 0; j < reasons.length; j++) stats.reasons[reasons[j]] = (stats.reasons[reasons[j]] || 0) + 1;
  }
  var comments = records.filter(function(r) { return r._kept; }).map(outputItem);
  stats.kept = comments.length;
  return { comments: comments, stats: stats, records: records };
}

function filterDanmaku(items, p) {
  return analyzeDanmaku(items, p).comments;
}

var lastFilterStats = null;

function describeStats(stats) {
  if (!stats) return '尚未加载弹幕';
  var rate = stats.original ? (stats.kept * 100 / stats.original).toFixed(2) : '0.00';
  var lines = [stats.mode + '模式：' + stats.original + ' → ' + stats.kept + ' 条（' + rate + '%）'];
  if (stats.target !== null) lines.push('目标：' + stats.target + ' 条；降权内容保留：' + stats.refilled + ' 条');
  if (stats.invalid) lines.push('空白或无效时间：' + stats.invalid + ' 条（无法回填）');
  if (stats.distribution) {
    lines.push('评分中位数：' + stats.distribution.center.toFixed(1) + '；稳健离散度：' + stats.distribution.spread.toFixed(1));
    lines.push('局部门槛：' + stats.thresholdRange[0].toFixed(1) + '～' + stats.thresholdRange[1].toFixed(1));
    lines.push('稀疏/小样本低分保护：' + stats.protected + ' 条');
    lines.push('普通内容低分尾部比例：' + (stats.genericTailRange[0] * 100).toFixed(2) + '%～' + (stats.genericTailRange[1] * 100).toFixed(2) + '%');
  }
  var keys = Object.keys(stats.reasons);
  if (keys.length) lines.push('淘汰原因（可重叠）：' + keys.map(function(k) { return k + ' ' + stats.reasons[k]; }).join('、'));
  if (stats.skipped) lines.push('原始数量不超过目标，已跳过精选');
  return lines.join('\n');
}

function pluginOnInitialize()
{
  // 宿主启动时设置值可能尚未加载，此处不读取/写入配置。
  // 真正处理弹幕时再调用 loadParams()，避免用默认值覆盖用户配置。
}

function pluginOnDestroy() {
  ui.showSnackBar('弹幕精选插件已禁用');
}

function pluginOnEvent(event) {
  if (event.name === 'danmakuLoaded') {
    var danmakuData = event.data.danmaku;

    var commentsArray;

    if (danmakuData && danmakuData.comments && Array.isArray(danmakuData.comments)) {
      commentsArray = danmakuData.comments;
    } else if (Array.isArray(danmakuData)) {
      commentsArray = danmakuData;
    } else {
      return;
    }

    loadParams();

    var analysis = analyzeDanmaku(commentsArray, params);
    lastFilterStats = analysis.stats;
    if (analysis.stats.skipped) {
      ui.showSnackBar('弹幕精选跳过: ' + commentsArray.length + ' 条不超过目标保留数 ' + analysis.stats.target);
      return;
    }
    danmaku.replace({ count: analysis.comments.length, comments: analysis.comments });
    var rate = commentsArray.length ? (analysis.comments.length * 100 / commentsArray.length).toFixed(1) : '0.0';
    ui.showSnackBar('弹幕精选（' + analysis.stats.mode + '）: ' + commentsArray.length + ' → ' + analysis.comments.length + '（' + rate + '%）');
  }
}

function pluginHandleUIAction(actionId) {
  if (actionId === 'lastFilterStats') {
    return { type: 'text', title: '最近筛选结果', content: describeStats(lastFilterStats) };
  }
  var switchActions = ['adaptiveMode', 'filterDistraction', 'filterByRatioWhenBelowExpected', 'filterDuplicate', 'filterSpam', 'filterShort', 'filterNoise', 'allowEmoji', 'filterAdvanced'];
  
  if (switchActions.includes(actionId)) {
    loadParams();
    params[actionId] = !params[actionId];
    if (settings.setSwitch) {
      settings.setSwitch(actionId, params[actionId]);
    }
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
