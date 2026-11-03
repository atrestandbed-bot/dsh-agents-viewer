/**
 * dsh-agents-viewer — 查看并编辑 AGENTS.md 指令链。
 *
 * 两个面：
 *   ① 命令 /agents：列表 / 看全文 / 外部编辑器打开 / 新建
 *   ② 界面：DSH 右侧栏里的原生 AGENTS.md tab。客户端用
 *      `ctx.sidebarRightTabs.register` 注册类型，用 `sidebar.right.pane.tab`
 *      槽挂正文。
 *
 * 宿主负责 HTTP 路由（/list /read /write /ui）和 /agents 命令；另外注入
 * 一层可热改的 `runtime/override.css`——它在每次 index 请求时现读，所以
 * 改样式只要刷新页面，不用重启。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis 插件名。 */
export const name = "dsh-agents-viewer";

/** 没有必需服务；路由通过 ctx.inject 延迟挂载。 */
export const inject = [];

const ROUTE_PREFIX = "/dsh-agents-viewer";
const GLOBAL_FILE = "AGENTS.md";
const PROJECT_FILES = ["AGENTS.md", "CLAUDE.md", "AGENTS.local.md", "CLAUDE.local.md"];
const MAX_CHARS = 24000;
const BODY_LIMIT = 2 * 1024 * 1024;
const EDITOR_GRACE_MS = 1500;

const USAGE = [
  "指令",
  "  /agents                列出所有 AGENTS.md（含路径、大小、是否存在）",
  "  /agents <序号>          看第 n 个的全文",
  "  /agents all            看全部现有文件",
  "  /agents w <序号>        用外部编辑器打开第 n 个",
  "  /agents n              新建项目级 AGENTS.md（项目根）",
  "  /agents n global       新建全局 AGENTS.md（~/.dsh）",
  "  /agents n shared       新建共享 AGENTS.md（~/.agents）",
  "  /agents o              显示聊天头部的 AGENTS.md 按钮",
  "  /agents c              隐藏聊天头部的 AGENTS.md 按钮",
  "  /agents help           只看这份说明",
  "  右侧栏 AGENTS.md tab    在界面里直接读改写（原生 tab，不再有浮动面板）",
].join("\n");

const NEW_FILE_TEMPLATE = `# 项目规则

<!-- 由 /agents n 创建。这里写的规则，本目录及其子目录的会话都会加载。 -->
<!-- 改完保存即可；DSH 在会话开始时读取，已有会话要新开一个才生效。 -->

## 约定

- TODO
`;

// ── 基础工具 ──────────────────────────────────────────────────────────

function readFileInfo(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const text = fs.readFileSync(file, "utf8");
    return { path: file, size: st.size, text };
  } catch {
    return null;
  }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

function agentsHome() {
  return process.env.DSH_AGENTS_HOME || path.join(os.homedir(), ".agents");
}

