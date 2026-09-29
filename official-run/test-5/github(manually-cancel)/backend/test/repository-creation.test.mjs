import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dataDirectory = await mkdtemp(join(tmpdir(), "shallowcode-repo-create-"));
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
  };
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function readStore(name) {
  const raw = await readFile(join(dataDirectory, name), "utf8").catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

const createBody = (overrides = {}) => ({
  ownerType: "account",
  ownerName: "alice-dev",
  name: `pw-repo-${uniqueSuffix()}`,
  description: "Repository created by Playwright",
  visibility: "private",
  initialize: true,
  ...overrides,
});

test("the REQ-3 seed data is provisioned: personal and organization repositories", async () => {
  const server = await startServer();
  try {
    const visitor = client(server.base);
    const personal = await visitor.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(personal.status, 200);
    assert.equal(personal.body.repository.fullName, "alice-dev/acme-docs");
    assert.equal(personal.body.repository.visibility, "public");
    assert.deepEqual(
      personal.body.repository.files.map((entry) => entry.name),
      ["README.md"],
    );
    assert.equal(personal.body.repository.commitCount, 1);

    const privateRepository = await visitor.request("/api/repositories/Acme%20Demo/secret-research");
    assert.equal(privateRepository.status, 401);

    const organizationRepositories = await visitor.request(
      "/api/organizations/Acme%20Demo/repositories",
    );
    assert.deepEqual(
      organizationRepositories.body.repositories.map((repository) => repository.name),
      ["acme-docs"],
    );
  } finally {
    await server.close();
  }
});

test("the creation form offers the personal namespace and the organizations the user owns", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();
    const owners = await owner.request("/api/repository-owners");
    assert.equal(owners.status, 200);
    assert.deepEqual(owners.body.owners, [
      { id: "acc-alice-dev", type: "account", name: "alice-dev", label: "alice-dev" },
      { id: "org-acme-demo", type: "organization", name: "Acme Demo", label: "Acme Demo" },
    ]);

    const member = client(server.base);
    await member.signIn("bob-reviewer", "Valid-password-123!");
    const memberOwners = await member.request("/api/repository-owners");
    assert.deepEqual(
      memberOwners.body.owners.map((owner) => owner.type),
      ["account"],
      "ordinary organization members have no organization creation namespace",
    );

    const visitor = client(server.base);
    assert.equal((await visitor.request("/api/repository-owners")).status, 401);
  } finally {
    await server.close();
  }
});

test("creating an initialized private repository stores content and lists it for the owner", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();
    const body = createBody();
    const created = await owner.request("/api/repositories", { method: "POST", body });
    assert.equal(created.status, 201);
    const repository = created.body.repository;
    assert.equal(repository.fullName, `alice-dev/${body.name}`);
    assert.equal(repository.ownerType, "account");
    assert.equal(repository.ownerName, "alice-dev");
    assert.equal(repository.visibility, "private");
    assert.equal(repository.defaultBranch, "main");
    assert.equal(repository.description, "Repository created by Playwright");
    assert.deepEqual(
      repository.files.map((entry) => [entry.name, entry.type]),
      [["README.md", "file"]],
    );
    assert.equal(repository.commitCount, 1);

    const detail = await owner.request(`/api/repositories/alice-dev/${body.name}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.repository.id, repository.id);
    assert.equal(detail.body.repositoryRole, "admin");

    const readme = await owner.request(
      `/api/repositories/alice-dev/${body.name}/file?branch=main&path=README.md`,
    );
    assert.equal(readme.status, 200);
    assert.equal(readme.body.file.name, "README.md");
    assert.match(readme.body.file.content, new RegExp(`# ${body.name}`));

    const commits = await owner.request(`/api/repositories/alice-dev/${body.name}/commits`);
    assert.equal(commits.status, 200);
    assert.equal(commits.body.commits.length, 1);
    assert.equal(commits.body.commits[0].message, "Initial commit");
    assert.equal(commits.body.commits[0].authorName, "alice-dev");

    const mine = await owner.request("/api/repositories?scope=mine");
    assert.deepEqual(
      mine.body.repositories.map((item) => item.name).sort(),
      ["acme-docs", body.name].sort(),
    );

    const stored = await readStore("repositories.json");
    const record = stored.repositories.find((item) => item.name === body.name);
    assert.equal(record.ownerType, "account");
    assert.equal(record.createdById, "acc-alice-dev");
    assert.equal(record.visibility, "private");
  } finally {
    await server.close();
  }
});

