import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHandler, resolveDataDir } from "./app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const extraPorts = JSON.parse(await readFile(join(here, "platform-ports.json"), "utf8"));

const primaryPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(primaryPort) || primaryPort <= 0 || primaryPort > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const ports = [
  primaryPort,
  ...(process.env.ARC_EXTRA_PORTS === "0" ? [] : extraPorts),
].filter(
  (port, index, all) =>
    Number.isInteger(port) && port > 0 && port <= 65535 && all.indexOf(port) === index,
);

const handler = createHandler({ dataDir: resolveDataDir() });

// Every port gets its own server instance so the same application is reachable
// on the platform contract ports without re-listening on one instance.
const servers = ports.map((port) =>
  createServer((request, response) => {
    void handler(request, response);
  }).listen(port, "0.0.0.0", () => {
    console.log(`application listening on ${port}`);
  }),
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const server of servers) server.close();
  });
}
