#!/usr/bin/env node
// Local end-to-end evaluator for ShallowCode (main) and the raw-OpenCode
// baseline: generate -> build -> start -> run the official ARC-Bench tests ->
// summarize. Design: docs/superpowers/specs/2026-09-12-local-e2e-eval-script-design.md

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkRoot = join(repoRoot, "benchmarks", "arc-bench");
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const defaultPythonCmd = isWindows ? "python" : "python3";
const HEALTH_TIMEOUT_MS = 60_000;
const POLL_MS = 500;
const INSTALL_LOCK_TIMEOUT_MS = 15 * 60_000;
const INSTALL_LOCK_PATH = join(benchmarkRoot, ".eval-install.lock");

const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (text) => (colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = paint("2");
const bold = paint("1");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("34");
const cyan = paint("36");
const magenta = paint("35");
const agentPaint = { main: cyan, baseline: magenta };

const HELP = `用法：
  node scripts/eval-local.mjs --agent <main|baseline> --app <name> [选项]
  node scripts/eval-local.mjs --agent <main|baseline> --requirements-dir <dir> --test-app <name> [选项]

必填：
  --agent <main|baseline>       选择驱动入口
  --app <name>                  benchmark app 名（自动解析需求目录与官方测试）
  或 --requirements-dir <dir>   通用需求目录，需配合 --test-app

选项：
  --test-app <name>             通用入口下指定官方测试 app
  --agent-dir <dir>             agent 目录，入口用该目录下的 main.py
                                （缺省仓库根，baseline 缺省仓库根/baseline）
  --python <cmd>                生成阶段使用的 Python 解释器（缺省 python/python3，
                                可指向 venv，如 tmp/agent/.venv/Scripts/python.exe）
  --gen-arg <arg>               追加到生成命令的参数，可重复（用于外部 agent 的
                                不同参数，如 --gen-arg --port --gen-arg 3301）
  --no-web-port                 不注入默认的 --web-port <port>
  --run-id <id>                 本次运行标识（缺省自动生成，用于隔离并行运行）
  --output-dir <dir>            产物目录（缺省 tmp/eval-local/<agent>[/<app>]/<run-id>）
  --artifacts-dir <dir>         Playwright 报告/结果目录（缺省 tmp/eval-local/artifacts/<run-id>）
  --port <n>                    本地评测端口（缺省 0：自动挑选空闲端口）
  --budget-ms <ms>              生成预算，透传 SHALLOW_BUDGET_MS（缺省 0 不限）
  --health-path <path>          健康检查路径（缺省 /health）
  --generate-only               只生成，不构建/启动/测试
  --eval-only                   跳过生成，复用已有 --output-dir 产物
  --skip-install                跳过 frontend/backend npm install
  --skip-build                  跳过 frontend npm run build
  --keep-running                测试后保留 backend 进程
  --playwright-timeout <ms>     透传官方 runner 单测超时
  --expect-timeout <ms>         透传官方 runner 断言超时
  --grep <pattern>              透传 Playwright --grep（本地调试用）
  --help, -h                    显示本帮助

示例：
  npm run eval:local -- --agent main --app keep
  npm run eval:local -- --agent baseline --app keep
  npm run eval:local -- --agent main --agent-dir tmp/agent-variant --app keep
  npm run eval:local -- --agent main --eval-only --output-dir tmp/eval-local/main/keep --test-app keep

并行（缺省自动隔离端口、产物与报告目录；可多次同时启动）：
  npm run eval:local -- --agent main --agent-dir tmp/agent-arc-based --app keep
  npm run eval:local -- --agent main --agent-dir tmp/agent-codex-based --app keep`;

function printHelp() {
  console.log(HELP);
}

function parseArgs(argv) {
  const options = {
    agent: "",
    agentDir: "",
    python: "",
    genArgs: [],
    noWebPort: false,
    app: "",
    requirementsDir: "",
    testApp: "",
    runId: "",
    outputDir: "",
    artifactsDir: "",
    port: 0,
    budgetMs: 0,
    healthPath: "/health",
    generateOnly: false,
    evalOnly: false,
    skipInstall: false,
    skipBuild: false,
    keepRunning: false,
    playwrightTimeout: 0,
    expectTimeout: 0,
    grep: "",
    help: false,
  };
  const take = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} 需要一个值`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--agent") options.agent = take(index++, arg);
    else if (arg === "--agent-dir") options.agentDir = take(index++, arg);
    else if (arg === "--python") options.python = take(index++, arg);
    else if (arg === "--gen-arg") {
      if (index + 1 >= argv.length) throw new Error("--gen-arg 需要一个值");
      options.genArgs.push(argv[index + 1]);
      index += 1;
    }
    else if (arg === "--no-web-port") options.noWebPort = true;
    else if (arg === "--app") options.app = take(index++, arg);
    else if (arg === "--requirements-dir") options.requirementsDir = take(index++, arg);
    else if (arg === "--test-app") options.testApp = take(index++, arg);
    else if (arg === "--run-id") options.runId = take(index++, arg);
    else if (arg === "--output-dir") options.outputDir = take(index++, arg);
    else if (arg === "--artifacts-dir") options.artifactsDir = take(index++, arg);
    else if (arg === "--port") options.port = Number(take(index++, arg));
    else if (arg === "--budget-ms") options.budgetMs = Number(take(index++, arg));
    else if (arg === "--health-path") options.healthPath = take(index++, arg);
    else if (arg === "--playwright-timeout") options.playwrightTimeout = Number(take(index++, arg));
    else if (arg === "--expect-timeout") options.expectTimeout = Number(take(index++, arg));
    else if (arg === "--grep") options.grep = take(index++, arg);
    else if (arg === "--generate-only") options.generateOnly = true;
    else if (arg === "--eval-only") options.evalOnly = true;
    else if (arg === "--skip-install") options.skipInstall = true;
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--keep-running") options.keepRunning = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

function loadApps() {
  const path = join(benchmarkRoot, "apps.config.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")).apps ?? {};
}

function generateRunId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("") + "-" + [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
  const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${stamp}-${rand}`;
}

function findFreePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.unref();
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        if (port) resolvePromise(port);
        else rejectPromise(new Error("无法挑选空闲端口"));
      });
    });
  });
}

async function acquireBenchmarkInstallLock() {
  const startedAt = Date.now();
  for (;;) {
    try {
      mkdirSync(INSTALL_LOCK_PATH);
      return {
        release: () => {
          try {
            rmdirSync(INSTALL_LOCK_PATH);
          } catch {
            // already released
          }
        },
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (Date.now() - startedAt > INSTALL_LOCK_TIMEOUT_MS) {
      throw new Error(`等待 benchmark 安装锁超时（${INSTALL_LOCK_TIMEOUT_MS}ms）：${INSTALL_LOCK_PATH}`);
    }
    await delay(POLL_MS);
  }
}

function resolveConfig(options) {
  if (!options.agent) throw new Error("--agent 必填（main 或 baseline）");
  if (!["main", "baseline"].includes(options.agent)) {
    throw new Error(`未知 agent "${options.agent}"（可选 main/baseline）`);
  }
  if (options.app && options.requirementsDir) {
    throw new Error("--app 与 --requirements-dir 不能同时使用");
  }
  if (!options.evalOnly && !options.app && !options.requirementsDir) {
    throw new Error("需要 --app <name> 或 --requirements-dir <dir>");
  }
  if (!options.app && !options.testApp) {
    throw new Error("需要 --app <name> 或 --test-app <name> 指定官方测试");
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error("--port 必须是 0-65535 的整数（0 表示自动挑选空闲端口）");
  }
  if (options.runId && /[\\/]/.test(options.runId)) {
    throw new Error("--run-id 不能包含路径分隔符");
  }
  if (options.generateOnly && options.evalOnly) {
    throw new Error("--generate-only 与 --eval-only 不能同时使用");
  }

  const apps = loadApps();
  let requirementDir = "";
  let testApp;
  if (options.app) {
    const entry = apps[options.app];
    if (!entry) {
      throw new Error(`未知 app "${options.app}"（可选：${Object.keys(apps).join(", ") || "无"}）`);
    }
    requirementDir = resolve(benchmarkRoot, entry.requirementDir);
    testApp = options.app;
  } else {
    if (!options.evalOnly) requirementDir = resolve(options.requirementsDir);
    if (!apps[options.testApp]) {
      throw new Error(`未知 test app "${options.testApp}"（可选：${Object.keys(apps).join(", ") || "无"}）`);
    }
    testApp = options.testApp;
  }

  const testDir = join(benchmarkRoot, "arc-bench", "webapp", testApp, "tests");
  const runId = options.runId || generateRunId();
  const outputDir = resolve(
    options.outputDir
      || join(repoRoot, "tmp", "eval-local", options.agent, ...(options.app ? [options.app] : []), runId),
  );
  const artifactsDir = resolve(
    options.artifactsDir || join(repoRoot, "tmp", "eval-local", "artifacts", runId),
  );
  const healthPath = options.healthPath.startsWith("/") ? options.healthPath : `/${options.healthPath}`;

  const agentRoot = options.agentDir
    ? resolve(options.agentDir)
    : options.agent === "baseline" ? join(repoRoot, "baseline") : repoRoot;
  const adapter = join(agentRoot, "main.py");
  if (!options.evalOnly && !existsSync(adapter)) {
    throw new Error(`找不到 agent 入口：${adapter}`);
  }
  const pythonCmd = options.python
    ? /[\\/]/.test(options.python) ? resolve(options.python) : options.python
    : defaultPythonCmd;

  if (requirementDir && !existsSync(join(requirementDir, "requirements.yaml"))) {
    throw new Error(`找不到需求文件：${join(requirementDir, "requirements.yaml")}`);
  }
  if (!existsSync(join(benchmarkRoot, "scripts", "run-playwright.js"))) {
    throw new Error(`找不到官方 runner：${join(benchmarkRoot, "scripts", "run-playwright.js")}`);
  }
  if (!existsSync(testDir)) throw new Error(`找不到官方测试目录：${testDir}`);
  if (options.evalOnly && !existsSync(join(outputDir, "backend"))) {
    throw new Error(`--eval-only 需要已有产物（缺 ${join(outputDir, "backend")}）`);
  }

  return { ...options, runId, healthPath, requirementDir, testApp, testDir, outputDir, artifactsDir, agentRoot, adapter, pythonCmd };
}

function banner(config) {
  console.log("");
  console.log(bold("ShallowCode 本地 E2E 评测"));
  console.log(`  agent        : ${agentPaint[config.agent](config.agent)}`);
  console.log(`  agent 入口   : ${config.adapter}`);
  console.log(`  python       : ${config.pythonCmd}`);
  console.log(`  模式         : ${config.generateOnly ? "仅生成" : config.evalOnly ? "仅评测（复用产物）" : "完整链路"}`);
  console.log(`  需求目录     : ${config.requirementDir || "（仅评测，无需需求目录）"}`);
  console.log(`  运行标识     : ${config.runId}`);
  console.log(`  产物目录     : ${config.outputDir}`);
  console.log(`  评测产物     : ${config.artifactsDir}`);
  console.log(`  官方测试 app : ${config.testApp}`);
  console.log(`  端口         : ${config.port}（健康检查 ${config.healthPath}）`);
  if (config.budgetMs > 0) console.log(`  生成预算     : ${config.budgetMs} ms`);
  console.log("");
}

function quoteIfNeeded(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function spawnCommand(command, args, options) {
  if (isWindows) {
    const line = [command, ...args].map(quoteIfNeeded).join(" ");
    return spawn(line, { ...options, shell: true });
  }
  return spawn(command, args, { ...options, shell: false });
}

function killProcessTree(pid) {
  return new Promise((resolvePromise) => {
    if (isWindows) {
      const child = spawn(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: "ignore", windowsHide: true });
      child.on("close", () => resolvePromise());
      child.on("error", () => resolvePromise());
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // already gone
    }
    resolvePromise();
  });
}

function forwardStream(stream, tag) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) console.log(`${tag} ${line}`);
  });
  stream.on("end", () => {
    if (buffer) console.log(`${tag} ${buffer}`);
  });
}

