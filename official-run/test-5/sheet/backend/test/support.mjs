import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJsonStore } from "../src/lib/json-store.mjs";
import { createSeedState } from "../src/domain/workbooks.mjs";
import { createRequestHandler } from "../src/app.mjs";

/** Boots the real request handler on an ephemeral port with an isolated store. */
export async function startApp() {
  const directory = await mkdtemp(join(tmpdir(), "shallow-workbooks-"));
  const storePath = join(directory, "store.json");
  const store = createJsonStore(storePath, createSeedState());
  const server = createServer(createRequestHandler({ store }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    storePath,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function request(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export async function requestRaw(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    disposition: response.headers.get("content-disposition"),
    text: await response.text(),
  };
}
