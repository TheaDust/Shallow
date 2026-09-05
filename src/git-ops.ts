import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { spawnProcess } from "./process-spawn.js";

export interface GitOps {
  captureAccepted(message: string): Promise<string>;
  restoreAccepted(sha: string): Promise<void>;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const GIT_TIMEOUT_MS = 30_000;

const GITIGNORE_CONTENT = ["node_modules/", "dist/", "build/", ".next/", ".env", ""].join("\n");

export class GitCliOps implements GitOps {
  private constructor(private readonly repositoryRoot: string) {}

  static async open(outputDirectory: string): Promise<GitCliOps> {
    const requested = resolve(outputDirectory);
    await mkdir(requested, { recursive: true });
    const canonical = await realpath(requested);
    let rootResult = await runGit(canonical, ["rev-parse", "--show-toplevel"], true);
    if (rootResult.code !== 0) {
      await requireGit(canonical, ["init"]);
      rootResult = await requireGit(canonical, ["rev-parse", "--show-toplevel"]);
    }
    const actualRoot = await realpath(rootResult.stdout.trim());
    if (!samePath(actualRoot, canonical)) {
      throw new Error(`Output directory must be a Git repository root: ${canonical}`);
    }
    await ensureIgnoreRules(canonical);
    return new GitCliOps(canonical);
  }

  async captureAccepted(message: string): Promise<string> {
    await this.validateRoot();
    await requireGit(this.repositoryRoot, ["add", "-A"]);
    const head = await runGit(
      this.repositoryRoot,
      ["rev-parse", "--verify", "HEAD"],
      true,
    );
    const staged = await runGit(
      this.repositoryRoot,
      ["diff", "--cached", "--quiet"],
      true,
    );
    if (head.code === 0 && staged.code === 0) return head.stdout.trim();

    await requireGit(this.repositoryRoot, [
      "-c",
      "user.name=ShallowCode",
      "-c",
      "user.email=shallowcode@local.invalid",
      "commit",
      "--allow-empty",
      "-m",
      message,
    ]);
    return (await requireGit(this.repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim();
  }

  async restoreAccepted(sha: string): Promise<void> {
    await this.validateRoot();
    if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
      throw new Error(`${sha} is not a commit in the output repository`);
    }
    const commit = await runGit(
      this.repositoryRoot,
      ["cat-file", "-e", `${sha}^{commit}`],
      true,
    );
    if (commit.code !== 0) {
      throw new Error(`${sha} is not a commit in the output repository`);
    }
    const ancestor = await runGit(
      this.repositoryRoot,
      ["merge-base", "--is-ancestor", sha, "HEAD"],
      true,
    );
    if (ancestor.code !== 0) {
      throw new Error(`${sha} is not an accepted ancestor of the output repository`);
    }
    // Audit events describe the whole run, including rejected candidates. Keep
    // them in the worktree while restoring application files and moving HEAD.
    await requireGit(this.repositoryRoot, ["reset", "--mixed", sha]);
    await requireGit(this.repositoryRoot, [
      "restore", "--worktree", "--", ".", ":(top,exclude).arc",
    ]);
    await requireGit(this.repositoryRoot, ["clean", "-fd", "-e", ".arc/"]);
  }

  private async validateRoot(): Promise<void> {
    const canonical = await realpath(this.repositoryRoot);
    const root = await requireGit(canonical, ["rev-parse", "--show-toplevel"]);
    const actualRoot = await realpath(root.stdout.trim());
    if (!samePath(canonical, actualRoot)) {
      throw new Error("Output repository root changed after GitOps initialization");
    }
  }
}

async function requireGit(cwd: string, args: string[]): Promise<CommandResult> {
  const result = await runGit(cwd, args, true);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result;
}

export function runGit(
  cwd: string,
  args: string[],
  allowFailure: boolean,
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnProcess("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const hardTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs + 2_000);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      if (timedOut) {
        reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`));
        return;
      }
      const result = { code: code ?? -1, stdout, stderr };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

async function ensureIgnoreRules(root: string): Promise<void> {
  const gitignorePath = join(root, ".gitignore");
  try {
    await readFile(gitignorePath, "utf8");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(gitignorePath, GITIGNORE_CONTENT, "utf8");
  await requireGit(root, ["add", ".gitignore"]);
  await requireGit(root, [
    "-c",
    "user.name=ShallowCode",
    "-c",
    "user.email=shallowcode@local.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "chore: add ShallowCode ignore rules",
  ]);
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]$/, "").toLowerCase() === right.replace(/[\\/]$/, "").toLowerCase();
}
