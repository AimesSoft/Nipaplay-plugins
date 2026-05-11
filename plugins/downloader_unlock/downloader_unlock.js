const pluginManifest = {
  id: 'downloader_unlock',
  name: '下载器解锁',
  version: '1.1.0',
  minHostVersion: '1.10.5',
  description: '强制解锁下载器功能。',
  author: 'Retr0',
  permissions: ['system.override', 'storage']
};

let _isEnabled = false;

function pluginOnInitialize() {
  _isEnabled = storage.get('downloader_enabled') || false;
  if (_isEnabled) {
    system.setDownloaderEnabled(true);
  }
}

function pluginOnEvent(event) {
}

const pluginUIEntries = [
  {
    id: 'toggle_downloader',
    title: '下载器开关',
    description: '启用或禁用 iOS 端下载器'
  }
];

function pluginHandleUIAction(actionId) {
  if (actionId !== 'toggle_downloader') {
    return null;
  }

  _isEnabled = !_isEnabled;
  storage.set('downloader_enabled', _isEnabled);
  system.setDownloaderEnabled(_isEnabled);

  return {
    type: 'text',
    title: '下载器设置',
    content: _isEnabled ? 'iOS 下载器已启用' : 'iOS 下载器已禁用'
  };
}
