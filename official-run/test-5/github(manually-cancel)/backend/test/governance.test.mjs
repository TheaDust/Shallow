import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-governance-"));
process.env.SHALLOW_DATA_DIR = dataDirectory;
process.env.ARC_EXTRA_PORTS = "0";

const { createRequestHandler } = await import("../src/app.mjs");
const { ensureSeedData } = await import("../src/lib/db.mjs");
await ensureSeedData();

async function startServer() {
  const server = createServer(createRequestHandler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function client(base) {
  let cookie = null;
  return {
    async request(path, { method = "GET", body } = {}) {
      const headers = {};
      if (body !== undefined) headers["content-type"] = "application/json";
      if (cookie) headers.cookie = cookie;
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const [pair] = setCookie.split(";");
        cookie = pair.endsWith("=") ? null : pair;
      }
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async signIn(identifier = "alice-dev", password = "Valid-password-123!") {
      return this.request("/api/auth/sign-in", { method: "POST", body: { identifier, password } });
    },
    async register(username) {
      return this.request("/api/auth/register", {
        method: "POST",
        body: {
          username,
          email: `${username}@example.test`,
          password: "Valid-password-123!",
          confirmPassword: "Valid-password-123!",
          agreeToTerms: true,
        },
      });
    },
  };
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readStore(name) {
  const raw = await readFile(join(dataDirectory, name), "utf8").catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

const ORG = "/api/organizations/Acme%20Demo";
const PRIVATE = "/api/repositories/Acme%20Demo/acme-internal";

test("an organization Owner adds an existing account as a Member with no invitation step", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const username = `new-member-${uniqueSuffix()}`;
    const newMember = client(server.base);
    assert.equal((await newMember.register(username)).status, 201);

    // Before the grant the account belongs to no organization at all.
    await newMember.signIn(username);
    const before = await newMember.request("/api/organizations?scope=mine");
    assert.deepEqual(before.body.organizations, []);

    const added = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: username, role: "member" },
    });
    assert.equal(added.status, 200);
    assert.deepEqual(
      added.body.members.filter((member) => member.username === username),
      [{ username, role: "member" }],
      "the member appears exactly once and with no pending state",
    );

    // The membership alone does not open a private repository.
    const denied = await newMember.request(PRIVATE);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "Access denied");

    // Another browser session reads the same relationship on its next request.
    const mine = await newMember.request("/api/organizations?scope=mine");
    assert.ok(mine.body.organizations.some((organization) => organization.name === "Acme Demo"));
    const overview = await newMember.request(ORG);
    assert.equal(overview.body.organization.name, "Acme Demo");

    const stored = await readStore("organization-members.json");
    assert.equal(
      stored.memberships.filter((membership) => membership.role === "member").length >= 1,
      true,
    );
  } finally {
    await server.close();
  }
});

test("member add rejects duplicates, unknown accounts and unsupported roles", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const duplicate = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: "bob-reviewer", role: "member" },
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.errors.identifier, "Account is already a member");

    const byEmail = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: "bob.reviewer@example.test", role: "owner" },
    });
    assert.equal(byEmail.status, 400);
    assert.equal(byEmail.body.errors.identifier, "Account is already a member");

    const unknown = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: "unknown-reviewer", role: "member" },
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.errors.identifier, "Account not found");

    const badRole = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: "bob-reviewer", role: "administrator" },
    });
    assert.equal(badRole.status, 400);
    assert.equal(badRole.body.errors.role, "Unsupported role");

    const people = await owner.request(`${ORG}/people`);
    assert.deepEqual(
      people.body.members.filter((member) => member.username === "bob-reviewer"),
      [{ username: "bob-reviewer", role: "member" }],
      "a rejected add creates no duplicate relationship",
    );
  } finally {
    await server.close();
  }
});

test("only an organization Owner may add or remove members", async () => {
  const server = await startServer();
  try {
    const member = client(server.base);
    await member.signIn("bob-reviewer", "Valid-password-123!");

    const add = await member.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: "alice-dev", role: "member" },
    });
    assert.equal(add.status, 403);

    const remove = await member.request(`${ORG}/people/alice-dev`, { method: "DELETE" });
    assert.equal(remove.status, 403);

    const people = await member.request(`${ORG}/people`);
    assert.ok(people.body.members.some((entry) => entry.username === "alice-dev"));
  } finally {
    await server.close();
  }
});

