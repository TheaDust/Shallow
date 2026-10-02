#!/usr/bin/env node
// Package a finished ShallowCode run as an ARC-Bench self-test APP bundle.
//
// ARC-Bench has two submission channels whose zip roots are opposites, so do
// not mix them up:
//
//   agent channel (the official competition) — zip root must contain main.py;
//   the evaluator drives `python main.py <requirement>` itself.
//     -> scripts/package-main.mjs, scripts/package-baseline.mjs
//
//   self-test channel (arcbench-selftest-web.vercel.app) — skips the agent, so
//   the zip root must contain a Dockerfile instead. The evaluator builds an
//   image from the zip, runs it, and drives the official tests against the
//   listening port. Rejected otherwise: a wrapper folder above the root, a
//   missing Dockerfile, > 50 MB, node_modules / .git / build output, `..` or
//   absolute paths, too many entries or too much uncompressed size.
//
// This script stages <source>/{frontend,backend} from a finished run, generates
// the Dockerfile that reproduces the ARC-Bench platform contract (npm install
// -> frontend build -> start on $PORT, static assets read from frontend/dist),
// optionally pre-builds the image locally, and zips the staging root itself so
// the Dockerfile lands at the zip root by construction.
//
// Usage: node scripts/package-selftest-app.mjs [options] [source-output-dir]

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { zipDirectory } from "./zip-directory.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = join(tmpdir(), "shallowcode-local", "main");
const DEFAULT_OUT = join(repoRoot, "dist", "selftest-app");
const DEFAULT_TAG = "arc-selftest:local";
const MAX_ZIP_MB = 50;

// The site rejects the zip outright when it contains these; they are either
// reinstalled by the image build or irrelevant to the graded app.
const SKIP_NAMES = new Set([
  "node_modules", "dist", "build", "out", ".next", "coverage",
  ".cache", ".vite", ".turbo", "__pycache__",
  ".git", ".arc", "shallow-progress", "runs", "tmp",
]);

const HELP = `用法：
  node scripts/package-selftest-app.mjs [选项] [source-output-dir]

把一次 ShallowCode 运行的产物打成 ARC-Bench 自测站要的 app zip（根目录含 Dockerfile）。

位置参数：
  source-output-dir     产物目录（缺省 <系统临时目录>/shallowcode-local/main）

选项：
  --source <dir>        同位置参数，显式写法
  --out <dir>           输出目录（缺省 dist/selftest-app）
  --tag <name>          本地预检镜像名（缺省 ${DEFAULT_TAG}）
  --skip-build          跳过 docker build 本地预检
  --exclude-data        连 backend/data 一起排除
  -h, --help            显示本帮助

关于 --exclude-data：
  缺省保留 backend/data。脚手架的 json-store 在文件缺失时会回退到代码里的
  初始值，所以「只有种子数据在 data 目录」的应用排除后会启动成空库；如果
  你确认那目录纯粹是本地运行时状态（脏数据、缓存），用这个开关排掉。`;

const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (text) => (colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const cyan = paint("36");

function parseArgs(argv) {
  const options = {
    source: null, out: null, tag: DEFAULT_TAG,
    skipBuild: false, excludeData: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`选项 ${arg} 缺少参数值`);
      }
      index += 1;
      return next;
    };
    if (arg === "-h" || arg === "--help") return { help: true };
    else if (arg === "--source") options.source = value();
    else if (arg === "--out") options.out = value();
    else if (arg === "--tag") options.tag = value();
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--exclude-data") options.excludeData = true;
    else if (arg.startsWith("-")) throw new Error(`未知选项：${arg}`);
    else if (options.source === null) options.source = arg;
    else throw new Error(`多余的位置参数：${arg}`);
  }
  return { options };
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function lastName(path) {
  return path.split(/[\\/]/).pop();
}

// Total bytes, every file with its size, and the file count. The site rejects
// the zip for exceeding 50 MB *and* separately for too much uncompressed
// volume, so both numbers matter and "which files are huge" is the actionable
// part of the report.
async function scanTree(root) {
  let bytes = 0;
  const entries = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      bytes += info.size;
      entries.push({ name: relative(root, absolute).split(/[\\/]/).join("/"), size: info.size });
    }
  }
  await walk(root);
  entries.sort((left, right) => right.size - left.size);
  return { bytes, files: entries.length, entries };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function renderDockerfile({ frontend, backend, startCommand }) {
  const install = (side) => {
    const lock = side.hasLock ? `${side.dir}/package-lock.json ` : "";
    const command = side.hasLock ? "ci" : "install";
    return [
      `COPY ${side.dir}/package.json ${lock}./${side.dir}/`,
      `RUN npm --prefix ${side.dir} ${command} --no-audit --no-fund`,
    ].join("\n");
  };
  return `# Generated by scripts/package-selftest-app.mjs for the ARC-Bench self-test channel.
# The evaluator docker-builds this zip, runs the image, and drives the official
# tests against the listening port. Keep this file at the ZIP ROOT.

FROM node:22-slim
WORKDIR /app

# Dependency layers come before the sources on purpose: Docker caches per layer,
# so an unchanged manifest + lockfile keeps the slow install cached and editing
# one line of app code does not reinstall the tree.
${install(frontend)}

${install(backend)}

COPY frontend ./frontend
COPY backend ./backend

# The backend serves static assets from ../../frontend/dist, so frontend/ and
# backend/ must stay siblings. The dist is built here, not shipped in the zip.
RUN npm --prefix frontend run build

# Set after the build on purpose: the frontend build needs devDependencies.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Do NOT set ARC_EXTRA_PORTS=0 — that switch turns the extra listeners off, and
# some task specs hardcode their target as http://127.0.0.1:3301.
CMD ${startCommand}
`;
}

