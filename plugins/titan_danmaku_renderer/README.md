# JavaScript 弹幕引擎插件

该插件让 NipaPlay 可以使用 Titan DOM 弹幕引擎渲染弹幕。引擎本体不打包进插件脚本，而是在用户启用并选择该渲染器后，通过 `pluginManifest.requires` 下载、校验并缓存。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| Android | 支持 | 使用透明 WebView 覆盖在视频表面上方 |
| iOS | 支持 | 使用透明 WKWebView，已指定简体中文字体和 `zh-CN` locale |
| Windows | 暂不支持 | 当前宿主没有接入 Windows WebView 实现 |
| macOS / Linux / Web / tvOS / HarmonyOS | 暂不支持 | 插件不会出现在这些平台的弹幕引擎列表中 |

实际支持范围由插件中的 `platforms` 和 NipaPlay WebView 宿主共同决定；当前声明为 `['android', 'ios']`。

## 使用方法

1. 打开 NipaPlay 的“插件设置”。
2. 启用“Titan 弹幕引擎”。
3. 打开“弹幕设置 → 弹幕渲染引擎”。
4. 选择“Titan”。
5. 首次启用时保持网络可用，等待外部引擎脚本下载完成。

插件未启用、当前平台不支持或运行时加载失败时，“Titan”不会作为可用渲染器工作。切回内置弹幕引擎后，WebView 会被销毁；使用 Erika 播放内核时也会恢复原生弹幕路径。

## 外部依赖

外部引擎在 `pluginManifest.requires` 中声明：

```js
requires: [
  {
    id: 'titan-bundle',
    url: 'https://cdn.example.com/titan-bundle.js',
    sha256: '<64 位 SHA-256>',
  },
],
```

渲染器通过依赖 ID 引用它：

```js
requires: ['titan-bundle'],
```

宿主行为：

- 只接受 HTTPS 地址。
- 按清单顺序加载依赖。
- 单个脚本最大 32 MB。
- 配置 SHA-256 时会在执行前校验完整性。
- 下载结果缓存在应用数据目录的 `plugins/.renderer-host/scripts/` 下。
- 插件未启用或未被选中时不会下载、解析或执行 Titan bundle。

更新外部 bundle 时，必须同时更新 URL（推荐固定到提交哈希）和 SHA-256。可用以下命令计算摘要：

```bash
shasum -a 256 dist/titan-bundle.js
```

## Titan 专属设置

当 NipaPlay 选择 Titan 渲染器时，软件会显示独立的 Titan 设置入口，并通过
`settings.value.rendererSettings` 传入适配层。当前支持：

- 不透明度、字号倍率、加粗、描边类型（重墨 / 描边 / 45° 投影）和字体族；
- 滚动速度、密度、基准时长与同屏上限；
- 防挡字幕、顶部/底部偏移、最大长度；
- DOM 回收、模型回收与禁止缩小。

这些设置单独持久化，只在 Titan 被选中时显示和生效，不会覆盖其他弹幕引擎的字号、字体、描边与速度配置。
播放倍速同步固定开启，不提供关闭入口。
顶部偏移默认值为 `3px`；旧版宿主持久化的默认 `0px` 会在首次读取时迁移。

## 与播放器的通信

插件适配层创建 `window.NipaDanmakuRenderer.handle(message)`，接收 NipaPlay 推送的消息：

| 消息 | 内容 | Titan 侧处理 |
| --- | --- | --- |
| `initialize` | API 版本、插件 ID、渲染器 ID | 预留协议消息，当前适配层无需额外处理 |
| `load` | 标准化弹幕列表和列表版本 | 转换字段后执行 `clear/reset/addList/seek` |
| `add` | 用户刚发送成功的单条标准化弹幕 | 不传 `stime`，调用 `engine.add()` 立即渲染，不清空现有弹幕 |
| `settings` | 通用设置及 `rendererSettings` | 映射通用可见性、透明度、显示区域、时间偏移和全部 Titan 专属设置；屏蔽已在 App 侧完成 |
| `clock` | 播放位置、总时长、播放态、倍速和 seek 版本 | 调用 `play/pause/seek/setSetting` 对齐播放器 |
| `dispose` | 渲染器退出 | 断开 `ResizeObserver` 并释放 Engine |

播放时钟最多每 100 ms 推送一次。历史弹幕或轨道发生普通变化时，宿主按 `danmakuListVersion` 重新发送整表；用户发送成功时，因为本渲染器声明了 `supportsRealtimeAdd: true`，宿主改发单条 `add`，避免 `clear/reset` 清空正在显示的弹幕。

实时 `add` 不显式传递 `stime`，由 Titan 读取 `timelineSync()` 的当前秒数并标记为实时弹幕。历史 `load` 仍通过 `addList()` 载入，并把 NipaPlay 的秒转换成 Titan 所需的毫秒 `stime`。

## 弹幕字段转换

NipaPlay 数据会转换为 Titan 使用的结构：

| NipaPlay | Titan | 说明 |
| --- | --- | --- |
| `content` | `text` | 弹幕文字 |
| `time`（秒） | `stime`（毫秒） | 出现时间 |
| `type` / `originalType` | `mode` | 滚动 1、底部 4、顶部 5、逆向 6 |
| `fontSize` | `size` | 原始字号，缺省为 25 |
| `color` | `color` | CSS RGB 转为 24 位整数 |
| `danmakuId` | `dmid` | 缺失时生成本地 ID |

## iOS 中文字体

WKWebView 在页面未声明中文语言、指定字体又不存在时，可能为统一表意文字选择日文字形。插件和宿主页目前同时设置：

- `lang="zh-CN"`；
- `-webkit-locale: "zh-CN"`；
- 优先使用 iOS 自带的 `PingFang SC`；
- 回退到 `Hiragino Sans GB`、`Microsoft YaHei`、`Noto Sans CJK SC` 和 `Source Han Sans SC`。

如果升级后仍看到旧字形，请完全退出并重新启动 App。宿主页模板有独立版本号，升级后会生成新页面，但 Titan bundle 无需重新下载。

## 常见问题

### 设置中没有 Titan

- 确认插件已经启用。
- 确认当前平台为 Android 或 iOS。
- 查看插件设置中是否有清单解析或运行时加载错误。

### 选择后没有弹幕

- 确认首次加载时网络可访问清单中的 CDN。
- 检查日志中的“外部脚本下载失败”或“SHA-256 校验失败”。
- 确认视频已经成功加载弹幕数据，而不只是加载了视频。

### 更新 bundle 后完整性校验失败

外部文件内容已经变化，但清单仍保留旧摘要。确认新文件来源可信后，重新计算并更新 `sha256`，不要直接删除校验字段作为长期解决方案。

### 播放、跳转后弹幕不同步

重点检查适配层的 `clock.seekRevision`、`playbackRate`、时间偏移，以及 `engine.seek()` 是否使用秒作为参数。Titan 弹幕条目的 `stime` 则使用毫秒。

## 安全与许可

`script.external` 允许插件执行远程 JavaScript，属于高权限能力。请固定依赖版本和 SHA-256，不要引用会随时变化的分支地址。

NipaPlay 中的插件适配层与外部 Titan bundle 是两个独立部分。外部引擎的来源、许可、再分发和使用条件需要由插件发布者单独确认；README 中的技术接入说明不构成对外部代码许可状态的声明。
