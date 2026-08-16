const pluginManifest = {
  id: 'titan_danmaku_renderer',
  name: 'JavaScript弹幕引擎',
  version: '1.0.6',
  description: '注意：仅支持 iOS、Android 端；使用实验性 JavaScript 弹幕引擎渲染 NipaPlay 弹幕',
  author: 'Retr0',
  minHostVersion: '1.11.4',
  permissions: ['danmaku.renderer', 'script.external'],
  requires: [
    {
      id: 'titan-bundle',
      url: 'https://cdn.jsdelivr.net/gh/makabaka11/web-danmaku-plugin@418555b87eda158a94b9818344978b33084e71c1/dist/titan-bundle.js',
      sha256: 'f0c4a8ab2b2a02f2c4474918e630f12928a03ae8d50b96f88dc9078584ce0eca',
    },
  ],
};

const pluginDanmakuRenderers = [
  {
    id: 'titan',
    name: 'Titan',
    description: 'Titan 弹幕引擎，提取自某知名弹幕视频网。原汁原味，一行未动',
    apiVersion: 1,
    platforms: ['android', 'ios'],
    supportsRealtimeAdd: true,
    requires: ['titan-bundle'],
    bootstrap: String.raw`
      const root = document.getElementById('nipa-danmaku-root');
      const simplifiedChineseFontFamily = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', sans-serif";
      const defaultTitanFontFamily = "SimHei, 'Microsoft JhengHei', Arial, Helvetica, sans-serif";
      document.documentElement.lang = 'zh-CN';
      document.documentElement.style.webkitLocale = "'zh-CN'";
      root.lang = 'zh-CN';
      root.style.fontFamily = simplifiedChineseFontFamily;
      const rollLayer = document.createElement('div');
      const insideWrap = document.createElement('div');
      const rotateDom = document.createElement('div');
      for (const layer of [rollLayer, insideWrap, rotateDom]) {
        layer.lang = 'zh-CN';
        layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;font-family:' + simplifiedChineseFontFamily;
        root.appendChild(layer);
      }

      let webpackRequire = null;
      for (let i = 0; i < 100 && !webpackRequire; i++) {
        const chunkId = 99000 + i;
        try {
          window.nanoWidgetsJsonp.push([
            [chunkId],
            { [chunkId]: function () {} },
            function (wp) { webpackRequire = wp; },
          ]);
        } catch (_) {}
        if (!webpackRequire) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!webpackRequire) throw new Error('Titan webpack runtime not ready');
      await webpackRequire.e(765);
      const Engine = webpackRequire(7765).ZP;
      if (!Engine) throw new Error('Titan Engine export 7765.ZP not found');

      const clock = { positionSeconds: 0, offsetSeconds: 0, playing: false, rate: 1, seekRevision: -1 };
      const engine = new Engine({
        id: 'nipaplay-plugin-titan',
        container: rollLayer,
        dom: { insideWrap, rotateDom },
        setting: {
          visible: true,
          opacity: 0.85,
          fontFamily: defaultTitanFontFamily,
          bold: true,
          preventShade: false,
          speedPlus: 1,
          speedSync: true,
          fontBorder: 0,
          fontSize: 1,
          fullScreenSync: false,
          area: 100,
          videoSpeed: 1,
          isRecyclingDom: true,
          isRecyclingModel: false,
          canBindMove: false,
          forbidEvents: true,
          forbidShrinkState: true,
          offsetTop: 3,
        },
        fn: {
          timelineSync: () => clock.positionSeconds + clock.offsetSeconds,
          filter: () => false,
        },
        modes: [],
      });

      const typeToMode = { scroll: 1, bottom: 4, top: 5, reverse: 6 };
      function colorToInt(value) {
        if (typeof value === 'number') return value & 0xffffff;
        const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i.exec(value || '');
        return match ? ((+match[1] << 16) | (+match[2] << 8) | +match[3]) : 0xffffff;
      }
      function toTitanItem(item, index, realtime) {
        const titanItem = {
          text: item.content || '',
          mode: typeToMode[item.type] || +item.originalType || 1,
          size: +item.fontSize || 25,
          color: colorToInt(item.color),
          dmid: item.danmakuId || (realtime ? 'local-' + Date.now() : 'nipaplay-' + index),
        };
        if (!realtime) titanItem.stime = (+item.time || 0) * 1000;
        return titanItem;
      }
      function load(items) {
        const titanItems = items.map((item, index) => toTitanItem(item, index, false));
        rollLayer.textContent = '';
        engine.clear();
        engine.reset();
        for (let i = 0; i < titanItems.length; i += 150) {
          engine.addList(titanItems.slice(i, i + 150));
        }
        engine.seek(clock.positionSeconds + clock.offsetSeconds);
      }
      function addRealtime(item) {
        engine.add(toTitanItem(item || {}, 0, true));
      }
      function applySettings(value) {
        const rendererSettings = value.rendererSettings || {};
        engine.setSetting('visible', value.visible !== false);
        engine.setSetting('opacity', rendererSettings.opacity == null ? 0.85 : rendererSettings.opacity);
        engine.setSetting('area', Math.round((value.displayArea || 1) * 100));
        engine.setSetting('fontSize', rendererSettings.fontSize == null ? 1 : rendererSettings.fontSize);
        engine.setSetting('bold', rendererSettings.bold !== false);
        engine.setSetting('fontBorder', rendererSettings.fontBorder == null ? 0 : rendererSettings.fontBorder);
        engine.setSetting('fontFamily', rendererSettings.fontFamily || defaultTitanFontFamily);
        engine.setSetting('speedPlus', rendererSettings.speedPlus == null ? 1 : rendererSettings.speedPlus);
        engine.setSetting('density', rendererSettings.density == null ? 1 : rendererSettings.density);
        engine.setSetting('duration', rendererSettings.duration == null ? 4.5 : rendererSettings.duration);
        engine.setSetting('limit', rendererSettings.limit == null ? 300 : rendererSettings.limit);
        engine.setSetting('speedSync', true);
        engine.setSetting('preventShade', rendererSettings.preventShade === true);
        engine.setSetting('offsetTop', rendererSettings.offsetTop == null ? 3 : rendererSettings.offsetTop);
        engine.setSetting('offsetBottom', rendererSettings.offsetBottom || 0);
        engine.setSetting('maxLength', rendererSettings.maxLength == null ? 50 : rendererSettings.maxLength);
        engine.setSetting('isRecyclingDom', rendererSettings.isRecyclingDom !== false);
        engine.setSetting('isRecyclingModel', rendererSettings.isRecyclingModel === true);
        engine.setSetting('forbidShrinkState', rendererSettings.forbidShrinkState !== false);
        const nextOffset = +value.timeOffsetSeconds || 0;
        if (clock.offsetSeconds !== nextOffset) {
          clock.offsetSeconds = nextOffset;
          engine.seek(clock.positionSeconds + clock.offsetSeconds);
        }
      }
      function syncClock(message) {
        const seekChanged = clock.seekRevision !== message.seekRevision;
        const rateChanged = clock.rate !== message.playbackRate;
        clock.positionSeconds = +message.positionSeconds || 0;
        clock.rate = +message.playbackRate || 1;
        clock.seekRevision = message.seekRevision;
        if (rateChanged) engine.setSetting('videoSpeed', clock.rate);
        if (seekChanged) engine.seek(clock.positionSeconds + clock.offsetSeconds);
        if (clock.playing !== !!message.playing) {
          clock.playing = !!message.playing;
          if (clock.playing) engine.play(); else engine.pause();
        }
      }

      const resizeObserver = new ResizeObserver(() => engine.resize());
      resizeObserver.observe(root);
      window.NipaDanmakuRenderer = {
        handle(message) {
          switch (message.type) {
            case 'load': load(message.items || []); break;
            case 'add': addRealtime(message.item); break;
            case 'settings': applySettings(message.value || {}); break;
            case 'clock': syncClock(message); break;
            case 'dispose':
              resizeObserver.disconnect();
              try { engine.dispose(); } catch (_) {}
              break;
          }
        },
      };
      setTimeout(() => engine.resize(), 0);
      setTimeout(() => engine.resize(), 300);
    `,
  },
];