test("an initialized repository keeps its README and commit after a restart", async () => {
  const server = await startServer();
  let name;
  try {
    const owner = client(server.base);
    await owner.signIn();
    name = createBody().name;
    assert.equal((await owner.request("/api/repositories", { method: "POST", body: createBody({ name }) })).status, 201);
  } finally {
    await server.close();
  }

  const restarted = await startServer();
  try {
    const owner = client(restarted.base);
    await owner.signIn();
    const detail = await owner.request(`/api/repositories/alice-dev/${name}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.repository.visibility, "private");
    assert.deepEqual(detail.body.repository.files.map((entry) => entry.name), ["README.md"]);
    assert.equal(detail.body.repository.commitCount, 1);
    const commits = await owner.request(`/api/repositories/alice-dev/${name}/commits`);
    assert.equal(commits.body.commits.length, 1);
  } finally {
    await restarted.close();
  }
});

test("repository creation reports empty, duplicate and unknown-name rejections without side effects", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();

    const before = await readStore("repositories.json");

    const empty = await owner.request("/api/repositories", { method: "POST", body: createBody({ name: "   " }) });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.errors.name, "Repository name is required");

    const duplicate = await owner.request("/api/repositories", {
      method: "POST",
      body: createBody({ name: "acme-docs", visibility: "public", initialize: false }),
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.errors.name, "Repository name already exists");

    const after = await readStore("repositories.json");
    assert.equal(after.repositories.length, before.repositories.length);
    const personalAcmeDocs = await owner.request("/api/repositories/alice-dev/acme-docs");
    assert.equal(personalAcmeDocs.body.repository.createdAt, "2024-02-05T09:00:00.000Z");
  } finally {
    await server.close();
  }
});

test("a member without organization Owner status cannot create an organization repository", async () => {
  const server = await startServer();
  try {
    const member = client(server.base);
    await member.signIn("bob-reviewer", "Valid-password-123!");
    const rejected = await member.request("/api/repositories", {
      method: "POST",
      body: createBody({ ownerType: "organization", ownerName: "Acme Demo" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(
      rejected.body.errors.owner,
      "You do not have permission to create repositories for this owner",
    );

    const stored = await readStore("repositories.json");
    assert.equal(stored.repositories.filter((item) => item.ownerType === "organization").length, 3);
  } finally {
    await server.close();
  }
});

test("an organization Owner creates a repository in the organization namespace", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();
    const name = `pw-org-repo-${uniqueSuffix()}`;
    const created = await owner.request("/api/repositories", {
      method: "POST",
      body: {
        ownerType: "organization",
        ownerName: "Acme Demo",
        name,
        description: "",
        visibility: "public",
        initialize: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.repository.fullName, `Acme Demo/${name}`);
    assert.equal(created.body.repository.ownerType, "organization");

    const publicRepository = await client(server.base).request(
      `/api/repositories/Acme%20Demo/${name}`,
    );
    assert.equal(publicRepository.status, 200);
    assert.equal(publicRepository.body.repository.visibility, "public");

    const organizationList = await client(server.base).request(
      "/api/organizations/Acme%20Demo/repositories",
    );
    assert.ok(organizationList.body.repositories.some((repository) => repository.name === name));
  } finally {
    await server.close();
  }
});

test("a private personal repository is readable only by its owner", async () => {
  const server = await startServer();
  try {
    const owner = client(server.base);
    await owner.signIn();
    const name = createBody().name;
    await owner.request("/api/repositories", { method: "POST", body: createBody({ name }) });

    const visitor = client(server.base);
    assert.equal((await visitor.request(`/api/repositories/alice-dev/${name}`)).status, 401);
    assert.equal((await visitor.request(`/api/repositories/alice-dev/${name}/commits`)).status, 401);

    const other = client(server.base);
    await other.signIn("bob-reviewer", "Valid-password-123!");
    assert.equal((await other.request(`/api/repositories/alice-dev/${name}`)).status, 403);
    assert.equal((await other.request(`/api/repositories/alice-dev/${name}/file?path=README.md`)).status, 403);

    assert.equal((await owner.request(`/api/repositories/alice-dev/${name}`)).status, 200);
  } finally {
    await server.close();
  }
});

test("repository content paths answer the stored files and 404 for unknown ones", async () => {
  const server = await startServer();
  try {
    const visitor = client(server.base);
    const root = await visitor.request("/api/repositories/Acme%20Demo/acme-docs/contents");
    assert.equal(root.status, 200);
    assert.deepEqual(
      root.body.entries.map((entry) => [entry.name, entry.type]),
      [
        ["docs", "directory"],
        ["README.md", "file"],
      ],
    );

    const directory = await visitor.request(
      "/api/repositories/Acme%20Demo/acme-docs/contents?path=docs",
    );
    assert.deepEqual(
      directory.body.entries.map((entry) => entry.name),
      ["overview.md"],
    );

    const file = await visitor.request(
      "/api/repositories/Acme%20Demo/acme-docs/file?branch=main&path=docs/overview.md",
    );
    assert.equal(file.status, 200);
    assert.match(file.body.file.content, /# Overview/);

    assert.equal(
      (await visitor.request("/api/repositories/Acme%20Demo/acme-docs/contents?path=missing")).status,
      404,
    );
    assert.equal(
      (await visitor.request("/api/repositories/Acme%20Demo/acme-docs/file?path=missing.md")).status,
      404,
    );
    assert.equal(
      (await visitor.request("/api/repositories/Acme%20Demo/acme-docs/contents?branch=none")).status,
      404,
    );
  } finally {
    await server.close();
  }
});
