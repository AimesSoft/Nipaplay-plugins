const pluginManifest = {
  id: 'bilibili.link_playback',
  name: '哔哩哔哩链接播放',
  version: '1.0.0',
  minHostVersion: '1.11.8',
  description: '让 NipaPlay 支持播放哔哩哔哩视频。使用方法：在“视频播放”页面点击“输入链接”，粘贴哔哩哔哩视频链接后点击“播放链接”。',
  author: 'Misuzu',
  permissions: ['url.resolve'],
  priority: 50
};

function pluginResolveUrl(input) {
  var state = input.state;
  if (!state) return begin(input.url, 0);
  if (state.stage === 'redirect') {
    var response = input.response;
    if (response.status >= 300 && response.status < 400) {
      var location = response.headers.location;
      if (!location) throw new Error('短链接没有返回目标地址');
      if (location.indexOf('//') === 0) location = 'https:' + location;
      if (location.charAt(0) === '/') {
        location = state.url.match(/^https?:\/\/[^/]+/i)[0] + location;
      }
      var next = begin(location, state.redirects + 1);
      if (!next) throw new Error('短链接指向了不支持的地址');
      return next;
    }
    throw new Error('无法展开短链接，请使用完整视频链接');
  }
  if (state.stage === 'info') {
    var data = readData(input.response);
    if (!data.bvid || !data.title || !Array.isArray(data.pages) || !data.pages.length) {
      throw new Error('没有找到可播放的分集');
    }
    var pages = data.pages.map(function (page, index) {
      if (!page.cid || !page.page) throw new Error('分集数据不完整');
      return { id: String(page.cid), page: page.page,
        title: 'P' + page.page + ' ' + (page.part || data.title) };
    });
    var preferred = pages.filter(function (page) { return page.page === state.page; })[0];
    return {
      type: 'select', title: data.title, items: pages,
      preferredId: preferred ? preferred.id : pages[0].id,
      state: { stage: 'selected', bvid: data.bvid, title: data.title, pages: pages }
    };
  }
  if (state.stage === 'selected') {
    var selected = state.pages.filter(function (page) { return page.id === input.selectedId; })[0];
    if (!selected) throw new Error('所选分集不存在');
    var source = 'https://www.bilibili.com/video/' + state.bvid + '/?p=' + selected.page;
    return request(
      'https://api.bilibili.com/x/player/playurl?bvid=' + encodeURIComponent(state.bvid) +
      '&cid=' + encodeURIComponent(selected.id) + '&qn=64&fnval=1&fnver=0&fourk=0&platform=html5',
      { stage: 'play', sourceUrl: source, title: state.title,
        displayTitle: state.pages.length > 1 ? state.title + ' · ' + selected.title : state.title }
    );
  }
  if (state.stage === 'play') {
    var playback = readData(input.response);
    if (!Array.isArray(playback.durl) || !playback.durl.length || !playback.durl[0].url) {
      throw new Error('未取得可播放地址，视频可能需要登录或当前不可用');
    }
    if (playback.durl.length !== 1) {
      throw new Error('当前媒体包含多个片段，暂不支持此格式');
    }
    var mediaUrl = playback.durl[0].url;
    if (mediaUrl.indexOf('//') === 0) mediaUrl = 'https:' + mediaUrl;
    if (!/^https?:\/\//i.test(mediaUrl)) throw new Error('播放地址无效');
    return { type: 'play', url: mediaUrl, sourceUrl: state.sourceUrl,
      title: state.displayTitle, searchTitle: state.title, headers: requestHeaders() };
  }
  throw new Error('未知的解析状态');
}

function begin(url, redirects) {
  if (redirects > 5) throw new Error('短链接重定向次数过多');
  var parsed = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(url);
  if (!parsed) return null;
  var host = parsed[1].toLowerCase();
  if (host === 'b23.tv' || host === 'www.b23.tv' || host === 'bili2233.cn') {
    return request(url, { stage: 'redirect', url: url, redirects: redirects });
  }
  if (host !== 'bilibili.com' && host !== 'www.bilibili.com' && host !== 'm.bilibili.com') return null;
  var id = /^\/video\/(BV[0-9a-zA-Z]+|av[0-9]+)(?:\/|$)/i.exec(parsed[2]);
  if (!id) throw new Error('请使用普通视频链接');
  var identifier = id[1];
  var query = /^av/i.test(identifier) ? 'aid=' + identifier.slice(2) :
    'bvid=' + encodeURIComponent('BV' + identifier.slice(2));
  var pageMatch = /(?:^|&)p=(\d+)(?:&|$)/.exec(parsed[3] || '');
  return request('https://api.bilibili.com/x/web-interface/view?' + query,
    { stage: 'info', page: pageMatch ? Number(pageMatch[1]) : 1 });
}

function requestHeaders() {
  return { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/' };
}

function request(url, state) {
  return { type: 'request', request: { url: url, headers: requestHeaders() }, state: state };
}

function readData(response) {
  if (!response || response.status !== 200) {
    throw new Error('远端请求失败（HTTP ' + (response ? response.status : '?') + '）');
  }
  var result;
  try { result = JSON.parse(response.body); } catch (_) {
    throw new Error('远端没有返回有效的数据');
  }
  if (result.code !== 0 || !result.data) {
    throw new Error('解析失败：' + (result.message || result.code || '数据为空'));
  }
  return result.data;
}
