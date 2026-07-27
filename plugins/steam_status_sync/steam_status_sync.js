// NipaPlay Steam 状态同步插件
// 利用 NipaPlay 内置的远程控制 API（/remote/control/state）提供观看信息，
// 配合 NipaPlay-Steam-Bridge 独立程序将观看状态同步到 Steam。
// 无需额外启动 API 服务，远程控制 API 默认端口 1180。

var pluginManifest = {
  id: 'builtin.steam_status_sync',
  name: 'Steam 状态同步',
  version: '2.0.0',
  minHostVersion: '1.11.3',
  description:
    '注意：使用前务必阅读文档！' +
    '将当前观看的番剧信息同步到 Steam 状态。' +
    '利用 NipaPlay 内置的远程控制 API 提供观看信息，' +
    '配合 NipaPlay-Steam-Bridge 独立程序设置 Steam 状态。',
  author: 'Retr0',
  permissions: ['storage', 'player.control', 'system.override']
};

// ---- 配置项 ----
var REMOTE_CONTROL_PORT_DEFAULT = 1180;

// ---- UI 入口 ----
var pluginUIEntries = [
  {
    id: 'enable',
    title: '启用 Steam 状态同步',
    description: '开启后将自动启动 Bridge 程序（如已配置路径）',
    enabled: false
  },
  {
    id: 'remoteControlPort',
    title: '远程控制端口',
    description: 'NipaPlay 远程控制 API 端口，Bridge 程序需要配置相同端口',
    isTextInput: true,
    textSetting: {
      hintText: '默认 1180',
      defaultValue: '1180'
    }
  },
  {
    id: 'bridgePath',
    title: 'Bridge 可执行文件路径',
    description: 'NipaPlay-Steam-Bridge 程序路径，留空则不自动启动',
    isTextInput: true,
    textSetting: {
      hintText: '例如 /path/to/nipaplay-steam-bridge',
      defaultValue: ''
    }
  }
];

// ---- 状态变量 ----
var _enabled = false;

// ---- 内部方法 ----

function _getRemoteControlPort() {
  var portStr = settings.getText('remoteControlPort');
  var port = parseInt(portStr, 10);
  return isNaN(port) || port <= 0 || port > 65535 ? REMOTE_CONTROL_PORT_DEFAULT : port;
}

function _startBridgeIfNeeded() {
  var path = settings.getText('bridgePath').trim();
  if (!path) {
    dev.log('Steam 状态同步：未配置 Bridge 路径，跳过自动启动');
    return;
  }

  if (process.isRunning()) {
    dev.log('Steam 状态同步：Bridge 已在运行');
    return;
  }

  var port = _getRemoteControlPort();
  var env = { NIPAPLAY_API_PORT: String(port) };

  dev.log('Steam 状态同步：正在启动 Bridge，路径: ' + path + '，端口: ' + port);
  var result = process.start(path, [], env);
  if (result) {
    dev.log('Steam 状态同步：Bridge 启动命令已发送');
  } else {
    dev.logError('Steam 状态同步：Bridge 启动失败（process.start 返回 false）');
  }
}

function _stopBridgeIfNeeded() {
  if (process.isRunning()) {
    process.stop();
    dev.log('Steam 状态同步：Bridge 已停止');
  }
}

// ---- 插件生命周期 ----

function pluginOnInitialize() {
  dev.log('Steam 状态同步插件初始化');
  _enabled = settings.getSwitch('enable');
  if (_enabled) {
    _startBridgeIfNeeded();
  }
}

function pluginOnDestroy() {
  _stopBridgeIfNeeded();
  _enabled = false;
}

function pluginOnSuspend() {
  // 应用进入后台时保持 Bridge 运行
}

function pluginOnResume() {
  // 应用恢复时确保 Bridge 状态正确
  if (_enabled && !process.isRunning()) {
    _startBridgeIfNeeded();
  }
}

// ---- 事件处理 ----

function pluginOnEvent(event) {
  // 不再需要处理事件，Bridge 程序直接轮询远程控制 API
}

// ---- UI 动作处理 ----

function pluginHandleUIAction(actionId) {
  if (actionId === 'enable') {
    var currentEnabled = settings.getSwitch('enable');
    var newEnabled = !currentEnabled;
    settings.setSwitch('enable', newEnabled);
    _enabled = newEnabled;

    if (newEnabled) {
      _startBridgeIfNeeded();
    } else {
      _stopBridgeIfNeeded();
    }

    return {
      type: 'text',
      title: 'Steam 状态同步',
      content: newEnabled
        ? '已启用 Steam 状态同步\nBridge 程序将通过远程控制 API (端口 ' + _getRemoteControlPort() + ') 获取观看信息'
        : '已停止 Steam 状态同步'
    };
  }

  if (actionId === 'remoteControlPort') {
    var port = _getRemoteControlPort();
    return {
      type: 'text',
      title: '远程控制端口',
      content: '当前端口: ' + port + '\n\nBridge 程序需要配置相同的 NIPAPLAY_API_PORT 环境变量。\n该端口与 NipaPlay 设置中的远程访问端口一致。'
    };
  }

  if (actionId === 'bridgePath') {
    var path = settings.getText('bridgePath');
    var running = process.isRunning();
    return {
      type: 'text',
      title: 'Bridge 路径',
      content: path
        ? 'Bridge 路径: ' + path + (running ? '\n状态: 运行中' : '\n状态: 未运行')
        : '未设置 Bridge 路径。请手动启动 Bridge 程序并配置环境变量。'
    };
  }

  return { type: 'text', title: 'Steam 状态同步', content: '未知操作' };
}
