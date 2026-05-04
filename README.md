# Nipaplay-plugins

NipaPlay 官方 JS 插件市场。在这里浏览、下载和提交插件。

## 相关文档

- [JS 插件接口文档](js-plugin-api.md) — 插件可用接口与编写规范
- [插件投稿指南](CONTRIBUTING.md) — 如何提交你的插件

## 目录结构

```
plugins/          # 插件源文件，每个插件一个子目录
plugins.json      # 插件索引（应用读取此文件获取插件列表，自动更新，开发者无需修改）
```

## 快速开始

1. 阅读 [接口文档](js-plugin-api.md) 了解插件 API。
2. 在 `plugins/` 下创建你的插件目录并编写 `.js` 文件。
4. 提交 Pull Request。
