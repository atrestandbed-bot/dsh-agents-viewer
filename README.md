# dsh-agents-viewer

在 DSH（DeepSeek Harness）**右侧栏的原生 tab** 里查看和编辑 `AGENTS.md` 指令链 —— 聊天头部还有一个一键打开的按钮，外加一个 `/agents` 命令。

> 需要带 `ctx.sidebarRightTabs` 的 DSH（44.7.0 已验证）。客户端通过公开的 tab 注册表接入，不再注入 DOM、不再扫描按钮、不再猜项目。

## 功能

- **右侧栏原生 tab**：在右侧栏的「添加」菜单 / 引导页里打开 `AGENTS.md`。用 DSH 自己的 tab、分栏、全屏、拖拽和收起，不再有浮动抽屉、遮罩、`requestAnimationFrame` 跟随，也不会出现「等 30 秒兜底按钮」。
- **聊天头部按钮**：会话标题右侧、右侧栏/文件按钮的左边有一个 AGENTS.md 图标，点一下直接打开原生 tab（如果右侧栏收起，会一起展开）。默认显示；`/agents c` 隐藏，`/agents o` 重新显示，状态持久化。
- **完整指令链**：全局 `~/.dsh/AGENTS.md`、共享 `~/.agents/AGENTS.md`，以及项目根到会话 cwd 的**每一层目录**下的 `AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md`。面板与 `/agents` 命令现在同一口径，子目录里的文件也能直接改。
- **精确项目**：tab 正文从标准 props 拿到 `sessionId` / `useSessions`，宿主按 session id 反查 workspace；不再用「最近更新的工作区」猜。
- **原地编辑保存**：列表点选 → 编辑 → `Ctrl+S` 或「保存」；不存在的文件写内容保存即创建。
- **`/agents` 命令**（不依赖界面，任何情况可用）：

  ```
  /agents                列出所有 AGENTS.md
  /agents <序号>          看全文
  /agents all            看全部
  /agents w <序号>        用外部编辑器打开
  /agents n              新建（项目级）
  /agents n global       新建全局
  /agents n shared       新建共享
  /agents o              显示聊天头部的 AGENTS.md 按钮
  /agents c              隐藏聊天头部的 AGENTS.md 按钮
  /agents help           用法
  ```

## 安装（给别人用）

这个包是标准的 DSH dual-face bundle：宿主半在 `index.js`，客户端半在 `runtime/client.js`，由 `package.json` 的 `dsh.client` 声明。装进某个 profile：

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$name    = "dsh-agents-viewer"

# 1) 把包目录复制进去（要包含 runtime/client.js）
Copy-Item -Recurse -Force "<这个包的路径>" "$profile\node_modules\$name"

# 2) 在 profile 的 package.json 里登记：
#    dependencies 里加   "dsh-agents-viewer": "file:<这个包的绝对路径>"
#    dsh.profile.bundles 末尾追加   "dsh-agents-viewer"

# 3) 重启 DSH（客户端 tab 的类型注册发生在启动时）
```

改之前建议先备份 profile 的 `package.json` 和 `cordis.patch.yml`。

## 文件

```
index.js            宿主：HTTP 路由（/list /read /write /ui）+ /agents 命令
runtime/client.js   客户端：sidebarRightTabs 注册 + tab 正文 + 头部按钮（手写 bundle，无构建）
cordis.patch.yml    bundle 补丁：插入 dsh-agents-viewer 一行
locale/*.json       插件管理器里显示的标题与描述
icon.svg            图标
```

## 实现要点

- **客户端**：`ctx.sidebarRightTabs.register({ id, kind, priority, title, guide, keepMounted })` 注册页面类型；正文通过 `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)` 挂载。正文的标准 props 直接给 `sessionId` 和 `useSessions`，没有 DOM 观察、没有 URL 解析。
- **头部按钮**：注册进 `conversation.session.header.actions`（list 槽，`order: 10`），`inject` 里带一个 `open()`，调用 `ctx.sidebarRight.openTab('agents')`。`/agents o` / `/agents c` 写 `~/.dsh/storages/dsh-agents-viewer.ui.json`，客户端通过 `/ui` 轮询（800ms，一个页面共享一个定时器）同步显示/隐藏。
- **宿主**：`webServer.register` 暴露 `/dsh-agents-viewer/list`、`/read`、`/write`；`resolveProject(hint)` 从 `hint` 里的 `session-<uuid>` 反查 `~/.dsh/storages/workspace.json`。拿不到会话才退回最近工作区，并在 tab 上标「推断」、保存前确认。
- **白名单**：全局 / 共享 + 项目根到 cwd 的目录链；其余路径一律 403。写盘是宿主进程直接 `fs.writeFileSync`，白名单是唯一入口。
- **兼容性**：不再有 DOM 版本闸门；兼容性由 `sidebarRightTabs` 服务是否存在决定。DSH 升级后如果服务改名/变形，tab 不会注册，`/agents` 命令仍可用。

## 已知限制

- **没有浮动面板**：tab 只在右侧栏里；头部按钮在 `conversation.session.header.actions`（会话标题右侧、右侧栏/文件按钮左边），不在右侧栏的 tab 条上。
- **`/agents o` / `c` 有约 0.8 秒同步延迟**：状态由宿主写文件、客户端轮询读取；不影响 tab 本身。
- **面板保存不触发指令热刷新**：宿主是直接写盘，`dsh-agent-instructions` 只会在后续一次 `read / write / edit` 工具调用时刷新。当前会话要立刻看到新内容，需要新开会话，或让 agent 对该文件做一次读写。
- **指令链只覆盖项目根到会话 cwd 的目录链**：链外的任意子目录不会出现在列表里（与 `/agents` 命令一致）。
- 首次安装/升级需要重启 DSH，客户端模块图在启动时组装。

## 许可

MIT
