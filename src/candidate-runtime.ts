import { createHash, randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CommandAppLifecycle, CandidatePreparationError, runCommand } from "./final-verifier.js";
import type { AppLifecycle } from "./pipeline.js";
import type { CandidateEvidence, PlatformContract, RunEvent } from "./types.js";

type Snapshot = Map<string, { digest: string; mode: number }>;
type RunningApp = Awaited<ReturnType<AppLifecycle["start"]>>;
type Build = Omit<CandidateEvidence, "runtimeId"> & { dependencyState: string };

/** One private build workspace per run. No Judge input is stored here or exposed by the tools. */
export class CandidateRuntime {
  readonly directory: string;
  private build?: Build;
  private installedKey?: string;
  private installedState?: string;
  private acceptedInputDigest?: string;
  private application?: RunningApp;
  private builderEpoch = 0;
  private builderOpen = false;
  private queue: Promise<unknown> = Promise.resolve();
  private recorder?: (event: RunEvent) => Promise<void>;
  private commandAbort?: AbortController;

  constructor(
    private readonly outputDir: string,
    private readonly workspace: string,
    private readonly contract: PlatformContract,
    private readonly lifecycle: AppLifecycle = new CommandAppLifecycle(),
  ) {
    this.directory = join(resolve(workspace), "app");
    if (inside(resolve(outputDir), resolve(workspace)) || inside(resolve(workspace), resolve(outputDir))) {
      throw new Error("Candidate workspace must be separate from output directory");
    }
  }

  setRecorder(recorder: (event: RunEvent) => Promise<void>): void { this.recorder = recorder; }

  beginBuilder(): number {
    if (this.builderOpen) throw new Error("Builder candidate tools already active");
    this.builderOpen = true;
    this.builderEpoch++;
    return this.builderEpoch;
  }

  async endBuilder(epoch?: number): Promise<void> {
    if (epoch !== undefined && epoch !== this.builderEpoch) return;
    this.builderOpen = false;
    this.builderEpoch++;
    this.commandAbort?.abort();
    await this.queue.catch(() => {});
    await this.stop();
  }

  async builderPrepare(): Promise<{ baseUrl: string }> {
    const epoch = this.builderEpoch;
    if (!this.builderOpen) throw new Error("Candidate tools are inactive outside a Builder call");
    return this.serial(async () => {
      this.checkBuilder(epoch);
      await this.stop();
      await this.prepareBuild();
      this.checkBuilder(epoch);
      const application = await this.launch();
      if (!this.builderOpen || epoch !== this.builderEpoch) {
        await this.stop();
        throw new Error("Candidate preparation cancelled");
      }
      return { baseUrl: application.baseUrl };
    });
  }

  async builderStop(): Promise<void> {
    const epoch = this.builderEpoch;
    if (!this.builderOpen) throw new Error("Candidate tools are inactive outside a Builder call");
    return this.serial(async () => { this.checkBuilder(epoch); await this.stop(); });
  }

  async prepare(): Promise<void> {
    if (this.builderOpen) throw new Error("Cannot verify while Builder tools are active");
    await this.serial(async () => { await this.stop(); await this.prepareBuild(); });
  }

  async start(_outputDir: string, _contract: PlatformContract): Promise<RunningApp> {
    await this.prepare();
    return this.launch();
  }

  async assertCurrent(evidence: CandidateEvidence): Promise<void> {
    if (!this.build || this.build.candidateId !== evidence.candidateId || this.build.buildId !== evidence.buildId ||
      this.build.applicationDigest !== evidence.applicationDigest || this.build.inputDigest !== evidence.inputDigest ||
      !await this.matches(this.build)) {
      this.build = undefined;
      throw new CandidatePreparationError("candidate", "Candidate files or build changed; verification evidence is invalid");
    }
  }

  recordAccepted(evidence: CandidateEvidence): void { this.acceptedInputDigest = evidence.inputDigest; }

  async assertAcceptedInput(): Promise<void> {
    if (this.acceptedInputDigest && digestSnapshot(await snapshot(this.outputDir)) !== this.acceptedInputDigest) {
      throw new CandidatePreparationError("candidate", "Accepted candidate changed before delivery; verification evidence is invalid");
    }
  }

