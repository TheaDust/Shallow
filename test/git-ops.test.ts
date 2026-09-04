import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { GitCliOps, runGit } from "../src/git-ops.js";
import { withTempDir } from "./helpers/temp-dir.js";

const execFileAsync = promisify(execFile);

test("GitOps captures an empty baseline and returns HEAD when nothing changed", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    const git = await GitCliOps.open(directory);

    const baseline = await git.captureAccepted("shallow: baseline");
    const unchanged = await git.captureAccepted("shallow: unchanged");

    assert.match(baseline, /^[0-9a-f]{40}$/);
    assert.equal(unchanged, baseline);
  });
});

test("GitOps writes and tracks ignore rules when initializing", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    await GitCliOps.open(directory);

    const content = await readFile(join(directory, ".gitignore"), "utf8");
    assert.match(content, /node_modules\//);
    assert.match(content, /\.env/);

    const tracked = await execFileAsync("git", ["ls-files", ".gitignore"], {
      cwd: directory,
    });
    assert.equal(tracked.stdout.trim(), ".gitignore");
  });
});

test("GitOps keeps an existing .gitignore untouched", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    await writeFile(join(directory, ".gitignore"), "custom/\n", "utf8");

    await GitCliOps.open(directory);

    assert.equal(await readFile(join(directory, ".gitignore"), "utf8"), "custom/\n");
  });
});

test("runGit kills the child and rejects when the command exceeds its timeout", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    await assert.rejects(
      runGit(directory, ["rev-parse", "--show-toplevel"], true, 1),
      /timed out after 1ms/,
    );
  });
});

test("GitOps captures changes and restores the accepted ancestor", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    const git = await GitCliOps.open(directory);
    const baseline = await git.captureAccepted("shallow: baseline");
    const tracked = join(directory, "app.txt");
    await writeFile(tracked, "accepted");
    const accepted = await git.captureAccepted("shallow: accepted");
    await writeFile(tracked, "broken");
    const untracked = join(directory, "candidate.tmp");
    await writeFile(untracked, "candidate");

    await git.restoreAccepted(accepted);

    assert.notEqual(accepted, baseline);
    assert.equal(await readFile(tracked, "utf8"), "accepted");
    await assert.rejects(access(untracked));
  });
});

test("GitOps rejects a value that is not a commit in the output repository", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    const git = await GitCliOps.open(directory);
    await git.captureAccepted("shallow: baseline");

    await assert.rejects(
      git.restoreAccepted("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      /not a commit in the output repository/,
    );
  });
});
