#!/usr/bin/env node
/**
 * One-command DSH adapter for this plugin.
 *
 *   npm run adapt                 # inspect the installed DSH + profile copy
 *   npm run adapt:install         # copy this checkout into the desktop profile
 *
 * Why the install path refuses to run while DSH is open: replacing a loaded
 * plugin under a live Host can reload its client bundle and disrupt the open
 * window. Quit DSH, run `npm run adapt:install`, then start DSH.
 *
 * The plugin itself is capability-based (`dsh.client.inject` is empty and the
 * code feature-detects services), so a DSH update normally needs no manifest
 * edit at all. This script exists to verify that, and to repair the profile
 * copy / bundle flag when they drift.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultProfileDir,
  ensureProfileBundle,
  readRuntime,
  resolveAsarPath,
  runningDshProcesses,
  satisfies,
  syncPlugin,
} from "./lib/dsh-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const install = process.argv.includes("--install");
const asarPath = resolveAsarPath(argument("--asar"));
const profileDir = path.resolve(argument("--profile") ?? defaultProfileDir());
const plugin = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));

const errors = [];
const info = [];

function walk(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), relative));
    else out.push(relative);
  }
  return out;
}

/** Files a profile copy is expected to contain, relative to the package root. */
function expectedFiles() {
  const entries = ["index.js", "package.json", "cordis.patch.yml", "README.md", "LICENSE", "icon.svg"];
  for (const dir of ["runtime", "locale", "scripts"]) {
    for (const file of walk(path.join(pluginDir, dir))) entries.push(`${dir}/${file}`);
  }
  return entries.filter((file) => fs.existsSync(path.join(pluginDir, file)));
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Compare the profile copy with this checkout. */
function compareInstalled() {
  const target = path.join(profileDir, "node_modules", "dsh-agents-viewer");
  if (!fs.existsSync(target)) return { state: "missing", target, missing: [], extra: [], changed: [] };
  const expected = expectedFiles();
  const missing = [];
  const changed = [];
  for (const file of expected) {
    const installed = path.join(target, file);
    if (!fs.existsSync(installed)) missing.push(file);
    else if (digest(path.join(pluginDir, file)) !== digest(installed)) changed.push(file);
  }
  const extra = walk(target).filter((file) => !expected.includes(file) && !file.startsWith("node_modules/"));
  const state = missing.length === 0 && changed.length === 0 && extra.length === 0 ? "in-sync" : "drift";
  return { state, target, missing, extra, changed };
}

function verifyRuntime() {
  if (!fs.existsSync(asarPath)) {
    errors.push(`找不到 DSH 安装：${asarPath}（用 --asar 指定 app.asar）`);
    return undefined;
  }
  let runtime;
  try {
    runtime = readRuntime(asarPath);
  } catch (error) {
    errors.push(`无法读取 ${asarPath}: ${error.message}`);
    return undefined;
  }
  const client = plugin.dsh?.client;
  if (client === undefined) errors.push("package.json 没有 dsh.client 声明。");
  else {
    if (client.platform !== "web") errors.push(`dsh.client.platform 是 ${JSON.stringify(client.platform)}，不是 "web"。`);
    for (const name of [...(client.inject ?? []), ...(client.external ?? [])]) {
      if (!runtime.packages.has(name)) errors.push(`dsh.client 引用了不存在的包：${name}`);
    }
  }
  const engines = plugin.engines?.dsh;
  if (typeof engines !== "string") errors.push("package.json 没有 engines.dsh。");
  else if (satisfies(runtime.version, engines) !== true) errors.push(`engines.dsh "${engines}" 不接受 DSH ${runtime.version}。`);
  const clientFile = path.resolve(pluginDir, plugin.exports?.["./client"] ?? "");
  if (!fs.existsSync(clientFile)) errors.push("客户端 bundle 不存在。");
  return runtime;
}

console.log(`plugin   ${plugin.name}@${plugin.version}`);
console.log(`checkout ${pluginDir}`);
console.log(`profile  ${profileDir}`);
console.log(`asar     ${asarPath}`);
console.log("");

const runtime = verifyRuntime();
if (runtime !== undefined) console.log(`runtime  ${runtime.name}@${runtime.version}`);

const running = runningDshProcesses();
if (running.length > 0) console.log(`DSH      running (pid ${running.join(", ")})`);
else console.log("DSH      not running");

if (install) {
  if (running.length > 0) {
    console.error("\nREFUSED  DSH 正在运行。先完整退出 DSH，再执行 npm run adapt:install。");
    console.error("         运行中替换插件文件可能触发客户端热重载，打断当前窗口。");
    process.exit(2);
  }
  if (errors.length > 0) {
    console.error("\nREFUSED  清单有问题，先修复：");
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }
  try {
    const before = compareInstalled();
    const target = syncPlugin(pluginDir, profileDir);
    const bundle = ensureProfileBundle(profileDir, pluginDir);
    info.push(`已同步到 ${target}`);
    info.push(`同步前状态：${before.state}`);
    if (bundle.changed) info.push(`已把 dsh-agents-viewer 加进 profile bundles（备份：${bundle.backup}）`);
    else info.push("profile bundles 里已经有 dsh-agents-viewer。");
  } catch (error) {
    errors.push(`安装失败：${error.message}`);
  }
}

const installed = compareInstalled();
if (!install) {
  if (installed.state === "missing") errors.push(`profile 里没有安装副本：${installed.target}`);
  else if (installed.state === "drift") {
    const detail = [
      installed.missing.length ? `缺 ${installed.missing.length} 个文件` : "",
      installed.changed.length ? `旧 ${installed.changed.length} 个文件` : "",
      installed.extra.length ? `多 ${installed.extra.length} 个文件` : "",
    ].filter(Boolean).join("，");
    errors.push(`profile 副本与本 checkout 不一致（${detail}）；退出 DSH 后跑 npm run adapt:install。`);
  }
}

if (errors.length > 0) {
  console.error("\nFAIL");
  for (const error of errors) console.error(`  ✗ ${error}`);
  for (const item of info) console.error(`  · ${item}`);
  process.exit(1);
}

console.log("\nPASS");
console.log(`  · engines.dsh "${plugin.engines.dsh}" 接受 DSH ${runtime.version}`);
console.log("  · 客户端 inject/external 与运行时一致（当前为空，靠能力探测）");
console.log(`  · profile 副本：${installed.state === "in-sync" ? "与 checkout 一致" : "已同步"}`);
for (const item of info) console.log(`  · ${item}`);
if (install) console.log("\n下一步：启动 DSH。");