  async stop(): Promise<void> {
    const application = this.application;
    if (application) {
      await application.stop();
      this.application = undefined;
    }
  }

  async close(): Promise<void> { await this.endBuilder(); }

  private checkBuilder(epoch: number): void {
    if (!this.builderOpen || epoch !== this.builderEpoch) throw new Error("Candidate preparation cancelled");
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async emit(type: "candidate_prepared" | "candidate_prepare_failed", detail: Record<string, unknown>): Promise<void> {
    await this.recorder?.({ at: new Date().toISOString(), type, detail } as RunEvent);
  }

  private async prepareBuild(): Promise<void> {
    const started = Date.now();
    let stage: "install" | "build" | "candidate" = "candidate";
    this.commandAbort = new AbortController();
    const signal = this.commandAbort.signal;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const sourceRoot = await realpath(this.outputDir);
      const buildRoot = await realpath(this.directory);
      if ((await lstat(this.directory)).isSymbolicLink() || !inside(await realpath(this.workspace), buildRoot)) {
        throw new Error("Candidate application directory must remain inside its private workspace");
      }
      if (inside(sourceRoot, buildRoot) || inside(buildRoot, sourceRoot)) throw new Error("Candidate workspace resolves into output directory");
      if (this.build && await this.matches(this.build)) {
        await this.emit("candidate_prepared", { ...this.publicBuild(this.build), reused: true, installed: false,
          durationMs: Date.now() - started, installMs: 0, buildMs: 0 });
        return;
      }
      this.build = undefined;
      const inputs = await snapshot(this.outputDir);
      const inputDigest = digestSnapshot(inputs);
      const installKey = await dependencyKey(this.outputDir, inputs, this.contract);
      const dependencies = await dependencyState(this.directory);
      const reuseInstall = this.installedKey === installKey && this.installedState === dependencies;
      // Clear every previous application file, including old ignored build output; retain only owned dependencies.
      await clearApplication(this.directory, reuseInstall);
      for (const [path] of inputs) {
        const target = join(this.directory, path);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(this.outputDir, path), target);
      }
      if (digestSnapshot(await snapshot(this.directory)) !== inputDigest ||
        digestSnapshot(await snapshot(this.outputDir)) !== inputDigest) {
        throw new Error("Candidate changed while copying build inputs");
      }
      signal.throwIfAborted();
      stage = "install";
      let installMs = 0;
      if (!reuseInstall) {
        this.installedKey = undefined;
        this.installedState = undefined;
        const at = Date.now();
        for (const command of this.contract.installCommands) {
          await runCommand(this.directory, command, this.contract.buildTimeoutMs, signal);
        }
        installMs = Date.now() - at;
      }
      stage = "build";
      const buildAt = Date.now();
      for (const command of this.contract.buildCommands) {
        await runCommand(this.directory, command, this.contract.buildTimeoutMs, signal);
      }
      const buildMs = Date.now() - buildAt;
      signal.throwIfAborted();
      stage = "candidate";
      if (digestSnapshot(await snapshot(this.outputDir)) !== inputDigest) throw new Error("Candidate changed during preparation");
      const applicationDigest = digestSnapshot(await snapshot(this.directory));
      const currentDependencies = await dependencyState(this.directory);
      this.installedKey = installKey;
      this.installedState = currentDependencies;
      this.build = { candidateId: randomUUID(), buildId: randomUUID(), inputDigest, applicationDigest,
        dependencyState: currentDependencies };
      await this.emit("candidate_prepared", { ...this.publicBuild(this.build), reused: false, installed: !reuseInstall,
        durationMs: Date.now() - started, installMs, buildMs });
    } catch (error) {
      this.build = undefined;
      this.installedKey = undefined;
      this.installedState = undefined;
      const message = error instanceof Error ? error.message : String(error);
      await this.emit("candidate_prepare_failed", { stage, message, durationMs: Date.now() - started });
      throw new CandidatePreparationError(stage, message);
    } finally { this.commandAbort = undefined; }
  }

  private publicBuild(build: Build): Omit<CandidateEvidence, "runtimeId"> {
    const { dependencyState: _state, ...identity } = build;
    return identity;
  }

  private async matches(build: Build): Promise<boolean> {
    const inputs = await snapshot(this.outputDir);
    return digestSnapshot(inputs) === build.inputDigest &&
      await dependencyKey(this.outputDir, inputs, this.contract) === this.installedKey &&
      digestSnapshot(await snapshot(this.directory)) === build.applicationDigest &&
      await dependencyState(this.directory) === build.dependencyState;
  }

  private async launch(): Promise<RunningApp> {
    const build = this.build!;
    const dataDirectory = join(resolve(this.workspace), "data");
    await mkdir(dataDirectory, { recursive: true });
    const application = await this.lifecycle.start(this.directory, { ...this.contract, dataDirectory });
    this.application = application;
    const candidate: CandidateEvidence = { ...this.publicBuild(build), runtimeId: randomUUID() };
    try { await this.assertCurrent(candidate); } catch (error) { await this.stop(); throw error; }
    return { baseUrl: application.baseUrl, candidate,
      assertUnchanged: async () => { await application.assertUnchanged?.(); await this.assertCurrent(candidate); }, stop: () => this.stop() };
  }
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..\\`) && !path.startsWith("../"));
}

async function snapshot(root: string): Promise<Snapshot> {
  const files: Snapshot = new Map();
  async function visit(directory: string, prefix = ""): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.name === "node_modules" || (!prefix && [".git", ".arc"].includes(entry.name))) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Application links are not supported: ${path}`);
      if (entry.isDirectory()) await visit(absolute, path);
      else if (entry.isFile()) {
        const before = await lstat(absolute);
        const content = await readFile(absolute);
        const after = await lstat(absolute);
        if (after.isSymbolicLink() || before.ctimeMs !== after.ctimeMs || before.size !== after.size) throw new Error("Application changed while hashing");
        files.set(path, { digest: hash(content), mode: before.mode & 0o111 });
      } else throw new Error(`Unsupported application file: ${path}`);
    }
  }
  await visit(root);
  return files;
}

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function digestSnapshot(files: Snapshot): string { return hash(JSON.stringify([...files])); }