function findProjectRoot(start) {
  let dir = start;
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
    } catch {
      /* 忽略不可读的祖先目录 */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function directoryChain(cwd, root) {
  const chain = [];
  let dir = cwd;
  for (;;) {
    chain.unshift(dir);
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return chain;
}

function collect(cwd) {
  const items = [];

  const globalPath = path.join(dshHome(), GLOBAL_FILE);
  items.push({ scope: "全局", label: "~/.dsh", expected: globalPath, file: readFileInfo(globalPath) });

  const sharedPath = path.join(agentsHome(), GLOBAL_FILE);
  items.push({ scope: "共享", label: "~/.agents", expected: sharedPath, file: readFileInfo(sharedPath) });

  const root = findProjectRoot(cwd);
  for (const dir of directoryChain(cwd, root)) {
    const rel = path.relative(root, dir) || ".";
    const scope = dir === root ? "项目" : "子目录";
    let seen = null;
    for (const fileName of PROJECT_FILES) {
      const file = path.join(dir, fileName);
      const info = readFileInfo(file);
      let duplicateOf = null;
      if (info) {
        const normalized = info.text.trim();
        if (seen && seen.text === normalized) duplicateOf = seen.name;
        else if (!seen) seen = { name: fileName, text: normalized };
      }
      items.push({ scope, label: rel, expected: file, file: info, duplicateOf });
    }
  }
  return { items, root, cwd };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  }
  return width;
}

function padRight(text, width) {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function padLeft(text, width) {
  const gap = Math.max(0, width - displayWidth(text));
  return " ".repeat(gap) + text;
}

function renderList({ items, root, cwd }) {
  const total = items.filter((it) => it.file).length;
  const lines = [];
  lines.push("AGENTS.md 指令链");
  lines.push(`工作目录：${cwd}`);
  lines.push(`项目根：${root}`);
  lines.push("");

  if (total === 0) lines.push("没有找到任何 AGENTS.md。用 /agents n 建一个。");

  const existing = [];
  for (const it of items) {
    const location = it.file ? it.file.path : it.expected;
    if (it.file) {
      existing.push(it);
      const n = existing.length;
      const dup = it.duplicateOf ? `  (内容同 ${it.duplicateOf}，不会重复加载)` : "";
      lines.push(`[${n}] ${padRight(it.scope, 5)}${padLeft(formatSize(it.file.size), 8)}  ${location}${dup}`);
    } else {
      lines.push(`[ ] ${padRight(it.scope, 5)}${padLeft("—", 8)}  ${location}`);
    }
  }

  lines.push("");
  lines.push(USAGE);
  return { text: lines.join("\n"), existing };
}

function renderOne(entries) {
  const parts = [];
  let budget = MAX_CHARS;
  for (const [index, it] of entries.entries()) {
    const header = `[${index + 1}] ${it.scope} — ${it.file.path}`;
    let body = it.file.text;
    if (body.length > budget) {
      body = body.slice(0, Math.max(0, budget)) + `\n\n…（已截断，原文件 ${formatSize(it.file.size)}）`;
      budget = 0;
    } else {
      budget -= body.length;
    }
    parts.push(`${header}\n${"─".repeat(Math.min(60, header.length))}\n${body.trimEnd()}`);
    if (budget <= 0) {
      const rest = entries.length - index - 1;
      if (rest > 0) parts.push(`…还有 ${rest} 个文件未显示（超出单次输出上限）`);
      break;
    }
  }
  return parts.join("\n\n");
}

// ── 外部编辑器 ────────────────────────────────────────────────────────

function findInPath(names) {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        /* 跳过不可读的 PATH 项 */
      }
    }
  }
  return null;
}

function codeExeFromShim(shim) {
  let dir = path.dirname(shim);
  for (let i = 0; i < 3; i++) {
    const candidate = path.join(dir, "Code.exe");
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* 继续向上 */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function candidateEditors() {
  const list = [];
  const custom = process.env.DSH_AGENTS_EDITOR;
  if (custom) {
    if (process.platform === "win32") {
      list.push({ cmd: process.env.ComSpec || "cmd.exe", args: ["/c", custom], label: custom });
    } else {
      list.push({ cmd: "/bin/sh", args: ["-c", `${custom} "$1"`, "sh"], label: custom });
    }
  }

  if (process.platform === "win32") {
    const shim = findInPath(["code.cmd", "code.exe", "code.bat"]);
    const exe = shim ? codeExeFromShim(shim) : null;
    if (exe) list.push({ cmd: exe, args: [], label: "VS Code" });
    const notepad = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "notepad.exe");
    if (fs.existsSync(notepad)) list.push({ cmd: notepad, args: [], label: "记事本" });
  } else if (process.platform === "darwin") {
    list.push({ cmd: "open", args: [], label: "默认程序" });
  } else {
    list.push({ cmd: "xdg-open", args: [], label: "默认程序" });
  }
  return list;
}

function openInEditor(file) {
  const candidates = candidateEditors();
  return new Promise((resolve) => {
    let index = 0;
    const tryNext = () => {
      if (index >= candidates.length) {
        resolve(null);
        return;
      }
      const { cmd, args, label } = candidates[index++];
      let settled = false;
      let child;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (ok) {
          try {
            child.unref();
          } catch {
            /* 已退出 */
          }
          resolve(label);
        } else {
          tryNext();
        }
      };
      try {
        child = spawn(cmd, [...args, file], { detached: true, stdio: "ignore", windowsHide: false });
      } catch {
        tryNext();
        return;
      }
      child.on("error", () => finish(false));
      child.on("exit", (code) => finish(code === 0));
      setTimeout(() => finish(true), EDITOR_GRACE_MS);
    };
    tryNext();
  });
}

