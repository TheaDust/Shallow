import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRequestHandler } from "./app.mjs";
import { createAuthStore } from "./lib/auth-store.mjs";
import { createOrgStore } from "./lib/org-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(here, "../../frontend/dist");
const dataDir = process.env.SHALLOW_DATA_DIR
  ? resolve(process.env.SHALLOW_DATA_DIR)
  : resolve(here, "../.data");
const extraPorts = JSON.parse(await readFile(join(here, "platform-ports.json"), "utf8"));

const store = createAuthStore(dataDir);
// Upgrade an inherited auth store (missing preset accounts, sessions written by
// an earlier version) before the first request is served. The step is
// idempotent, so repeated startups change nothing.
await store.ensureSeeded();
const orgStore = createOrgStore(dataDir);
// Upgrade an inherited organization store (a file written by an earlier version
// that lacks this round's preset organizations, memberships, repositories or
// audit events) before the first request is served. Preset records are appended
// by their stable identity, stored records and user changes are kept, and the
// step is idempotent, so repeated startups change nothing.
await orgStore.ensureSeeded();
const handler = createRequestHandler({ store, orgStore, staticRoot });

const primaryPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(primaryPort) || primaryPort <= 0 || primaryPort > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const ports = [
  primaryPort,
  ...(process.env.ARC_EXTRA_PORTS === "0" ? [] : extraPorts),
].filter((port, index, all) => Number.isInteger(port) && port > 0 && port <= 65535 && all.indexOf(port) === index);

const servers = ports.map((port) => createServer((request, response) => {
  void handler(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`application listening on ${port}`);
}));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const server of servers) server.close();
  });
}
