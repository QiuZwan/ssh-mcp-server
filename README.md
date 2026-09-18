<div align="center">

<img src="images/logo.png" alt="ssh-mcp-server logo" width="160">

# SSH MCP Server

**让 AI 客户端安全地操作你的服务器 —— 基于 SSH 的 MCP 服务器**

通过标准化 MCP 工具在远端执行命令与传输文件，内置 Web 管理台与 Windows 托盘应用。

[![Release](https://img.shields.io/github/v/release/QiuZwan/ssh-mcp-server)](https://github.com/QiuZwan/ssh-mcp-server/releases)

</div>

## 它能做什么

把 Claude Code、Cursor 等支持 MCP 协议的 AI 客户端连到你的 SSH 服务器上，AI 就可以：

- ⚙️ **执行命令** —— 远程运维、日志排查、服务管理
- 📤 **上传 / 📥 下载文件** —— 配置分发、日志拉取、大文件断点续传
- 🖥️ **多机管理** —— 项目 → 环境 → 主机三级树，一次配置处处可用

两种使用形态，按需选择：

| 形态 | 适合场景 |
|------|---------|
| **Windows 桌面应用**（推荐） | 纯托盘常驻 + 内置 Web 管理台 + 在线自更新，零 Node.js 环境 |
| **CLI / npm 包** | 作为 stdio MCP Server 挂给任意 MCP 客户端，轻量即用 |

> 均以**本地安装**方式交付：不依赖每次启动去 npm registry 解析版本，内网 / 弱网环境同样可用。

## ✨ 核心特性

### 连接能力

- 🔐 多种认证：密码 / 私钥（含加密私钥）/ SSH Agent / 键盘交互式 **2FA**
- 🔗 SOCKS5 与 HTTP(S) 代理，穿透跳板网络
- 🚄 双传输模式：
  - `exec` —— 每命令一通道，标准 Linux 主机
  - `shell` —— 持久会话 + 标记协议，适配**堡垒机 / 跳板机**
- ⏱️ 连接 / 命令 / SFTP 三级超时独立可控；大文件走 fastPut/fastGet 分片并发

### 安全策略

- 命令白名单 / 黑名单（正则），主机级与全局级双层过滤
- 本地与远端路径白名单，约束文件传输范围
- 全量审计日志：命令、输出、传输记录可追溯

### Web 管理台

- 项目-环境-主机三级可视化管理，连接拖拽排序
- 测试连接、JSON 批量导入导出、`~/.ssh/config` 自动复用
- 定时备份快照与一键恢复；MCP 客户端（Claude Code 等）一键注册
- 明暗双主题，跟随系统切换

### Windows 桌面应用

- 🎯 **纯托盘单 exe**：SSH 服务、MCP Server、Admin 静态站点全部内嵌，无 Node.js 依赖
- 开机自启、关机驻留；「打开管理页」直达系统默认浏览器
- 🔄 在线自更新：内置 minisign 验签，自动检测新版本静默升级

## 📸 界面一览

**连接管理** —— 三级树管理全部主机：

<div align="center"><img src="https://raw.githubusercontent.com/QiuZwan/ssh-mcp-server/main/docs/screenshots/connections.png" alt="连接管理界面" width="820"></div>

**系统页** —— 服务状态、MCP 客户端一键注册、自启动与应用更新：

<div align="center"><img src="https://raw.githubusercontent.com/QiuZwan/ssh-mcp-server/main/docs/screenshots/system.png" alt="系统页" width="820"></div>

## 🚀 快速开始

### 方式一：Windows 桌面应用（推荐）

从 [Releases](https://github.com/QiuZwan/ssh-mcp-server/releases) 下载 `SSH-MCP-Server_x.x.x_x64-setup.exe` 安装。启动后驻留系统托盘，托盘菜单「打开管理页」进入 Web 控制台，无需 Node.js 环境。

在管理台把项目 → 环境 → 主机配好后，进入 **系统 → 一键注册**，选择客户端（Claude / VS Code / Cursor）与作用域，即可把 MCP 客户端指向本机服务：

```json
{
  "mcpServers": {
    "ssh-server": {
      "type": "http",
      "url": "http://127.0.0.1:61823/mcp"
    }
  }
}
```

服务常驻复用，客户端配置一次即长期有效；主机增删改在管理台完成，保存即时生效，无需重启 MCP 会话。已安装用户升级由内置自更新完成（Releases + minisign 验签），也可在 **系统 → 应用更新** 手动检查。

### 方式二：CLI / npm 包（全局安装）

```bash
npm install -g @keysqiu/ssh-mcp-server
```

在 MCP 客户端中注册（以 Claude Code 为例）：

```bash
claude mcp add ssh-server -- ssh-mcp-server --host your.server.com --username root --password YOUR_PWD
```

或直接写 JSON 配置：

```json
{
  "mcpServers": {
    "ssh-server": {
      "command": "ssh-mcp-server",
      "args": ["--host", "your.server.com", "--username", "root", "--password", "YOUR_PWD"]
    }
  }
}
```

此形态为传统 stdio MCP Server：客户端拉起子进程直连，不需要常驻服务。若想要 Web 管理台，用 `ssh-mcp-server --admin` 启动同一套管理台（`http://127.0.0.1:61823/admin/`），再由客户端连 `http://127.0.0.1:61823/mcp`。

> **为什么不用 `npx`**：`npx @keysqiu/ssh-mcp-server` 每次启动都要访问 npm registry 解析并下载版本，内网 / 弱网环境下经常卡住或失败。全局安装后包已在本地，启动不再联网取包。

配置文件与多连接模式详见 [`docs/migration.md`](docs/migration.md) 与 CLI 帮助（`--help`）。

### 方式三：源码构建

```bash
git clone https://github.com/QiuZwan/ssh-mcp-server.git
cd ssh-mcp-server && npm install

npm run build                 # 构建 Node 版
npm test                      # 运行测试
npm --prefix admin-web install && npm run build:admin   # 构建管理台前端
npm run build:tauri           # 构建 Windows 桌面应用（含前端，需 Rust 工具链）
```

## 🧰 MCP 工具一览

| 工具 | 说明 |
|------|------|
| `execute-command` | 远程执行命令，支持目录切换、超时与输出限制，受白/黑名单约束 |
| `upload` / `download` | SFTP 文件传输，大文件分片并发，路径白名单校验 |
| `list-servers` | 列出所有可用连接 |

## 🏗️ 架构

```
┌─ Windows 桌面应用（Tauri 2 纯托盘单 exe）──────────────────┐
│                                                            │
│  SSH 连接池 ── MCP StreamableHTTP (/mcp)                   │
│      │                                                     │
│  Admin API (/admin/api/*) ── 内嵌静态站点 (/admin/)        │
│                                                            │
└────────────────── 系统默认浏览器打开管理页 ────────────────┘

Node 版（npm 包）：stdio MCP Server ＋ 可选 --admin 启动同一套 Web 管理台
```

关键模块：`src/services/ssh-connection-manager.ts`（SSH 核心）、`src/server/`（Fastify Admin 服务）、`src-tauri/`（Rust 桌面壳）、`admin-web/`（React 管理台）。

## 📋 更多文档

- [使用迁移指南](docs/migration.md) —— 各客户端接入配置
- [更新日志](CHANGELOG.md)

## 📄 许可证

[ISC](LICENSE) © SIE Operations and Maintenance Team