test("removing a member deletes the membership, team memberships and direct grants only", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const username = `removable-${uniqueSuffix()}`;
    const member = client(server.base);
    await member.register(username);
    const added = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: username, role: "member" },
    });
    assert.equal(added.status, 200);
    const access = await owner.request(`${PRIVATE}/access`);
    const subject = access.body.members.find((candidate) => candidate.name === username);
    assert.ok(subject, "the new member is a candidate subject");

    // A team membership, a direct grant and a team grant of another team.
    await owner.request(`${ORG}/teams/frontend-team/members`, {
      method: "POST",
      body: { username },
    });
    const direct = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "account", subjectId: subject.id, role: "write" },
    });
    assert.equal(direct.status, 200);
    const teamGrant = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-platform-team", role: "write" },
    });
    assert.equal(teamGrant.status, 200);

    await member.signIn(username);
    assert.equal((await member.request(PRIVATE)).status, 200);

    const removed = await owner.request(`${ORG}/people/${username}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(
      removed.body.members.filter((entry) => entry.username === username).length,
      0,
      "the username disappears from the People list",
    );

    assert.equal((await member.request(ORG + "/people")).status, 403);
    assert.equal((await member.request(PRIVATE)).status, 403, "direct access is revoked");

    const memberships = await readStore("organization-members.json");
    assert.equal(
      memberships.memberships.filter((membership) => membership.accountId === subject.id).length,
      0,
    );
    const teams = await readStore("teams.json");
    assert.deepEqual(
      teams.teams.find((team) => team.name === "frontend-team").memberIds.includes(subject.id),
      false,
      "team memberships of the account are deleted",
    );
    const grants = await readStore("repository-grants.json");
    assert.equal(
      grants.grants.filter(
        (grant) => grant.subjectType === "account" && grant.subjectId === subject.id,
      ).length,
      0,
      "direct grants of the removed account are deleted",
    );
    assert.ok(
      grants.grants.some(
        (grant) => grant.subjectType === "team" && grant.subjectId === "team-platform-team",
      ),
      "team grants themselves stay",
    );
    const accounts = await readStore("accounts.json");
    assert.ok(accounts.accounts.some((account) => account.username === username));
  } finally {
    await server.close();
  }
});

test("the last organization Owner cannot be removed", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const rejected = await owner.request(`${ORG}/people/alice-dev`, { method: "DELETE" });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "The organization must keep at least one Owner");

    const memberships = await readStore("organization-members.json");
    assert.equal(
      memberships.memberships.filter((membership) => membership.role === "owner").length,
      1,
      "the Owner relationship is unchanged",
    );
    const people = await owner.request(`${ORG}/people`);
    assert.ok(people.body.members.some((member) => member.username === "alice-dev"));
  } finally {
    await server.close();
  }
});

test("another Owner may be added, and the remaining Owner is the last one", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const username = `second-owner-${uniqueSuffix()}`;
    const second = client(server.base);
    await second.register(username);
    const added = await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: username, role: "owner" },
    });
    assert.equal(added.status, 200);
    assert.deepEqual(
      added.body.members.filter((member) => member.username === username),
      [{ username, role: "owner" }],
    );

    // With two Owners one of them is removable again.
    const removed = await owner.request(`${ORG}/people/${username}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const memberships = await readStore("organization-members.json");
    assert.deepEqual(
      memberships.memberships
        .filter((membership) => membership.role === "owner")
        .map((membership) => membership.accountId),
      ["acc-alice-dev"],
    );
  } finally {
    await server.close();
  }
});

test("repository grants are stored once per subject and replaced on change", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const created = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-frontend-team", role: "write" },
    });
    assert.equal(created.status, 200);
    const frontend = created.body.grants.filter((grant) => grant.subjectName === "frontend-team");
    assert.equal(frontend.length, 1);
    assert.equal(frontend[0].role, "write");
    assert.ok(created.body.teams.some((team) => team.name === "frontend-team"));
    assert.ok(created.body.members.some((member) => member.name === "bob-reviewer"));
    assert.equal(created.body.viewerRole, "admin");

    const repeated = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-frontend-team", role: "write" },
    });
    assert.equal(
      repeated.body.grants.filter((grant) => grant.subjectName === "frontend-team").length,
      1,
      "saving the same role again creates no second record",
    );

    const replaced = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-frontend-team", role: "read" },
    });
    assert.deepEqual(
      replaced.body.grants
        .filter((grant) => grant.subjectName === "frontend-team")
        .map((grant) => grant.role),
      ["read"],
    );

    const reloaded = await owner.request(`${PRIVATE}/access`);
    assert.deepEqual(
      reloaded.body.grants
        .filter((grant) => grant.subjectName === "frontend-team")
        .map((grant) => grant.role),
      ["read"],
      "the replaced role is what the page reads after reload",
    );

    const unsupported = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-frontend-team", role: "superuser" },
    });
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.body.errors.role, "Unsupported role");

    const outside = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "account", subjectId: "acc-does-not-exist", role: "write" },
    });
    assert.equal(outside.status, 400);
    assert.equal(outside.body.errors.subject, "Account not found");

    const foreignTeam = await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-missing", role: "write" },
    });
    assert.equal(foreignTeam.status, 400);
    assert.equal(foreignTeam.body.errors.subject, "Team not found");
  } finally {
    await server.close();
  }
});

