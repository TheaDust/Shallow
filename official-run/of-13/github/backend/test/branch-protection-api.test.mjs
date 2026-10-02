// REQ-6-1: the branch protection rules of one repository.
//
// A rule is bound to one exact branch name and stores the two independently
// selectable requirements: "at least 1 valid Approve from someone other than
// the PR author" and "required check `test` is success". Only a repository
// Admin (or organization Owner) may store a rule; every reader of the settings
// panel sees the stored rules verbatim, and a refused save leaves the stored
// rules unchanged.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { call, startApp } from "../testlib/api-helpers.mjs";

const ALICE = { username: "alice-dev", password: "Valid-password-123!" };
const BOB = { username: "bob-reviewer", password: "Valid-password-123!" };
const REPOSITORY = "/api/repositories/acme-demo/acme-docs";
const SETTINGS = `${REPOSITORY}/settings/branches`;
const PROTECTION = `${SETTINGS}/protection`;

async function withApp(run) {
  const app = await startApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

async function signIn(app, { username, password }) {
  const response = await call(app.baseUrl, "/api/session", {
    method: "POST",
    body: { identifier: username, password },
  });
  assert.equal(response.status, 200);
  return response.setCookie?.split(";")[0] ?? null;
}

async function stateSnapshot(app) {
  try {
    return await readFile(join(app.dataDir, "state.json"), "utf8");
  } catch {
    return null;
  }
}

test("the seeded rule protects the exact branch main and is readable without a session", async () => {
  await withApp(async (app) => {
    const settings = await call(app.baseUrl, SETTINGS);
    assert.equal(settings.status, 200);
    assert.equal(settings.body.canAdminister, false);
    assert.deepEqual(
      settings.body.branchProtectionRules.map((rule) => rule.branchName),
      ["main"],
    );
    const [rule] = settings.body.branchProtectionRules;
    // The branch name is visible verbatim together with the summaries of the
    // two enabled requirements.
    assert.equal(rule.requireApproval, true);
    assert.equal(rule.requireStatusCheck, true);
    assert.deepEqual(rule.requirements, ["1 approval", "Require status check test"]);
    // A visitor never receives the save entry of the panel.
    assert.equal(settings.body.canAdminister, false);
  });
});

test("a non-Admin cannot create or modify a rule and nothing is stored", async () => {
  await withApp(async (app) => {
    const visitor = await call(app.baseUrl, PROTECTION, {
      method: "POST",
      body: { branchName: "main", requireApproval: false, requireStatusCheck: false },
    });
    assert.equal(visitor.status, 401);

    const memberCookie = await signIn(app, BOB);
    const before = await stateSnapshot(app);
    const member = await call(app.baseUrl, PROTECTION, {
      method: "POST",
      cookie: memberCookie,
      body: { branchName: "main", requireApproval: false, requireStatusCheck: false },
    });
    assert.equal(member.status, 403);
    assert.equal(member.body.error, "Access denied");

    // The Write collaborator still reads the rules, but the rule is unchanged.
    const settings = await call(app.baseUrl, SETTINGS, { cookie: memberCookie });
    assert.equal(settings.status, 200);
    assert.equal(settings.body.canAdminister, false);
    assert.equal(settings.body.branchProtectionRules[0].requireApproval, true);
    assert.equal(settings.body.branchProtectionRules[0].requireStatusCheck, true);
    assert.equal(await stateSnapshot(app), before);
  });
});

test("an Admin creates a rule for an exact branch and saves changes to it", async () => {
  await withApp(async (app) => {
    const cookie = await signIn(app, ALICE);

    // A blank pattern is refused with its own field error.
    const blank = await call(app.baseUrl, PROTECTION, {
      method: "POST",
      cookie,
      body: { branchName: "   ", requireApproval: true },
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.fieldErrors.branchName, "Branch name pattern is required");

    // A new exact branch name creates one rule.
    const created = await call(app.baseUrl, PROTECTION, {
      method: "POST",
      cookie,
      body: { branchName: "feature-search", requireApproval: true, requireStatusCheck: false },
    });
    assert.equal(created.status, 200);
    assert.deepEqual(
      created.body.branchProtectionRules.map((rule) => rule.branchName),
      ["feature-search", "main"],
    );
    const createdRule = created.body.branchProtectionRules.find(
      (rule) => rule.branchName === "feature-search",
    );
    assert.deepEqual(createdRule.requirements, ["1 approval"]);

    // Saving the same exact name again replaces the two toggles of that rule
    // instead of adding a second one.
    const saved = await call(app.baseUrl, PROTECTION, {
      method: "POST",
      cookie,
      body: { branchName: "feature-search", requireApproval: false, requireStatusCheck: true },
    });
    assert.equal(saved.status, 200);
    const rules = saved.body.branchProtectionRules.filter(
      (rule) => rule.branchName === "feature-search",
    );
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].requirements, ["Require status check test"]);
    assert.equal(rules[0].updatedBy, "alice-dev");
    assert.ok(rules[0].updatedAt);

    // The stored rules survive a restart and stay readable to a non-Admin.
    const baseUrl = await app.restart();
    const reloaded = await call(baseUrl, SETTINGS, { cookie: await signIn(app, BOB) });
    assert.deepEqual(
      reloaded.body.branchProtectionRules.map((rule) => rule.branchName),
      ["feature-search", "main"],
    );

    // The main rule still carries both requirements.
    const main = reloaded.body.branchProtectionRules.find((rule) => rule.branchName === "main");
    assert.deepEqual(main.requirements, ["1 approval", "Require status check test"]);
  });
});