function runStreaming({ label, color, command, args, cwd = repoRoot, env = {} }) {
  return new Promise((resolvePromise) => {
    console.log(dim(`$ ${command} ${args.join(" ")}  (cwd=${relative(repoRoot, cwd) || "."})`));
    const tag = color(`[${label}]`);
    let child;
    try {
      child = spawnCommand(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      console.error(`${tag} ${red(`无法启动：${error.message}`)}`);
      return resolvePromise(1);
    }
    forwardStream(child.stdout, tag);
    forwardStream(child.stderr, tag);
    let settled = false;
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      console.error(`${tag} ${red(`进程错误：${error.message}`)}`);
      resolvePromise(1);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolvePromise(code ?? 1);
    });
  });
}

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function startBackend(config) {
  const cwd = join(config.outputDir, "backend");
  const tag = blue("[app]");
  const url = `http://127.0.0.1:${config.port}${config.healthPath}`;
  console.log(dim(`$ ${npmCmd} run start  (cwd=${relative(repoRoot, cwd)}) PORT=${config.port}`));

  const child = spawnCommand(npmCmd, ["run", "start"], {
    cwd,
    env: { ...process.env, PORT: String(config.port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: !isWindows,
  });
  forwardStream(child.stdout, tag);
  forwardStream(child.stderr, tag);
  let exited = false;
  let exitInfo = "";
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = signal ? `signal ${signal}` : `code ${code}`;
  });

  console.log(`${tag} ${dim(`等待 ${url} ...`)}`);
  const startedAt = Date.now();
  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (exited) throw new Error(`backend 在就绪前退出（${exitInfo}）`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) {
        console.log(`${tag} ${green("就绪")} ${url}`);
        return makeBackendHandle(child, tag);
      }
    } catch {
      // not ready yet
    }
    await delay(POLL_MS);
  }
  throw new Error(`等待健康检查超时（${HEALTH_TIMEOUT_MS}ms）：${url}`);
}

