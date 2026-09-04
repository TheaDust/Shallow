import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { GitCliOps } from "../src/git-ops.js";
import { withTempDir } from "./helpers/temp-dir.js";

test("GitOps captures an empty baseline and returns HEAD when nothing changed", async () => {
  await withTempDir("shallow-git-", async (directory) => {
    const git = await GitCliOps.open(directory);

    const baseline = await git.captureAccepted("shallow: baseline");
    const unchanged = await git.captureAccepted("shallow: unchanged");

    assert.match(baseline, /^[0-9a-f]{40}$/);
    assert.equal(unchanged, baseline);
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
