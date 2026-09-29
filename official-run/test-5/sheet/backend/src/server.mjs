import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createJsonStore } from "./lib/json-store.mjs";
import { createSeedState } from "./domain/workbooks.mjs";
import { createRequestHandler } from "./app.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.SHALLOW_DATA_DIR
  ? resolve(process.env.SHALLOW_DATA_DIR)
  : resolve(here, "../.data");

const store = createJsonStore(join(dataDirectory, "workbook-store.json"), createSeedState());
const handler = createRequestHandler({ store });
const extraPorts = JSON.parse(await readFile(join(here, "platform-ports.json"), "utf8"));

const primaryPort = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(primaryPort) || primaryPort <= 0 || primaryPort > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
const ports = [
  primaryPort,
  ...(process.env.ARC_EXTRA_PORTS === "0" ? [] : extraPorts),
].filter((port, index, all) => Number.isInteger(port) && port > 0 && port <= 65535 && all.indexOf(port) === index);

const servers = ports.map((port) => {
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  // A busy extra port must never take the whole application down.
  server.on("error", (error) => {
    console.error(`listening on ${port} failed: ${error.message}`);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`application listening on ${port}`);
  });
  return server;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const server of servers) server.close();
  });
}
