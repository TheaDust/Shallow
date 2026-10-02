import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandler } from "../src/app.mjs";

async function listen(dataDir) {
  const handler = createHandler({ dataDir });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

export async function startApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "shallowcode-auth-"));
  let current = await listen(dataDir);

  return {
    dataDir,
    get baseUrl() {
      return current.baseUrl;
    },
    // Reopen the application on the same data directory to prove persistence.
    async restart() {
      await new Promise((resolve) => current.server.close(resolve));
      current = await listen(dataDir);
      return current.baseUrl;
    },
    async close() {
      await new Promise((resolve) => current.server.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export async function call(baseUrl, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return {
    status: response.status,
    body: parsed,
    text,
    setCookie: response.headers.get("set-cookie"),
  };
}
