import { spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

export interface GitOps {
  captureAccepted(message: string): Promise<string>;
  restoreAccepted(sha: string): Promise<void>;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

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
    await requireGit(this.repositoryRoot, ["reset", "--hard", sha]);
    await requireGit(this.repositoryRoot, ["clean", "-fd"]);
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

function runGit(cwd: string, args: string[], allowFailure: boolean): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code: code ?? -1, stdout, stderr };
      if (!allowFailure && result.code !== 0) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]$/, "").toLowerCase() === right.replace(/[\\/]$/, "").toLowerCase();
}
