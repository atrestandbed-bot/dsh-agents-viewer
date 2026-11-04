/**
 * Shared helpers for the DSH runtime checks in `scripts/`.
 *
 * Everything here is read-only except `syncPlugin`, which the `--install`
 * path calls only after it has proved DSH is not running.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_ASAR = "D:/Program Files/DeepSeek Harness/resources/app.asar";

/** Resolve the asar path from a flag, the environment, or the default install. */
export function resolveAsarPath(explicit) {
  return path.resolve(explicit ?? process.env.DSH_ASAR ?? DEFAULT_ASAR);
}

/** Read an Electron asar's file table without loading the archive body. */
export function readAsar(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    if (headerSize < 8 || jsonLength < 2 || jsonLength > headerSize) throw new Error("unexpected asar header sizes");
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    const header = JSON.parse(json.toString("utf8").replace(/\0+$/u, ""));
    const files = [];
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const full = prefix === "" ? name : `${prefix}/${name}`;
        if (entry.files) walk(entry, full);
        else files.push({ path: full, size: entry.size ?? 0, offset: Number(entry.offset ?? 0) });
      }
    };
    walk(header, "");
    return { path: asarPath, files, dataOffset: 8 + headerSize };
  } finally {
    fs.closeSync(fd);
  }
}

/** Read one file out of an asar archive. */
export function readAsarFile(archive, filePath) {
  const entry = archive.files.find((file) => file.path === filePath);
  if (entry === undefined) return undefined;
  const fd = fs.openSync(archive.path, "r");
  try {
    const buffer = Buffer.alloc(entry.size);
    fs.readSync(fd, buffer, 0, entry.size, archive.dataOffset + entry.offset);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read the DSH runtime facts this plugin cares about: version and the set of
 * `@deepseek-ai/*` packages the installation actually ships.
 */
export function readRuntime(asarPath) {
  const archive = readAsar(asarPath);
  const manifestText = readAsarFile(archive, "dsh/package.json");
  if (manifestText === undefined) throw new Error("app.asar does not contain dsh/package.json");
  const manifest = JSON.parse(manifestText);
  const packages = new Set();
  const pattern = /^dsh\/node_modules\/@deepseek-ai\/([^/]+)\/package\.json$/u;
  for (const file of archive.files) {
    const match = pattern.exec(file.path);
    if (match !== null) packages.add(`@deepseek-ai/${match[1]}`);
  }
  return { archive, version: manifest.version, name: manifest.name, packages };
}

/** Parse a semver string, including prerelease identifiers. */
export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(value).trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? [] : match[4].split("."),
  };
}

/** Compare two parsed semver values. */
export function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  const length = Math.max(left.pre.length, right.pre.length);
  for (let index = 0; index < length; index++) {
    const a = left.pre[index];
    const b = right.pre[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/u.test(a);
    const bNumeric = /^\d+$/u.test(b);
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1;
    } else if (aNumeric) return -1;
    else if (bNumeric) return 1;
    else if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/** Minimal semver range matcher: comparators joined by spaces and `||`. */
export function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (parsed === null) return undefined;
  for (const group of String(range).split("||")) {
    const comparators = group.trim().split(/\s+/u).filter(Boolean);
    if (comparators.length === 0) continue;
    let matched = true;
    for (const token of comparators) {
      const match = /^(>=|<=|>|<|=)?(.+)$/u.exec(token);
      if (match === null) {
        matched = false;
        break;
      }
      const operator = match[1] ?? "=";
      const target = parseVersion(match[2]);
      if (target === null) {
        matched = false;
        break;
      }
      const order = compareVersions(parsed, target);
      const ok = operator === ">=" ? order >= 0
        : operator === "<=" ? order <= 0
          : operator === ">" ? order > 0
            : operator === "<" ? order < 0
              : order === 0;
      if (!ok) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** PIDs of running DSH desktop processes (empty when DSH is closed). */
export function runningDshProcesses() {
  if (process.platform !== "win32") return [];
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Id -join ','"],
      { encoding: "utf8", windowsHide: true, timeout: 10_000 },
    ).trim();
    return output === "" ? [] : output.split(",").map((value) => Number(value));
  } catch {
    return [];
  }
}

/** The desktop profile this checkout installs into. */
export function defaultProfileDir() {
  return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"), "profiles", "desktop");
}

/**
 * Replace the profile's copy of this plugin with the current checkout.
 *
 * The caller must have proved DSH is not running: replacing files under a live
 * Host can reload its client plugin and disrupt the open window. Recreating the
 * directory also removes stale files from older versions (`panel.js`,
 * duplicated `runtime/runtime/`, ...).
 *
 * @param pluginDir - checkout containing package.json
 * @param profileDir - desktop profile directory
 * @returns the installed plugin directory
 */
export function syncPlugin(pluginDir, profileDir) {
  const target = path.join(profileDir, "node_modules", "dsh-agents-viewer");
  const sourceReal = fs.realpathSync(pluginDir);
  const targetResolved = path.resolve(target);
  if (targetResolved === sourceReal || sourceReal.startsWith(`${targetResolved}${path.sep}`)) {
    throw new Error(`refusing to replace ${target}: it contains the source checkout`);
  }
  if (fs.existsSync(target)) {
    const targetReal = fs.realpathSync(target);
    if (targetReal === sourceReal || sourceReal.startsWith(`${targetReal}${path.sep}`)) {
      throw new Error(`refusing to replace ${target}: it resolves to the source checkout`);
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const entries = ["index.js", "package.json", "cordis.patch.yml", "README.md", "LICENSE", "icon.svg", "runtime", "locale", "scripts"];
  for (const entry of entries) {
    const source = path.join(pluginDir, entry);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(target, entry), { recursive: true });
  }
  return target;
}

/** Ensure the profile manifest installs and enables this plugin. */
export function ensureProfileBundle(profileDir, pluginDir) {
  const manifestPath = path.join(profileDir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.dependencies ??= {};
  manifest.dependencies["dsh-agents-viewer"] = manifest.dependencies["dsh-agents-viewer"] ?? `file:${pluginDir.replaceAll("\\", "/")}`;
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles ??= [];
  const bundles = manifest.dsh.profile.bundles;
  const changed = !bundles.includes("dsh-agents-viewer");
  if (changed) bundles.push("dsh-agents-viewer");
  if (changed) {
    const backup = `${manifestPath}.bak-agv-${Date.now()}`;
    fs.copyFileSync(manifestPath, backup);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { changed, backup };
  }
  return { changed, backup: undefined };
}
