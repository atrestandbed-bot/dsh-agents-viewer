#!/usr/bin/env node
/**
 * Preflight check: does this plugin's DSH manifest still match the installed
 * DSH runtime?
 *
 *   node scripts/check-compat.mjs
 *   node scripts/check-compat.mjs --asar "D:/Program Files/DeepSeek Harness/resources/app.asar"
 *
 * Exit codes: 0 = pass, 1 = drift found, 2 = installation unreadable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntime, resolveAsarPath, satisfies } from "./lib/dsh-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const note = (message) => notes.push(message);

const plugin = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
const client = plugin.dsh?.client;

console.log(`plugin   ${plugin.name}@${plugin.version}`);
console.log(`manifest ${path.join(pluginDir, "package.json")}`);

const asarPath = resolveAsarPath(argument("--asar"));
if (!fs.existsSync(asarPath)) {
  console.error(`\nFAIL 找不到 DSH 安装：${asarPath}`);
  console.error("     用 --asar 指向 resources/app.asar，或设置 DSH_ASAR。");
  process.exit(2);
}

let runtime;
try {
  runtime = readRuntime(asarPath);
} catch (error) {
  console.error(`\nFAIL 无法读取 ${asarPath}: ${error.message}`);
  process.exit(2);
}

console.log(`runtime  ${runtime.name}@${runtime.version}`);
console.log(`asar     ${asarPath}\n`);

if (client === undefined) fail("package.json 没有 dsh.client 声明。");
else {
  if (client.platform !== "web") fail(`dsh.client.platform 是 ${JSON.stringify(client.platform)}，不是 "web"。`);
  const requests = [...(client.inject ?? []), ...(client.external ?? [])];
  for (const name of requests) {
    if (!runtime.packages.has(name)) fail(`dsh.client 引用了安装里不存在的包：${name}（DSH ${runtime.version}）。`);
  }
  if (requests.length === 0) note("dsh.client 没有声明 inject/external，完全依赖运行时能力探测。");
}

const engines = plugin.engines?.dsh;
if (typeof engines !== "string") {
  fail("package.json 没有 engines.dsh。");
} else {
  const ok = satisfies(runtime.version, engines);
  if (ok === undefined) note(`无法解析 engines.dsh 范围：${engines}`);
  else if (!ok) fail(`engines.dsh "${engines}" 不接受当前 DSH ${runtime.version}。`);
  else note(`engines.dsh "${engines}" 接受 DSH ${runtime.version}。`);
}

const clientExport = plugin.exports?.["./client"];
if (typeof clientExport !== "string") fail('exports 里没有 "./client" 入口。');
else {
  const clientFile = path.resolve(pluginDir, clientExport);
  if (!fs.existsSync(clientFile)) fail(`客户端 bundle 不存在：${clientExport}`);
  else {
    const source = fs.readFileSync(clientFile, "utf8");
    if (!/__ModuleLoader__\s*\.\s*load\s*\(/u.test(source)) fail(`${clientExport} 没有通过 __ModuleLoader__.load 注册。`);
    if (!/var inject = \["slots"\]/u.test(source)) note("客户端 inject 不是最小集合；DSH 换服务名时需要手动改。");
  }
}

const patch = plugin.dsh?.bundle?.patch;
if (typeof patch !== "string" || !fs.existsSync(path.resolve(pluginDir, patch))) {
  fail(`dsh.bundle.patch 指向的 patch 文件不存在：${String(patch)}`);
}

if (problems.length > 0) {
  console.error("FAIL");
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  for (const item of notes) console.error(`  · ${item}`);
  process.exit(1);
}

console.log("PASS");
for (const item of notes) console.log(`  · ${item}`);
console.log(`  · 检查了 ${(client?.inject ?? []).length + (client?.external ?? []).length} 个客户端依赖、${runtime.packages.size} 个运行时包。`);