// ── 项目与指令链 ───────────────────────────────────────────────────────

const SESSION_PATTERN = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function loadWorkspaceIndex() {
  const file = path.join(dshHome(), "storages", "workspace.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const workspaces = raw?.tables?.workspaces ?? {};
    const bySession = new Map();
    let newest = null;
    for (const [id, ws] of Object.entries(workspaces)) {
      if (!ws || typeof ws.path !== "string") continue;
      const updated = Date.parse(ws.updatedAt ?? ws.createdAt ?? "") || 0;
      if (newest === null || updated > newest.updated) newest = { path: ws.path, updated, id };
      for (const sid of ws.sessionIds ?? []) bySession.set(String(sid), ws.path);
    }
    return { bySession, newest };
  } catch {
    return { bySession: new Map(), newest: null };
  }
}

function resolveProject(hint) {
  const { bySession, newest } = loadWorkspaceIndex();
  const match = SESSION_PATTERN.exec(String(hint ?? ""));
  if (match) {
    const hit = bySession.get(match[0]);
    if (hit) return { path: hit, source: "session" };
  }
  if (newest) return { path: newest.path, source: "recent" };
  return { path: process.cwd(), source: "cwd" };
}

/**
 * 指令链的完整白名单：全局 / 共享 + 项目根到会话 cwd 的每一层目录。
 * 与 `/agents` 命令的 `collect()` 同一口径，面板不再只认项目根那 4 个文件。
 */
function instructionEntries(projectPath) {
  const root = findProjectRoot(projectPath);
  const list = [
    { scope: "全局", label: "~/.dsh", key: "global", path: path.join(dshHome(), GLOBAL_FILE) },
    { scope: "共享", label: "~/.agents", key: "shared", path: path.join(agentsHome(), GLOBAL_FILE) },
  ];
  for (const dir of directoryChain(projectPath, root)) {
    const rel = path.relative(root, dir) || ".";
    const scope = dir === root ? "项目" : "子目录";
    for (const fileName of PROJECT_FILES) {
      list.push({
        scope,
        label: rel,
        key: `project:${dir}:${fileName}`,
        path: path.join(dir, fileName),
      });
    }
  }
  return { list, root };
}

const normalize = (p) => path.resolve(String(p)).toLowerCase();

// ── 聊天头部按钮的开关 ────────────────────────────────────────────────

const UI_FILE = "dsh-agents-viewer.ui.json";

function readUiState() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dshHome(), "storages", UI_FILE), "utf8"));
    return { button: raw?.button !== false };
  } catch {
    return { button: true };
  }
}

function writeUiState(state) {
  const file = path.join(dshHome(), "storages", UI_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ button: state.button !== false }, null, 2) + "\n", "utf8");
}

let uiButtonVisible;

function currentUiState() {
  if (uiButtonVisible === undefined) uiButtonVisible = readUiState().button;
  return { button: uiButtonVisible };
}

function setUiButtonVisible(value) {
  writeUiState({ button: value });
  uiButtonVisible = value;
}

// ── HTTP 小工具 ───────────────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── 插件入口 ──────────────────────────────────────────────────────────

