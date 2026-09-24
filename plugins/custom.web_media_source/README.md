# 哔哩哔哩链接播放

让 NipaPlay 支持播放哔哩哔哩视频。使用方法：在“视频播放”页面点击“输入链接”，粘贴哔哩哔哩视频链接后点击“播放链接”。

插件作为独立脚本导入，不随应用自动加载。

1. 使用包含 `url.resolve` 接口的宿主构建。
2. 在设置 → 插件中导入 `custom.web_media_source.js`，确认权限并启用。
3. 在“视频播放”页面点击“输入链接”，粘贴哔哩哔哩完整视频链接或短链接后点击“播放链接”。
4. 多个条目时先选择分集，随后以标题自动搜索弹幕；确认匹配结果后开始播放。关闭搜索窗口可跳过弹幕，取消分集选择则终止本次操作。启用“跳过弹幕匹配”时不弹出搜索窗口。

历史记录保存稳定页面地址，重播时重新获取媒体地址。仅处理接口公开提供的普通视频和单段音视频文件；不提供登录、付费或地区限制处理，也不拼接多段媒体。可用清晰度由远端接口决定。需要账户权限的内容会显示解析错误。

宿主接口见 [通用链接解析](../../js-plugin-api.md#15-通用链接解析)。需要包含 [宿主 PR #942](https://github.com/AimesSoft/NipaPlay-Reload/pull/942) 接口的构建，旧版宿主不会调用解析入口。

验证：

```sh
node --test plugins/custom.web_media_source/custom.web_media_source.test.cjs
```

## 启动时装载

在 NipaPlay 源码目录编译 macOS Release 版后，可以传入本仓库中脚本的绝对路径。播放性能测试应使用优化构建：

```sh
flutter build macos --release
"$(pwd)/build/macos/Build/Products/Release/NipaPlay.app/Contents/MacOS/NipaPlay" --load-js "/绝对路径/Nipaplay-plugins/plugins/custom.web_media_source/custom.web_media_source.js"
```

`--load-js=<路径>` 也可使用。启动命令在 Rust 的 `rust/src/api/startup_commands.rs` 解析；脚本装载成功或失败会通过 `rust/src/api/client_notifications.rs` 的通知接口显示应用弹窗。再次传入同一路径会重新读取并装载同版本脚本，适合测试修改。已有实例运行时，新命令会转发给该实例。首次装载后脚本会保持启用。
