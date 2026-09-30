import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";

async function startApp(dataDir) {
  const handler = createApp({ dataDir, staticRoot: join(dataDir, "static") });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function newDataDir() {
  return mkdtemp(join(tmpdir(), "shallowcode-issues-"));
}

function jsonRequest(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(baseUrl, identifier) {
  const response = await jsonRequest(baseUrl, "/api/sessions", {
    method: "POST",
    body: { identifier, password: "Valid-password-123!" },
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

/**
 * A signed-in account without any role on the seeded repositories. Every seeded
 * account collaborates on `alice-dev/acme-docs` (`alice-dev` owns it, and
 * `bob-reviewer` and `carol-dev` hold a Write grant, REQ-6), so a case that needs
 * a viewer outside the collaborator scope registers its own account.
 */
let outsiderCount = 0;
async function signInOutsider(baseUrl) {
  outsiderCount += 1;
  const username = `pw-outsider-${outsiderCount}`;
  const registered = await jsonRequest(baseUrl, "/api/accounts", {
    method: "POST",
    body: {
      username,
      email: `${username}@example.test`,
      password: "Valid-password-123!",
      confirmPassword: "Valid-password-123!",
      termsAccepted: true,
    },
  });
  assert.equal(registered.status, 201);
  return { cookie: await signIn(baseUrl, username), username };
}

const ACME_DOCS = "/api/repositories/alice-dev/acme-docs/issues";

/**
 * The account identifier of one authorization candidate of `alice-dev/acme-docs`
 * as the access API reports it to its administrator.
 */
async function accountIdOf(baseUrl, cookie, username) {
  const response = await jsonRequest(baseUrl, "/api/repositories/alice-dev/acme-docs/access", {
    cookie,
  });
  assert.equal(response.status, 200);
  const candidate = (await response.json()).candidates.find(
    (subject) => subject.type === "account" && subject.name === username,
  );
  assert.ok(candidate, `expected ${username} among the authorization candidates`);
  return candidate.id;
}
const ORGANIZATION_DOCS = "/api/repositories/acme-demo/acme-docs/issues";
const INTERNAL = "/api/repositories/acme-demo/acme-internal/issues";

test("the seeded issues of a repository are readable without a session", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const response = await jsonRequest(app.baseUrl, ACME_DOCS);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.repository.fullName, "alice-dev/acme-docs");
  assert.deepEqual(
    payload.labels.map((label) => label.name),
    ["bug", "documentation"],
  );
  assert.deepEqual(
    payload.milestones.map((milestone) => milestone.title),
    ["Q3 launch", "v1.0"],
  );
  assert.deepEqual(
    payload.issues.map((issue) => [issue.number, issue.title, issue.status]),
    [
      [1, "Improve onboarding", "open"],
      [2, "Legacy welcome text", "closed"],
      [3, "Original issue title", "open"],
    ],
  );

  const openIssue = payload.issues[0];
  assert.equal(openIssue.author, "alice-dev");
  assert.deepEqual(
    openIssue.labels.map((label) => label.name),
    ["bug"],
  );
  assert.deepEqual(openIssue.assignees, ["alice-dev"]);
  assert.equal(openIssue.milestone.title, "Q3 launch");
  assert.equal(typeof openIssue.updatedAt, "string");

  const detail = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`);
  assert.equal(detail.status, 200);
  const issue = (await detail.json()).issue;
  assert.equal(issue.title, "Improve onboarding");
  assert.equal(issue.description, "Describe the onboarding improvement.");
  assert.equal(issue.status, "open");
  assert.equal(issue.comments.length >= 1, true);
  assert.equal(issue.comments[0].author, "alice-dev");
  assert.equal(typeof issue.comments[0].body, "string");
  assert.deepEqual(
    issue.activities.map((activity) => activity.type),
    ["created", "commented"],
  );
  // Creation and comment activities are chronological.
  assert.equal(
    issue.activities[0].createdAt <= issue.activities[1].createdAt,
    true,
  );

  // The second record that carries the name `acme-docs` holds the same planning
  // data, so the scenarios' repository is found in either namespace.
  const organization = await jsonRequest(app.baseUrl, ORGANIZATION_DOCS);
  assert.equal(organization.status, 200);
  assert.deepEqual(
    (await organization.json()).issues.map((issue) => issue.title),
    ["Improve onboarding", "Legacy welcome text", "Original issue title"],
  );

  const unknown = await jsonRequest(app.baseUrl, `${ACME_DOCS}/99`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).repository.fullName, "alice-dev/acme-docs");

  const unknownRepository = await jsonRequest(
    app.baseUrl,
    "/api/repositories/alice-dev/no-such-repo/issues",
  );
  assert.equal(unknownRepository.status, 404);
});

test("labels and milestones stay scoped to their own repository", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  // The protected repository is readable for its granted collaborator only.
  const anonymous = await jsonRequest(app.baseUrl, INTERNAL);
  assert.equal(anonymous.status, 404);
  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const readable = await jsonRequest(app.baseUrl, INTERNAL, { cookie: bob });
  assert.equal(readable.status, 200);
  const payload = await readable.json();
  assert.deepEqual(
    payload.labels.map((label) => label.name),
    ["internal"],
  );
  assert.deepEqual(
    payload.issues.map((issue) => issue.title),
    ["Internal review checklist"],
  );
});

test("a creation without permission or with an invalid title stores nothing", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const before = await (await jsonRequest(app.baseUrl, ACME_DOCS)).json();
  const anonymousand = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    body: { title: "Anonymous issue", description: "" },
  });
  assert.equal(anonymousand.status, 401);

  // An account outside the collaborator scope may read the public repository
  // but not write to its issues.
  const { cookie: outsider } = await signInOutsider(app.baseUrl);
  const refused = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: outsider,
    body: { title: "Not allowed", description: "" },
  });
  assert.equal(refused.status, 403);

  const alice = await signIn(app.baseUrl, "alice-dev");
  const blank = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: alice,
    body: { title: "   ", description: "" },
  });
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).fields.title, "Title is required");

  const overlong = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: alice,
    body: { title: "a".repeat(257), description: "" },
  });
  assert.equal(overlong.status, 400);
  assert.equal(typeof (await overlong.json()).fields.title, "string");

  const longDescription = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: alice,
    body: { title: "Valid title", description: "b".repeat(65537) },
  });
  assert.equal(longDescription.status, 400);
  assert.equal(typeof (await longDescription.json()).fields.description, "string");

  const after = await (await jsonRequest(app.baseUrl, ACME_DOCS)).json();
  assert.deepEqual(after.issues, before.issues);
});

test("a writer creates an issue that gets the next number and is readable again", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());

  const alice = await signIn(app.baseUrl, "alice-dev");
  const created = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: alice,
    body: { title: "Add a search shortcut", description: "Type `/` to search." },
  });
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.issue.number, 4);
  assert.equal(payload.issue.title, "Add a search shortcut");
  assert.equal(payload.issue.description, "Type `/` to search.");
  assert.equal(payload.issue.status, "open");
  assert.equal(payload.issue.author, "alice-dev");
  assert.deepEqual(
    payload.issue.activities.map((activity) => activity.type),
    ["created"],
  );

  const list = await (await jsonRequest(app.baseUrl, ACME_DOCS)).json();
  const stored = list.issues.find((issue) => issue.number === 4);
  assert.equal(stored.title, "Add a search shortcut");
  assert.equal(stored.author, "alice-dev");

  // The record and its number survive a restart.
  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const reopened = await jsonRequest(restarted.baseUrl, `${ACME_DOCS}/4`);
  assert.equal(reopened.status, 200);
  const reopenedIssue = (await reopened.json()).issue;
  assert.equal(reopenedIssue.title, "Add a search shortcut");
  assert.equal(reopenedIssue.description, "Type `/` to search.");

  // The next creation continues the sequence of this repository only.
  const another = await jsonRequest(restarted.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: await signIn(restarted.baseUrl, "alice-dev"),
    body: { title: "Second follow-up", description: "" },
  });
  assert.equal((await another.json()).issue.number, 5);
});

test("editing writes one field of the target issue and records the edit", async (t) => {
  const dataDir = await newDataDir();
  const app = await startApp(dataDir);
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  const other = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();

  const renamed = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/title`, {
    method: "POST",
    cookie: alice,
    body: { title: "Renamed issue" },
  });
  assert.equal(renamed.status, 200);
  const renamedIssue = (await renamed.json()).issue;
  assert.equal(renamedIssue.title, "Renamed issue");
  assert.equal(renamedIssue.description, "This description is here for the editing workflow.");
  assert.deepEqual(renamedIssue.labels, []);
  assert.deepEqual(renamedIssue.assignees, []);
  assert.equal(
    renamedIssue.activities.at(-1).type,
    "title_changed",
  );
  assert.equal(renamedIssue.activities.at(-1).to, "Renamed issue");

  const described = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/description`, {
    method: "POST",
    cookie: alice,
    body: { description: "The description now explains the rename." },
  });
  assert.equal(described.status, 200);
  const describedIssue = (await described.json()).issue;
  assert.equal(describedIssue.title, "Renamed issue");
  assert.equal(describedIssue.description, "The description now explains the rename.");
  assert.equal(describedIssue.activities.at(-1).type, "description_changed");
  // The record keeps the editor, the time and the new value of the field.
  assert.equal(describedIssue.activities.at(-1).actor, "alice-dev");
  assert.equal(describedIssue.activities.at(-1).to, "The description now explains the rename.");

  // A blank or overlong replacement keeps the stored value of that field only.
  const blank = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/title`, {
    method: "POST",
    cookie: alice,
    body: { title: "   " },
  });
  assert.equal(blank.status, 400);
  assert.equal((await blank.json()).fields.title, "Title is required");
  const long = await jsonRequest(app.baseUrl, `${ACME_DOCS}/3/title`, {
    method: "POST",
    cookie: alice,
    body: { title: "a".repeat(257) },
  });
  assert.equal(long.status, 400);

  const unchanged = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/3`)).json();
  assert.equal(unchanged.issue.title, "Renamed issue");
  assert.equal(unchanged.issue.description, "The description now explains the rename.");

  // Neither the other issue nor the number of the target issue changed.
  const stillOther = await (await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`)).json();
  assert.deepEqual(stillOther.issue, other.issue);
  assert.equal(unchanged.issue.number, 3);

  // The edited values are the ones a later read returns.
  await app.close();
  const restarted = await startApp(dataDir);
  t.after(() => restarted.close());
  const reread = await (await jsonRequest(restarted.baseUrl, `${ACME_DOCS}/3`)).json();
  assert.equal(reread.issue.title, "Renamed issue");
  assert.equal(reread.issue.description, "The description now explains the rename.");
});