export function apply(ctx) {
  const packageRoot = path.dirname(fileURLToPath(import.meta.url));
  const overrideFile = path.join(packageRoot, "runtime", "override.css");
  const readOverride = () => {
    try {
      return fs.readFileSync(overrideFile, "utf8");
    } catch {
      return "";
    }
  };

  // 可热改的 CSS 覆盖层：每次 index 请求现读文件，改完刷新页面即可。
  ctx.on("webserver/index-inject", (table) => {
    if (!Array.isArray(table)) return;
    const css = readOverride();
    if (css) table.push({ kind: "style", text: css });
  });

  // ① 路由。
  ctx.inject(["webServer"], (child) => {
    child.effect(() => {
      const disposers = [];

      disposers.push(
        child.webServer.register({
          kind: "exact",
          path: `${ROUTE_PREFIX}/list`,
          handler: (req, res) => {
            try {
              const url = new URL(req.url ?? "/", "http://127.0.0.1");
              const project = resolveProject(url.searchParams.get("hint") ?? "");
              const { list, root } = instructionEntries(project.path);
              const files = list.map((entry) => {
                const info = readFileInfo(entry.path);
                return {
                  scope: entry.scope,
                  label: entry.label,
                  key: entry.key,
                  path: entry.path,
                  exists: info !== null,
                  size: info?.size ?? 0,
                };
              });
              sendJson(res, 200, {
                ok: true,
                project: project.path,
                source: project.source,
                root,
                files,
              });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      disposers.push(
        child.webServer.register({
          kind: "exact",
          path: `${ROUTE_PREFIX}/read`,
          handler: (req, res) => {
            try {
              const url = new URL(req.url ?? "/", "http://127.0.0.1");
              const target = url.searchParams.get("path") ?? "";
              const project = resolveProject(url.searchParams.get("hint") ?? "");
              const { list } = instructionEntries(project.path);
              if (!list.some((entry) => normalize(entry.path) === normalize(target))) {
                sendJson(res, 403, { ok: false, error: "这个路径不在 AGENTS.md 指令链里，拒绝读写。" });
                return;
              }
              const info = readFileInfo(target);
              sendJson(res, 200, { ok: true, exists: info !== null, content: info?.text ?? "", size: info?.size ?? 0 });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      disposers.push(
        child.webServer.register({
          kind: "exact",
          path: `${ROUTE_PREFIX}/write`,
          handler: async (req, res) => {
            try {
              if (String(req.method ?? "GET").toUpperCase() !== "POST") {
                sendJson(res, 405, { ok: false, error: "只接受 POST" });
                return;
              }
              const body = JSON.parse((await readBody(req)) || "{}");
              const project = resolveProject(body?.hint ?? "");
              const { list } = instructionEntries(project.path);
              const target = String(body?.path ?? "");
              if (!list.some((entry) => normalize(entry.path) === normalize(target))) {
                sendJson(res, 403, { ok: false, error: "这个路径不在 AGENTS.md 指令链里，拒绝写入。" });
                return;
              }
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, String(body?.content ?? ""), "utf8");
              const info = readFileInfo(target);
              sendJson(res, 200, { ok: true, path: target, size: info?.size ?? 0 });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      disposers.push(
        child.webServer.register({
          kind: "exact",
          path: `${ROUTE_PREFIX}/debug`,
          handler: (req, res) => {
            try {
              const loader = ctx.get("loader");
              const cm = ctx.get("clientModules");
              let resolved = null;
              let resolveError = null;
              try {
                resolved = createRequire(ctx.baseUrl).resolve("dsh-agents-viewer/package.json");
              } catch (error) {
                resolveError = `${error?.code ?? ""}: ${error instanceof Error ? error.message : String(error)}`;
              }
              const entries = loader
                ? [...loader.entries()].map((entry) => ({
                    name: entry.options?.name,
                    fiber: entry.fiber !== undefined,
                    disabled: entry.disabled === true,
                  }))
                : null;
              sendJson(res, 200, {
                ok: true,
                baseUrl: ctx.baseUrl,
                resolved,
                resolveError,
                clientPath: cm?.clientPath?.("dsh-agents-viewer") ?? null,
                graph: cm?.graph?.() ?? null,
                entries,
              });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      disposers.push(
        child.webServer.register({
          kind: "exact",
          path: `${ROUTE_PREFIX}/ui`,
          handler: (req, res) => {
            try {
              sendJson(res, 200, { ok: true, ...currentUiState() });
            } catch (error) {
              sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
          },
        }),
      );

      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {
            /* 释放失败不该抛到宿主 */
          }
        }
      };
    });
  });

  // ② 命令。
  ctx.inject(["commands", "workingDirectory"], (child) => {
    child.commands.register({
      name: "agents",
      description: "查看并编辑全局、共享与项目级的 AGENTS.md",
      input: { hint: "[序号] 看 · all 全部 · w <序号> 编辑 · n 新建 · o 显示按钮 · c 隐藏按钮 · help 用法" },
      handler: async ({ agent, rawInput }) => {
        const arg = String(rawInput ?? "").trim();

        if (arg === "o" || arg === "show") {
          try {
            setUiButtonVisible(true);
            return { kind: "success", text: "已记录：AGENTS.md 按钮将在下次启动 DSH 后显示。" };
          } catch (error) {
            return { kind: "error", text: `写入按钮状态失败：${error instanceof Error ? error.message : String(error)}` };
          }
        }

        if (arg === "c" || arg === "hide") {
          try {
            setUiButtonVisible(false);
            return { kind: "success", text: "已记录：AGENTS.md 按钮将在下次启动 DSH 后隐藏。" };
          } catch (error) {
            return { kind: "error", text: `写入按钮状态失败：${error instanceof Error ? error.message : String(error)}` };
          }
        }

        if (arg === "help" || arg === "?" || arg === "-h") return { kind: "success", text: USAGE };

        let cwd;
        try {
          cwd = await child.workingDirectory.ensure(agent);
        } catch (error) {
          return { kind: "error", text: `无法确定当前工作目录：${error instanceof Error ? error.message : String(error)}` };
        }

        const listed = renderList(collect(cwd));

        if (arg === "") return { kind: "success", text: listed.text };

        if (arg === "n" || arg === "new" || arg.startsWith("n ") || arg.startsWith("new ")) {
          const kind = arg.replace(/^(n|new)\s*/, "").trim() || "project";
          let target = null;
          if (kind === "global") target = { path: path.join(dshHome(), GLOBAL_FILE), scope: "全局" };
          else if (kind === "shared") target = { path: path.join(agentsHome(), GLOBAL_FILE), scope: "共享" };
          else if (kind === "project") target = { path: path.join(findProjectRoot(cwd), GLOBAL_FILE), scope: "项目根" };

          if (!target) return { kind: "error", text: `层级只能是 global、shared 或 project，收到：${kind}\n\n${USAGE}` };
          if (fs.existsSync(target.path)) return { kind: "error", text: `已存在：${target.path}\n想改它用 /agents w <序号>。` };

          fs.mkdirSync(path.dirname(target.path), { recursive: true });
          fs.writeFileSync(target.path, NEW_FILE_TEMPLATE, "utf8");
          const editor = await openInEditor(target.path);
          return {
            kind: "success",
            text: `已创建 ${target.scope} 规则：${target.path}\n${editor ? `用 ${editor} 打开。` : "没有可用编辑器，请手动打开。"}\n\n注意：DSH 在会话开始时读取指令文件，改完要新开一个会话才生效。`,
          };
        }

        if (/^(w|open|edit)(\s|$)/.test(arg)) {
          const rest = arg.replace(/^(w|open|edit)\s*/, "").trim();
          if (!rest) return { kind: "error", text: `用法：/agents w <序号>，序号来自 /agents 列表。` };
          const index = Number.parseInt(rest, 10);
          if (!Number.isInteger(index) || String(index) !== rest || index < 1 || index > listed.existing.length) {
            return { kind: "error", text: `序号超出范围：只接受 1–${listed.existing.length}。先跑 /agents 看清单。` };
          }
          const file = listed.existing[index - 1].file.path;
          const editor = await openInEditor(file);
          return {
            kind: "success",
            text: editor
              ? `已用 ${editor} 打开原文件：\n${file}\n\n改完保存即可。DSH 在会话开始时读取指令文件，已有会话要新开一个才生效。`
              : `没找到能用的编辑器。文件在这里，请手动打开：\n${file}`,
          };
        }

        if (arg === "all") {
          if (listed.existing.length === 0) return { kind: "success", text: listed.text };
          return { kind: "success", text: `${listed.text}\n\n${renderOne(listed.existing)}` };
        }

        const index = Number.parseInt(arg, 10);
        if (Number.isInteger(index) && String(index) === arg) {
          if (index < 1 || index > listed.existing.length) {
            return { kind: "error", text: `序号超出范围：只接受 1–${listed.existing.length}。先跑 /agents 看清单。` };
          }
          return { kind: "success", text: renderOne([listed.existing[index - 1]]) };
        }

        const asPath = path.resolve(cwd, arg);
        const info = readFileInfo(asPath);
        if (!info) return { kind: "error", text: `找不到文件：${asPath}` };
        return { kind: "success", text: renderOne([{ scope: "指定文件", file: info }]) };
      },
    });
  });
}