function makeBackendHandle(child, tag) {
  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      console.log(dim(`${tag} 停止 backend ...`));
      await killProcessTree(child.pid);
      await delay(POLL_MS);
    },
  };
}

function countOfficialTests(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += countOfficialTests(path);
    else if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      const matches = readFileSync(path, "utf8").match(/\btest\s*\(/g);
      total += matches ? matches.length : 0;
    }
  }
  return total;
}

function summarize(config, testCode) {
  const total = countOfficialTests(config.testDir);
  const resultDir = join(config.artifactsDir, config.testApp, "test-results");
  const reportDir = join(config.artifactsDir, config.testApp, "playwright-report");
  const lastRunPath = join(resultDir, ".last-run.json");
  let failed = null;
  try {
    const lastRun = JSON.parse(readFileSync(lastRunPath, "utf8"));
    if (Array.isArray(lastRun.failedTests)) failed = lastRun.failedTests.length;
  } catch {
    failed = null;
  }

  console.log(bold("评测汇总"));
  if (config.grep) {
    const note = failed === null ? "结果不可读" : failed === 0 ? green("无失败") : red(`${failed} 失败`);
    console.log(`  官方用例 : --grep "${config.grep}" 已过滤运行（${note}），完整通过数见报告`);
  } else if (failed === null) {
    console.log(`  官方用例 : 无法读取结果（runner 退出码 ${testCode}）`);
  } else {
    const passed = Math.max(total - failed, 0);
    const verdict = failed === 0 && testCode === 0 ? green("全部通过") : red(`${failed} 失败`);
    console.log(`  官方用例 : ${passed}/${total} 通过，${verdict}`);
  }
  console.log(`  产物目录 : ${config.outputDir}`);
  console.log(`  测试报告 : ${join(reportDir, "index.html")}`);
  console.log(`  失败证据 : ${resultDir}`);
}