async function dockerBuild(tag, context) {
  const probe = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    return { ran: false, reason: "本机没有 docker 命令" };
  }
  if (probe.status !== 0) {
    const detail = (probe.stderr || probe.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-1)[0];
    return { ran: false, reason: `Docker 守护进程未运行${detail ? `（${detail}）` : ""}` };
  }
  const build = spawnSync("docker", ["build", "-t", tag, context], { stdio: "inherit" });
  return { ran: true, ok: build.status === 0, status: build.status };
}

async function main() {
  const { options, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(HELP);
    return;
  }

  const source = resolve(options.source ?? DEFAULT_SOURCE);
  const outDir = resolve(options.out ?? DEFAULT_OUT);
  const staging = join(outDir, "app");
  const zipPath = join(outDir, "app.zip");

  const frontendManifest = join(source, "frontend", "package.json");
  const backendManifest = join(source, "backend", "package.json");
  for (const manifest of [frontendManifest, backendManifest]) {
    if (!existsSync(manifest)) {
      throw new Error(
        `产物目录不完整：缺少 ${relative(source, manifest) || manifest}\n` +
        `  读的是 ${source}\n` +
        `  确认这次运行留下了可运行产物（应用源码不能是空的）。`,
      );
    }
  }

  const frontendPkg = await readJson(frontendManifest);
  const backendPkg = await readJson(backendManifest);
  if (typeof frontendPkg.scripts?.build !== "string") {
    throw new Error("frontend/package.json 没有 build 脚本，镜像里无法产出 frontend/dist。");
  }
  if (typeof backendPkg.scripts?.start !== "string") {
    throw new Error("backend/package.json 没有 start 脚本，容器没有默认启动命令。");
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const skipNames = options.excludeData
    ? new Set([...SKIP_NAMES, "data"])
    : SKIP_NAMES;
  for (const dir of ["frontend", "backend"]) {
    await cp(join(source, dir), join(staging, dir), {
      recursive: true,
      filter: (from) => !skipNames.has(lastName(from)),
    });
  }

  // Prefer exec'ing node directly: npm as PID 1 swallows SIGTERM, and the
  // evaluator stops the container between test runs. Fall back to the package
  // script when the layout is not the scaffold's, so a restructured app still
  // gets its own declared start command.
  const directEntry = join(staging, "backend", "src", "server.mjs");
  const useDirectEntry = existsSync(directEntry);
  const startCommand = useDirectEntry
    ? '["node", "backend/src/server.mjs"]'
    : '["npm", "--prefix", "backend", "start"]';

  const sides = {};
  for (const dir of ["frontend", "backend"]) {
    sides[dir] = { dir, hasLock: existsSync(join(source, dir, "package-lock.json")) };
  }
  await writeFile(
    join(staging, "Dockerfile"),
    renderDockerfile({ frontend: sides.frontend, backend: sides.backend, startCommand }),
    "utf8",
  );

  const staged = await scanTree(staging);
  const installModes = ["frontend", "backend"]
    .map((dir) => `${dir}: npm ${sides[dir].hasLock ? "ci" : "install"}`)
    .join("  ");
  console.log(`${bold("产物")}    ${source}`);
  console.log(`${bold("暂存")}    ${staging}`);
  console.log(`${bold("依赖")}    ${installModes}`);
  console.log(`${bold("启动")}    ${useDirectEntry ? "node backend/src/server.mjs" : "npm --prefix backend start"}`);
  console.log(`${bold("内容")}    ${staged.files} 个文件，${formatMb(staged.bytes)}`);

  const dataEntries = (await scanTree(join(staging, "backend"))).entries
    .filter((entry) => entry.name.startsWith("data/"));
  if (dataEntries.length > 0) {
    const total = dataEntries.reduce((sum, entry) => sum + entry.size, 0);
    console.log(`${yellow("注意")}    backend/data 下有 ${dataEntries.length} 个文件一并打进了 zip（${formatMb(total)}）。`
      + `确认是种子数据就忽略；是本地脏数据就加 --exclude-data 重打。`);
  }

  if (!options.skipBuild) {
    console.log(`\n${cyan("本地预检")}  docker build -t ${options.tag} …`);
    const preflight = await dockerBuild(options.tag, staging);
    if (!preflight.ran) {
      console.log(`${yellow("跳过")}    ${preflight.reason}，未做本地预检`);
    } else if (preflight.ok) {
      console.log(`${green("通过")}    镜像 ${options.tag} 构建成功`);
    } else {
      throw new Error(
        `docker build 失败（退出码 ${preflight.status}）。`
        + `先把上面的错误修掉再提交——自测每天只有 ${10} 次额度，构建失败照样计次。`,
      );
    }
  }

  await zipDirectory(staging, zipPath);
  const zipInfo = await stat(zipPath);
  console.log(`\n${bold("zip")}     ${zipPath}`);
  console.log(`${bold("大小")}    ${formatMb(zipInfo.size)} / ${MAX_ZIP_MB} MB 上限`);

  if (zipInfo.size > MAX_ZIP_MB * 1024 * 1024) {
    console.log(`\n${red("超出上限")}，最大的文件：`);
    for (const entry of staged.entries.slice(0, 10)) {
      console.log(`  ${formatMb(entry.size).padStart(11)}  ${entry.name}`);
    }
    throw new Error("zip 超过 50 MB，上传会被直接拒绝。");
  }

  console.log(`\n${green("可以提交了")}：把上面的 zip 拖到自测站对应题目的上传框。`);
  console.log(dim("本地跑起来看一眼："));
  console.log(dim(`  docker run --rm -p 3000:3000 ${options.tag}`));
  console.log(dim("  然后 http://127.0.0.1:3000 和 http://127.0.0.1:3000/health"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
