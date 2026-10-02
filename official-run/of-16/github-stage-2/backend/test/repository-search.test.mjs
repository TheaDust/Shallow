import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApp } from "../src/app.mjs";
import { createStateStore } from "../src/lib/state.mjs";

const ORG_OWNER = { username: "org-owner", password: "Valid-password-123!" };
const ORG_MEMBER = { username: "org-member", password: "Valid-password-123!" };
const OUTSIDER = { username: "alice-dev", password: "Valid-password-123!" };
const REPO_OWNER = { username: "repo-owner", password: "Valid-password-123!" };

async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-search-"));
  const store = createStateStore({ dataDir });
  const app = createApp({ store });
  const server = createServer((request, response) => {
    void app(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function search(baseUrl, query, cookie) {
  const params = new URLSearchParams({ q: query });
  const headers = cookie ? { cookie } : {};
  const response = await fetch(`${baseUrl}/api/search/repositories?${params.toString()}`, { headers });
  const body = await response.json();
  return { status: response.status, body };
}

async function signIn(baseUrl, account) {
  const response = await fetch(`${baseUrl}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: account.username, password: account.password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie")?.split(";")[0] ?? "";
}

function labels(body) {
  return body.repositories.map((entry) => `${entry.owner.name}/${entry.name}`);
}

test("REQ-3-1 a visitor searches the public repository and never the private one", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  const publicMatch = await search(app.baseUrl, "acme-docs");
  assert.equal(publicMatch.status, 200);
  assert.equal(publicMatch.body.query, "acme-docs");
  assert.deepEqual(labels(publicMatch.body), ["Acme Demo/acme-docs"]);
  const [result] = publicMatch.body.repositories;
  // The result carries the metadata needed to open the repository.
  assert.equal(result.name, "acme-docs");
  assert.deepEqual(result.owner, { kind: "organization", name: "Acme Demo", slug: "acme-demo" });
  assert.equal(result.visibility, "public");

  // A private organization repository is invisible to a visitor without a
  // session, even when its exact name is searched.
  const privateMatch = await search(app.baseUrl, "secret-research");
  assert.deepEqual(privateMatch.body.repositories, []);

  // An unmatched query returns an empty result instead of an error.
  const missing = await search(app.baseUrl, "no-such-repository");
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body.repositories, []);

  const blank = await search(app.baseUrl, "   ");
  assert.deepEqual(blank.body.repositories, []);
});

test("REQ-3-1 search results follow the same read rule as direct links", async (t) => {
  const app = await startApp();
  t.after(() => app.close());

  // A plain organization member gains nothing from membership alone.
  const member = await signIn(app.baseUrl, ORG_MEMBER);
  const memberSearch = await search(app.baseUrl, "secret-research", member);
  assert.deepEqual(memberSearch.body.repositories, []);

  const outsider = await signIn(app.baseUrl, OUTSIDER);
  const outsiderSearch = await search(app.baseUrl, "secret-research", outsider);
  assert.deepEqual(outsiderSearch.body.repositories, []);

  // An organization Owner may read the private repository, so it is findable.
  const owner = await signIn(app.baseUrl, ORG_OWNER);
  const ownerSearch = await search(app.baseUrl, "secret-research", owner);
  assert.deepEqual(labels(ownerSearch.body), ["Acme Demo/secret-research"]);
  assert.equal(ownerSearch.body.repositories[0].visibility, "private");

  // The private personal repository of another account stays hidden ...
  const hiddenPersonal = await search(app.baseUrl, "acme-docs", owner);
  assert.deepEqual(labels(hiddenPersonal.body), ["Acme Demo/acme-docs"]);

  // ... while its owner finds both the public and the own private repository
  // under the same name, distinguished by their owner metadata.
  const personalOwner = await signIn(app.baseUrl, REPO_OWNER);
  const ownSearch = await search(app.baseUrl, "acme-docs", personalOwner);
  assert.deepEqual(labels(ownSearch.body), ["Acme Demo/acme-docs", "repo-owner/acme-docs"]);
});