async function main() {
  let config;
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return 0;
    }
    config = resolveConfig(options);
    if (config.port === 0) config.port = await findFreePort();
  } catch (error) {
    console.error(red(`[eval-local] ${error.message}`));
    console.error(dim("运行 `node scripts/eval-local.mjs --help` 查看用法。"));
    return 2;
  }

  banner(config);
  const planned = [];
  if (!config.evalOnly) planned.push(`生成（${config.agent}）`);
  if (!config.generateOnly) planned.push("构建", "启动与健康检查", "官方测试");
  let stageIndex = 0;
  const stage = () => {
    const title = planned[stageIndex];
    stageIndex += 1;
    const bar = agentPaint[config.agent]("=====");
    console.log(`\n${bar} ${bold(`[${stageIndex}/${planned.length}] ${title}`)} ${bar}`);
    return title;
  };

  let backend = null;
  try {
    if (!config.evalOnly) {
      stage();
      const genEnv = config.budgetMs > 0 ? { SHALLOW_BUDGET_MS: String(config.budgetMs) } : {};
      const genArgs = [config.adapter, config.requirementDir, "--output-dir", config.outputDir, "--type", "web"];
      if (!config.noWebPort) genArgs.push("--web-port", String(config.port));
      genArgs.push(...config.genArgs);
      const code = await runStreaming({
        label: `gen:${config.agent}`,
        color: agentPaint[config.agent],
        command: config.pythonCmd,
        args: genArgs,
        cwd: config.agentRoot,
        env: genEnv,
      });
      if (code !== 0) {
        console.error(red(`\n生成失败（退出码 ${code}）。`));
        return code || 1;
      }
      if (config.generateOnly) {
        console.log(green(`\n生成完成：${config.outputDir}`));
        return 0;
      }
    }

    stage();
    if (!config.skipInstall) {
      if (await runStreaming({ label: "build", color: blue, command: npmCmd, args: ["install", "--no-audit", "--no-fund"], cwd: join(config.outputDir, "frontend") })) return 1;
      if (await runStreaming({ label: "build", color: blue, command: npmCmd, args: ["install", "--no-audit", "--no-fund"], cwd: join(config.outputDir, "backend") })) return 1;
    }
    if (!config.skipBuild) {
      if (await runStreaming({ label: "build", color: blue, command: npmCmd, args: ["run", "build"], cwd: join(config.outputDir, "frontend") })) return 1;
    }

    stage();
    backend = await startBackend(config);

    stage();
    if (!existsSync(join(benchmarkRoot, "node_modules"))) {
      const lock = await acquireBenchmarkInstallLock();
      let installCode = 0;
      try {
        if (!existsSync(join(benchmarkRoot, "node_modules"))) {
          installCode = await runStreaming({ label: "test", color: yellow, command: npmCmd, args: ["install"], cwd: benchmarkRoot });
          if (installCode === 0) {
            installCode = await runStreaming({ label: "test", color: yellow, command: npmCmd, args: ["run", "test:install"], cwd: benchmarkRoot });
          }
        }
      } finally {
        lock.release();
      }
      if (installCode) return 1;
    }
    const testArgs = ["scripts/run-playwright.js", "--app", config.testApp, "--target-url", `http://127.0.0.1:${config.port}`];
    if (config.playwrightTimeout > 0) testArgs.push("--timeout", String(config.playwrightTimeout));
    if (config.expectTimeout > 0) testArgs.push("--expect-timeout", String(config.expectTimeout));
    if (config.grep) testArgs.push("--grep", config.grep);
    const testCode = await runStreaming({
      label: "test",
      color: yellow,
      command: "node",
      args: testArgs,
      cwd: benchmarkRoot,
      env: {
        PLAYWRIGHT_OUTPUT_ROOT: config.artifactsDir,
        PLAYWRIGHT_REPORT_ROOT: config.artifactsDir,
      },
    });
    console.log("");
    summarize(config, testCode);
    return testCode;
  } catch (error) {
    console.error(red(`\n[eval-local] ${error.message}`));
    return 1;
  } finally {
    if (backend && !config.keepRunning) await backend.stop();
    if (config.keepRunning) console.log(dim("[app] 按 --keep-running 保留 backend，请自行清理。"));
  }
}

main().then((code) => {
  process.exitCode = code;
});
