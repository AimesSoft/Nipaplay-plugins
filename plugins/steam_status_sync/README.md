# steam_status_sync

**注意：使用前务必仔细阅读本文档！**

将 NipaPlay 当前观看的番剧信息同步到 Steam 状态的桥接程序专用脚本。

示例：Steam 好友会看到你的状态显示为"CLANNAD AFTER STORY - 第22话 小小的手心"。

## 安装

### 从源码构建（唯一）

需要安装 [Bun](https://bun.sh/)。

```bash
git clone https://github.com/makabaka11/NipaPlay-Steam-Bridge.git
cd NipaPlay-Steam-Bridge
bun install

# 编译为当前平台的独立可执行文件
bun run build

# 或指定平台
bun run build:macos
bun run build:linux
bun run build:windows
```

编译产物为单个可执行文件，无需安装 Bun/Node.js 即可运行。使用方法

### 重要：首次启动（终端手动运行）

首次运行需要在终端中启动，以便完成 Steam Guard 认证。

1. 在可执行文件同目录下创建 `.env` 文件：
   ```bash
   cp example.env .env
   ```

2. 编辑 `.env`，填入 Steam 账号信息：
   ```
   STEAMUSERNAME=你的Steam账号
   STEAMPASSWORD=你的Steam密码
   NIPAPLAY_API_PORT=1180
   ```

3. 在终端中启动：
   ```bash
   ./nipaplay-steam-bridge
   ```

4. 根据提示完成 Steam Guard 验证：
   - **邮箱验证码**：终端会提示输入，输入后回车
   - **Steam App 审批**：在手机 Steam App 中批准登录请求，然后按回车**（若直接回车无效，请输入 5 位令牌代码后回车）**

5. 看到 `[steam] Logged in successfully.` 即登录成功。登录凭证会自动保存到可执行文件旁边的 `.steam-bridge-data/refresh-token.txt`，后续启动无需再次验证。

### 配合 NipaPlay 插件自动启动

完成首次认证后，可在 NipaPlay 中配置自动启动：

1. 打 NipaPlay → 设置 → 插件 → 插件市场 →Steam 状态同步
2. 开启"启用 Steam 状态同步"插件，打开插件配置页
3. 开启自动启动：在"Bridge 可执行文件路径"中填入可执行文件的完整路径（如 `/Applications/nipaplay-steam-bridge`）
4. 确认"远程控制端口"与 NipaPlay 设置中的远程访问端口一致（默认 1180）

之后每次 NipaPlay 启动并启用插件时，Bridge 会自动启动；关闭插件时自动停止。

> 如果不填写 Bridge 路径，则需要手动在终端中启动 Bridge 程序。

### 不使用 .env 文件

也可以通过环境变量直接传递配置：

```bash
STEAMUSERNAME=xxx STEAMPASSWORD=xxx NIPAPLAY_API_PORT=1180 ./nipaplay-steam-bridge
```

NipaPlay 插件自动启动时会自动设置 `NIPAPLAY_API_PORT` 环境变量，无需额外配置。

## 环境变量

| 变量 | 说明 | 必需 | 默认值 |
|------|------|------|--------|
| `STEAMUSERNAME` | Steam 账号名 | 首次登录必需 | - |
| `STEAMPASSWORD` | Steam 密码 | 首次登录必需 | - |
| `NIPAPLAY_API_PORT` | NipaPlay 远程控制 API 端口 | 否 | 1180 |
| `NIPAPLAY_API_HOST` | NipaPlay API 地址 | 否 | 127.0.0.1 |
| `POLL_INTERVAL_MS` | 轮询间隔（毫秒） | 否 | 3000 |
| `NOT_PLAYING_TEXT` | 未播放时显示的文本 | 否 | NipaPlay |
| `STEAMGUARD` | Steam Guard 验证码（用于自动化场景） | 否 | - |
| `STEAM_DEBUG` | 启用 Steam 调试日志（设为 `1`） | 否 | - |
| `BRIDGE_DATA_DIR` | 数据存储目录（refresh token 等） | 否 | 可执行文件同目录下 `.steam-bridge-data/` |

> 首次登录后，Steam Refresh Token 会自动保存。之后即使不设置 `STEAMUSERNAME`/`STEAMPASSWORD`，也能通过保存的 token 自动登录，直到 token 过期。

## 常见问题

### Bridge 启动后立即退出

- 确认 `.env` 文件位于可执行文件**同目录**下
- 确认已填写 `STEAMUSERNAME` 和 `STEAMPASSWORD`
- 在终端中手动运行查看具体错误信息

### macOS 提示"无法打开，因为无法验证开发者"

```bash
xattr -d com.apple.quarantine nipaplay-steam-bridge
```

### Steam 状态文字显示不完整

Steam 非 Steam 游戏状态文本有字节长度限制。Bridge 会自动截断过长文本，优先保留番剧名。

### Steam Guard 每次都要重新验证

Refresh Token 保存在可执行文件旁边的 `.steam-bridge-data/refresh-token.txt`。如果该文件被删除或目录不可写，则需要重新验证。Token 过期后也需要重新登录。

## License

MIT