async function clearApplication(directory: string, keepDependencies: boolean): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "node_modules" && keepDependencies) continue;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      await clearApplication(path, keepDependencies);
      if ((await readdir(path)).length === 0) await rm(path, { recursive: true });
    } else await rm(path, { recursive: true, force: true });
  }
}

async function dependencyKey(root: string, inputs: Snapshot, contract: PlatformContract): Promise<string> {
  const entries: unknown[] = [process.version, process.platform, process.arch, process.execPath, process.env, contract];
  let sourceSensitive = false;
  for (const [path, value] of inputs) {
    const name = path.split("/").at(-1)!;
    if (["package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc", "yarn.lock", "pnpm-lock.yaml"].includes(name)) entries.push([path, value]);
    if (name === "package.json") {
      const pkg = JSON.parse(await readFile(join(root, path), "utf8"));
      if (pkg.workspaces || ["preinstall", "install", "postinstall", "prepare"].some((key) => pkg.scripts?.[key]) ||
        Object.values({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }).some((value) =>
          typeof value === "string" && /^(?:file:|link:|workspace:|\.|\/)/.test(value))) sourceSensitive = true;
    }
  }
  const config = process.env.NPM_CONFIG_USERCONFIG ?? process.env.npm_config_userconfig ?? join(homedir(), ".npmrc");
  try { entries.push(hash(await readFile(config))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (sourceSensitive) entries.push(digestSnapshot(inputs));
  return hash(JSON.stringify(entries));
}

/** Detect normal mutation/removal of owned installed packages without rehashing all dependency bytes. */
async function dependencyState(root: string): Promise<string> {
  const entries: unknown[] = [];
  async function visit(directory: string, prefix: string, dependency: boolean): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const path = `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      const included = dependency || entry.name === "node_modules";
      if (included) {
        const stat = await lstat(absolute);
        entries.push([path, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, stat.ino,
          entry.isSymbolicLink() ? await readlink(absolute) : ""]);
      }
      if (entry.isDirectory()) await visit(absolute, path, included);
    }
  }
  await visit(root, "", false);
  return hash(JSON.stringify(entries));
}
