# 插件投稿指南

欢迎为 NipaPlay 贡献插件！请遵循以下流程。

## 前置条件

- 阅读 [JS 插件接口文档](js-plugin-api.md)，了解可用接口和约束，若您需要的接口未暴露请直接在[Issue](https://github.com/AimesSoft/Nipaplay-plugins/issues)中说明并提交申请。
- 确认插件不依赖 Web 平台（当前 JS 插件运行时不支持 Web）。

## 投稿流程

1. **Fork** 本仓库。
2. 在 `plugins/` 下创建子目录，以你的插件 ID 命名，例如 `plugins/my.filter/`。
3. 在该目录中编写插件 `.js` 文件（文件名与目录名保持一致，如 `my.filter.js`）。
4. （可选但建议）添加 `README.md` 说明插件用途。
5. 提交 Pull Request。

> **无需手动编辑 `plugins.json`。** PR 合并后，CI 会自动从插件源文件中读取 `pluginManifest` 并更新索引。

## 插件编写规范

### 必须

- 插件文件必须是 `.js` 格式。
- 必须声明 `pluginManifest` 对象，且 `id`、`name`、`version` 为非空字符串。
- `id` 必须全局唯一，建议使用 `前缀.名称` 格式（如 `my.filter`）。

### 可选

- `pluginBlockWords` — 字符串数组，用于弹幕过滤。
- `pluginUIEntries` — 数组，用于在设置页生成功能入口。
- `pluginHandleUIAction(actionId)` — 函数，处理用户点击事件。

### 文件命名

- 插件 JS 文件名应与插件 ID 一致，如 ID 为 `my.filter` 则文件名为 `my.filter.js`。
- 目录名与插件 ID 一致。

## CI 自动同步索引

PR 合并到 `main` 后，GitHub Actions 会自动运行同步脚本：

- **新增插件** — 检测到 `plugins/` 下新目录，解析 `pluginManifest` 并追加到 `plugins.json`。
- **更新插件** — 检测到插件文件变更，重新解析并更新对应条目。
- **删除插件** — 检测到插件目录被移除，从 `plugins.json` 中删除对应条目。

你只需保证 `pluginManifest` 声明正确即可，索引维护由 CI 完成。

## plugins.json 索引格式（参考）

以下为 CI 自动生成的索引条目格式，**无需手动填写**：

```json
{
  "id": "my.filter",
  "name": "我的过滤器",
  "version": "1.0.0",
  "description": "简要描述插件功能",
  "author": "你的名字",
  "github": "https://github.com/yourname/yourrepo",
  "file": "plugins/my.filter/my.filter.js"
}
```

字段来源：
- `id`、`name`、`version`、`description`、`author`、`github` — 从插件的 `pluginManifest` 读取。
- `file` — 由 CI 根据文件路径自动填入。

## 注意事项

- 插件运行在 `flutter_js` 沙箱中，无法访问文件系统、网络或 Dart/Flutter API。
- 返回值格式不正确会导致错误（如 `pluginHandleUIAction` 的 `type` 必须为 `text`）。
- 请确保屏蔽词和正则表达式经过测试，避免误杀正常弹幕。
- PR 中请简要说明插件的用途和测试情况。
