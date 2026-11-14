#!/usr/bin/env node
/**
 * Preflight check: does this plugin's DSH manifest still match the installed
 * DSH runtime?
 *
 *   node scripts/check-compat.mjs
 *   node scripts/check-compat.mjs --asar "D:/Program Files/DeepSeek Harness/resources/app.asar"
 *   node scripts/check-compat.mjs --asar "<another install>/resources/app.asar"
 *   node scripts/check-compat.mjs --runtime-version 0.2.1-rc.5
 *
 * `--asar` points the check at one specific installation instead of the local
 * default. `--runtime-version` skips the installation entirely and asks a purely
 * manifest question: "would this package install on that DSH version?" — the
 * same comparison the DSH plugin gate makes (`engines.dsh` under
 * `semver.satisfies(..., { includePrerelease: true })`), so it answers the
 * "can my friend on an older DSH install this?" question without their machine.
 *
 * Exit codes: 0 = pass, 1 = drift found, 2 = installation unreadable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVersion, readRuntime, resolveAsarPath, satisfies } from "./lib/dsh-runtime.mjs";

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

const simulated = argument("--runtime-version");
let runtime;

if (simulated !== undefined) {
  if (parseVersion(simulated) === null) {
    console.error(`\nFAIL --runtime-version 不是合法版本号：${simulated}`);
    process.exit(2);
  }
  // No installation to read: the manifest question only needs the version.
  runtime = { name: "(simulated)", version: simulated, packages: undefined };
  console.log(`runtime  ${simulated}（模拟，不读取本机安装）\n`);
} else {
  const asarPath = resolveAsarPath(argument("--asar"));
  if (!fs.existsSync(asarPath)) {
    console.error(`\nFAIL 找不到 DSH 安装：${asarPath}`);
    console.error("     用 --asar 指向 resources/app.asar，或设置 DSH_ASAR，");
    console.error("     或改用 --runtime-version <版本号> 只问“能不能装进那个版本”。");
    process.exit(2);
  }
  try {
    runtime = readRuntime(asarPath);
  } catch (error) {
    console.error(`\nFAIL 无法读取 ${asarPath}: ${error.message}`);
    process.exit(2);
  }
  console.log(`runtime  ${runtime.name}@${runtime.version}`);
  console.log(`asar     ${asarPath}\n`);
}

if (client === undefined) fail("package.json 没有 dsh.client 声明。");
else {
  if (client.platform !== "web") fail(`dsh.client.platform 是 ${JSON.stringify(client.platform)}，不是 "web"。`);
  const requests = [...(client.inject ?? []), ...(client.external ?? [])];
  for (const name of requests) {
    if (runtime.packages === undefined) continue;
    if (!runtime.packages.has(name)) fail(`dsh.client 引用了安装里不存在的包：${name}（DSH ${runtime.version}）。`);
  }
  if (requests.length === 0) note("dsh.client 没有声明 inject/external，完全依赖运行时能力探测。");
  else if (runtime.packages === undefined) note(`模拟模式不核对 ${requests.length} 个客户端依赖是否随包发布。`);
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
const shipped = runtime.packages === undefined ? "（未读取安装）" : `${runtime.packages.size} 个运行时包`;
console.log(`  · 检查了 ${(client?.inject ?? []).length + (client?.external ?? []).length} 个客户端依赖、${shipped}。`);