test("repository access follows direct grants, team grants and Owner status only", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const member = client(server.base);
    await member.signIn("bob-reviewer", "Valid-password-123!");
    assert.equal((await member.request(PRIVATE)).status, 403);
    assert.equal((await member.request(`${PRIVATE}/access`)).status, 403);

    // A direct grant below Admin lets the member read, but not manage.
    await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "account", subjectId: "acc-bob-reviewer", role: "write" },
    });
    assert.equal((await member.request(PRIVATE)).status, 200);
    const memberView = await member.request(`${PRIVATE}/access`);
    assert.equal(memberView.status, 200);
    assert.equal(memberView.body.viewerRole, "write");
    const forbidden = await member.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "account", subjectId: "acc-bob-reviewer", role: "admin" },
    });
    assert.equal(forbidden.status, 403, "Write is not an access manager");

    // A team grant only helps direct members of that team.
    const otherName = `team-member-${uniqueSuffix()}`;
    const other = client(server.base);
    await other.register(otherName);
    await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: otherName, role: "member" },
    });
    await other.signIn(otherName);
    assert.equal((await other.request(PRIVATE)).status, 403);
    await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-platform-team", role: "read" },
    });
    assert.equal((await other.request(PRIVATE)).status, 403, "no team membership, no access");
    await owner.request(`${ORG}/teams/platform-team/members`, {
      method: "POST",
      body: { username: otherName },
    });
    assert.equal((await other.request(PRIVATE)).status, 200);

    // Team hierarchy does not propagate membership or authorization: the parent
    // team holds no grant and its own grants (if any) never reach a sub-team.
    const childName = `child-member-${uniqueSuffix()}`;
    const child = client(server.base);
    await child.register(childName);
    await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: childName, role: "member" },
    });
    const addedChild = await owner.request(`${ORG}/teams/frontend-child/members`, {
      method: "POST",
      body: { username: childName },
    });
    assert.equal(addedChild.status, 200);
    await child.signIn(childName);
    assert.equal((await child.request(PRIVATE)).status, 403);

    // An Admin-level direct grant may manage access, and the Owner always may.
    await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "account", subjectId: "acc-bob-reviewer", role: "admin" },
    });
    const managed = await member.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "account", subjectId: "acc-bob-reviewer", role: "read" },
    });
    assert.equal(managed.status, 200);
    assert.equal(managed.body.viewerRole, "read");
  } finally {
    await server.close();
  }
});

test("memberships and grants survive a restart of the application", async () => {
  const server = await startServer();
  const username = `restart-member-${uniqueSuffix()}`;
  try {
    const owner = client(server.base);
    await owner.signIn();
    const registered = client(server.base);
    await registered.register(username);
    await owner.request(`${ORG}/people`, {
      method: "POST",
      body: { identifier: username, role: "member" },
    });
    await owner.request(`${PRIVATE}/access`, {
      method: "POST",
      body: { subjectType: "team", subjectId: "team-frontend-team", role: "write" },
    });
  } finally {
    await server.close();
  }

  const restarted = await startServer();
  try {
    const owner = client(restarted.base);
    await owner.signIn();
    const people = await owner.request(`${ORG}/people`);
    assert.ok(people.body.members.some((member) => member.username === username));
    const access = await owner.request(`${PRIVATE}/access`);
    assert.deepEqual(
      access.body.grants
        .filter((grant) => grant.subjectName === "frontend-team")
        .map((grant) => grant.role),
      ["write"],
    );
  } finally {
    await restarted.close();
  }
});