test("a read-only viewer may read an issue but may not edit it", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());

  const bob = await signIn(app.baseUrl, "bob-reviewer");
  const detail = await jsonRequest(app.baseUrl, `${INTERNAL}/1`, { cookie: bob });
  assert.equal(detail.status, 200);

  const refused = await jsonRequest(app.baseUrl, `${INTERNAL}/1/title`, {
    method: "POST",
    cookie: bob,
    body: { title: "Not allowed" },
  });
  assert.equal(refused.status, 403);
  // An anonymous visitor never learns that the private repository exists, so the
  // write is refused as an unknown address instead of as a missing session.
  const anonymous = await jsonRequest(app.baseUrl, `${INTERNAL}/1/description`, {
    method: "POST",
    body: { description: "Anonymous" },
  });
  assert.equal(anonymous.status, 404);

  const stored = await (await jsonRequest(app.baseUrl, `${INTERNAL}/1`, { cookie: bob })).json();
  assert.equal(stored.issue.title, "Internal review checklist");
});

test("each operation asks for its own role instead of a role-name ladder", async (t) => {
  const app = await startApp(await newDataDir());
  t.after(() => app.close());
  const alice = await signIn(app.baseUrl, "alice-dev");

  // A Triage collaborator only views the issue content: the explicit role list of
  // the content operations does not include it. The collaborator is registered
  // first and joins the organization, which makes her a subject that may receive
  // a repository role; the grant is then a new relationship, not a replacement.
  const { cookie: triageViewer, username: triageName } = await signInOutsider(app.baseUrl);
  const joined = await jsonRequest(app.baseUrl, "/api/organizations/acme-demo/members", {
    method: "POST",
    cookie: alice,
    body: { identifier: triageName, role: "member" },
  });
  assert.equal(joined.status, 201);
  const triageSubjectId = await accountIdOf(app.baseUrl, alice, triageName);
  const grantedTriage = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs/access", {
    method: "POST",
    cookie: alice,
    body: { subjectType: "account", subjectId: triageSubjectId, role: "triage" },
  });
  assert.equal(grantedTriage.status, 201);

  const triageEdit = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/title`, {
    method: "POST",
    cookie: triageViewer,
    body: { title: "Triage may not rename" },
  });
  assert.equal(triageEdit.status, 403);
  const triageCreate = await jsonRequest(app.baseUrl, ACME_DOCS, {
    method: "POST",
    cookie: triageViewer,
    body: { title: "Triage may not create", description: "" },
  });
  assert.equal(triageCreate.status, 403);
  const triageRead = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1`, { cookie: triageViewer });
  assert.equal(triageRead.status, 200);
  assert.equal((await triageRead.json()).issue.title, "Improve onboarding");

  // Saving the same subject again replaces the stored role, which then allows the
  // content operations of Write without granting anything else.
  const grantedWrite = await jsonRequest(app.baseUrl, "/api/repositories/alice-dev/acme-docs/access", {
    method: "POST",
    cookie: alice,
    body: { subjectType: "account", subjectId: triageSubjectId, role: "write" },
  });
  assert.equal(grantedWrite.status, 200);
  const writeEdit = await jsonRequest(app.baseUrl, `${ACME_DOCS}/1/title`, {
    method: "POST",
    cookie: triageViewer,
    body: { title: "Improve onboarding" },
  });
  assert.equal(writeEdit.status, 200);
  assert.equal((await writeEdit.json()).issue.title, "Improve onboarding");

  // The issue list of the repository keeps one row per stored issue for every
  // filter combination: no write operation added a second row.
  const list = await (await jsonRequest(app.baseUrl, ACME_DOCS)).json();
  assert.equal(list.issues.length, 3);
});
