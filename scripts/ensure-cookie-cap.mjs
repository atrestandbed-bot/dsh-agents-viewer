#!/usr/bin/env node
/**
 * Restore the desktop profile's connection cookie cap.
 *
 * Why this exists: DSH names its login cookie after `host:port`. The desktop
 * host picks a random port on every start, so each launch leaves another
 * `dsh-auth-*` cookie for 127.0.0.1. After roughly 70 launches Chromium's
 * Cookie header exceeds Node's 16 KB `maxHeaderSize`, the host answers 431,
 * and the window reports "desktop welcome: Web authentication failed".
 *
 * The fix is a profile patch override:
 *
 *   - id: connection
 *     name: "@deepseek-ai/dsh-client-connection"
 *     inject: [webStartup]
 *     config:
 *       trustedHosts: !!js ctx.webStartup.trustedHosts
 *       cookieMaxAgeDays: 3
 *
 * Some profile upgrades / plugin installs rewrite `cordis.patch.yml` and drop
 * that entry. This script puts it back. It refuses to write while DSH is
 * running: editing the profile patch under a live Host triggers the profile
 * watcher and can dispose the open session.
 *
 *   node tools/ensure-cookie-cap.mjs              # apply
 *   node tools/ensure-cookie-cap.mjs --dry-run    # inspect only
 *   node tools/ensure-cookie-cap.mjs --days 1     # tighter cap
 *   node tools/ensure-cookie-cap.mjs --profile <dir>
 */
import fs from "node:fs";
import path from "node:path";
import { defaultProfileDir, runningDshProcesses } from "./lib/dsh-runtime.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const profileDir = path.resolve(argument("--profile") ?? defaultProfileDir());
const dryRun = process.argv.includes("--dry-run");
// Test-only escape hatch: lets the write path run against a temp profile while
// this checkout's own DSH window is open. Never use it on the live profile.
const assumeClosed = process.argv.includes("--assume-closed");
const days = Number(argument("--days") ?? 3);
if (!Number.isInteger(days) || days < 1 || days > 30) {
  console.error("--days must be an integer between 1 and 30.");
  process.exit(1);
}

const patchPath = path.join(profileDir, "cordis.patch.yml");
if (!fs.existsSync(patchPath)) {
  console.error(`找不到 profile patch：${patchPath}`);
  process.exit(1);
}

/** Locate the top-level `- id: connection` entry, if any. */
function findConnectionBlock(text) {
  const start = /^-\s*id:\s*connection\b.*$/mu.exec(text);
  if (start === null) return null;
  const rest = text.slice(start.index + start[0].length);
  const next = /^-\s+/mu.exec(rest);
  const end = next === null ? text.length : start.index + start[0].length + next.index;
  return { start: start.index, end, block: text.slice(start.index, end) };
}

/** Add the cap to an existing connection block, keeping its indentation. */
function addCap(block) {
  if (/^\s*cookieMaxAgeDays\s*:/mu.test(block)) return null;
  const config = /^(\s*)config:\s*$/mu.exec(block);
  if (config !== null) {
    const indent = `${config[1]}  `;
    return block.replace(config[0], `${config[0]}\n${indent}cookieMaxAgeDays: ${days}`);
  }
  if (/^\s*config:\s*\{/mu.test(block)) {
    throw new Error("connection 的 config 是内联写法，请手动加 cookieMaxAgeDays。");
  }
  const trimmed = block.replace(/\s+$/u, "");
  return `${trimmed}\n  config:\n    trustedHosts: !!js ctx.webStartup.trustedHosts\n    cookieMaxAgeDays: ${days}\n`;
}

const text = fs.readFileSync(patchPath, "utf8").replace(/^\uFEFF/u, "");
const found = findConnectionBlock(text);
const alreadyCapped = found !== null && /^\s*cookieMaxAgeDays\s*:/mu.test(found.block);

console.log(`profile  ${profileDir}`);
console.log(`patch    ${patchPath}`);
if (alreadyCapped) {
  console.log("state    cookie 上限已存在，无需修改。");
  process.exit(0);
}
if (dryRun) {
  console.log(found === null ? "state    没有 connection 条目（会追加）" : "state    有 connection 条目但缺 cookieMaxAgeDays（会补上）");
  process.exit(0);
}

const running = runningDshProcesses();
if (!assumeClosed && running.length > 0) {
  console.error(`\nREFUSED  DSH 正在运行（pid ${running.join(", ")}）。先完整退出 DSH，再运行本脚本。`);
  console.error("         运行中改 cordis.patch.yml 会触发热重载，可能打断当前会话。");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "").replace("T", "-");
const backup = `${patchPath}.bak-cookiecap-${stamp}`;
fs.copyFileSync(patchPath, backup);

let next;
if (found === null) {
  const entry = [
    "- id: connection",
    '  name: "@deepseek-ai/dsh-client-connection"',
    "  inject: [webStartup]",
    "  config:",
    "    trustedHosts: !!js ctx.webStartup.trustedHosts",
    `    cookieMaxAgeDays: ${days}`,
    "",
  ].join("\n");
  next = `${text.replace(/\s+$/u, "")}\n\n${entry}`;
} else {
  const capped = addCap(found.block);
  if (capped === null) {
    console.log("state    cookie 上限已存在，无需修改。");
    process.exit(0);
  }
  next = `${text.slice(0, found.start)}${capped}${text.slice(found.end)}`;
}

fs.writeFileSync(patchPath, next, "utf8");
console.log(`state    已写入 cookieMaxAgeDays: ${days}`);
console.log(`backup   ${backup}`);
console.log("next     启动 DSH 后生效。");
