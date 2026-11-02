# dsh-agents-viewer

在 DSH（DeepSeek Harness）里直接查看和编辑 `AGENTS.md` 指令链 —— 一个**编辑器侧的侧边栏面板**，外加一个 `/agents` 命令。

> 适配 **DSH 44.7.0**。版本不符时面板会**自动关闭**（按钮不出现），命令仍然可用，避免布局错位。

## 功能

- **侧边栏面板**：点聊天区右上角的文档图标，自动展开 DSH 原生右侧边栏，面板铺满它
  - 对话区会**真的变窄**（借用原生布局，不遮挡）
  - 中间的分界线可以拖，面板**逐帧跟随**（无延迟）
  - 再点一次图标收起（同时收起它打开的侧边栏）
- **三层指令链**：全局 `~/.dsh/AGENTS.md`、共享 `~/.agents/AGENTS.md`、项目根下 `AGENTS.md / CLAUDE.md / AGENTS.local.md / CLAUDE.local.md`
- **原地编辑保存**：列表点选 → 编辑 → `Ctrl+S` 或「保存」；不存在的文件写内容保存即创建
- **`/agents` 命令**（不依赖界面，任何情况可用）：
  ```
  /agents                列出所有 AGENTS.md
  /agents <序号>          看全文
  /agents all            看全部
  /agents w <序号>        用外部编辑器打开
  /agents n              新建（项目级）
  /agents n global       新建全局
  /agents n shared       新建共享
  /agents help           用法
  ```

## 安装（给别人用）

这个包是标准的 DSH bundle（`dsh.bundle.patch`）。装进某个 profile：

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
$name    = "dsh-agents-viewer"

# 1) 把包目录复制进去
Copy-Item -Recurse -Force "<这个包的路径>" "$profile\node_modules\$name"

# 2) 在 profile 的 package.json 里登记：
#    dependencies 里加   "dsh-agents-viewer": "file:<这个包的绝对路径>"
#    dsh.profile.bundles 末尾追加   "dsh-agents-viewer"

# 3) 重启 DSH
```

改之前建议先备份 `package.json` 和 `cordis.patch.yml`。

## 文件

```
index.js            宿主：HTTP 路由（/list /read /write）+ 注入 + /agents 命令
runtime/panel.js    注入到页面的界面脚本（按钮 + 抽屉 + dock 逻辑）
runtime/panel.css   面板样式
cordis.patch.yml    bundle 补丁：插入 dsh-agents-viewer 一行
locale/*.json       插件管理器里显示的标题与描述
icon.svg            图标
```

## 实现要点

- **数据通路**：宿主用 `webServer.register` 暴露接口，页面用同源 `fetch` 调用（与 `dsh-video-skin` 同一套机制）
- **安全**：宿主侧白名单，只允许 `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md`、项目根那 4 个文件名，其余路径一律 403
- **dock 模式**：点按钮 → 触发 app 自己的「打开右侧边栏」→ 逐帧读侧栏左边界 → 面板铺满从该边界到窗口右下
- **不闪烁**：`data-pending` 标记，首帧没量到宽度前不显示，避免"先小后大"
- **跟随**：`requestAnimationFrame` 每帧同步，值不变则不写样式（避免无谓重排）

## 已知限制

- **面板会盖住侧边栏原有的页签**（浏览器/终端）。这是"占位"的必然代价 —— 想和它们并排共存，需要往 dockkit 的页签注册表里注册新类型，而那套注册表是 `sidebar-right` 插件内部创建的，没有对插件开放。
- **版本绑定**：按钮定位依赖当前界面的 DOM 结构，所以用 `SUPPORTED_DSH_VERSION` 做了闸门。DSH 升级后面板自动停用，不会错位，但需要重新适配。
- 当前会话已加载的指令是快照，**改完要新开一个会话**才生效。

## 许可

MIT
