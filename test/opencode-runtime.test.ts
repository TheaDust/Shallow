import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { createOpencodeClient, type createOpencode } from "@opencode-ai/sdk";
import { OPENCODE_MEMORY_ENV, readOpencodeLogTail, sdkFetch, SdkOpenCodeRuntime, type OpenCodeServerExit } from "../src/builder/opencode-sdk.js";
import { ExecutionFault } from "../src/execution-fault.js";
import { withTempDir } from "./helpers/temp-dir.js";

for (const outcome of ["completed", "model-error", "connect-error", "disconnect-error"] as const) {
  test(`SDK scopes the Builder browser to one prompt: ${outcome}`, async () => {
    let configured: Parameters<typeof createOpencode>[0];
    const calls: string[] = [];
    const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => {
      configured = options;
      return { server: { url: "http://localhost:1", close() {} }, client: createOpencodeClient({ baseUrl: "http://localhost:1",
        fetch: async (input) => {
          const path = new URL((input as Request).url).pathname;
          calls.push(path);
          if (path.endsWith("/connect")) return Response.json(true);
          if (path.endsWith("/disconnect")) return Response.json(outcome !== "disconnect-error");
          if (path === "/mcp") return Response.json({ playwright: { status: outcome === "connect-error" ? "failed" : "connected" } });
          return Response.json({ info: outcome === "model-error" ? { error: { name: "APIError", data: { message: "gateway unavailable" } } } : {},
            parts: [{ type: "text", text: "done" }] });
        },
      }) };
    }, { baseUrl: "http://127.0.0.1:45678", artifactsDir: "artifacts" });
    await runtime.start("candidate");
    try {
      assert.equal(configured?.config?.mcp?.playwright.enabled, false);
      const prompt = runtime.prompt("session", { systemPrompt: "system", taskPrompt: "task" });
      if (outcome === "completed" || outcome === "disconnect-error") assert.equal(await prompt, "done");
      else if (outcome === "model-error") await assert.rejects(prompt, /gateway unavailable/);
      else await assert.rejects(prompt, ExecutionFault);
      assert.deepEqual(calls.slice(0, 2), ["/mcp/playwright/connect", "/mcp"]);
      assert.equal(calls.at(-1), "/mcp/playwright/disconnect");
      assert.equal(calls.some((path) => path.startsWith("/session/")), outcome !== "connect-error");
    } finally {
      await runtime.close();
    }
  });
}

test("SDK cannot dispatch a model request after cancellation during browser connection", async () => {
  let connect!: () => void;
  const connected = new Promise<void>((resolve) => { connect = resolve; });
  const paths: string[] = [];
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async () => ({
    server: { url: "http://localhost:1", close() {} }, client: createOpencodeClient({ baseUrl: "http://localhost:1", fetch: async (input) => {
      const path = new URL((input as Request).url).pathname;
      paths.push(path);
      if (path.endsWith("/connect")) await connected;
      return Response.json(path === "/mcp" ? { playwright: { status: "connected" } } : true);
    } }),
  }), { baseUrl: "http://127.0.0.1:45678", artifactsDir: "artifacts" });
  await runtime.start("candidate");
  const prompt = runtime.prompt("session", { systemPrompt: "system", taskPrompt: "task" });
  await runtime.abort("session");
  connect();
  await assert.rejects(prompt, /cancelled before dispatch/);
  assert.equal(paths.some((path) => path.endsWith("/message")), false);
  await runtime.close();
});

test("Baseline runtime can reuse its session after an aborted call", async () => {
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async () => ({
    server: { url: "http://localhost:1", close() {} }, client: createOpencodeClient({ baseUrl: "http://localhost:1", fetch: async (input) =>
      Response.json(new URL((input as Request).url).pathname.endsWith("/abort")
        ? true : { info: {}, parts: [{ type: "text", text: "next module done" }] }),
    }),
  }));
  await runtime.start("candidate");
  try {
    await runtime.abort("baseline-session");
    assert.equal(await runtime.prompt("baseline-session", { systemPrompt: "system", taskPrompt: "next module" }), "next module done");
  } finally { await runtime.close(); }
});

test("SDK runtime does not use the Node global fetch that enforces the 300s headers timeout", async () => {
  let options: (Parameters<typeof createOpencode>[0] & { fetch?: typeof fetch }) | undefined;
  const runtime = new SdkOpenCodeRuntime(
    { apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" },
    async (input) => {
      options = input;
      return {
        server: { url: "http://127.0.0.1:1", close() {} },
        client: createOpencodeClient({ baseUrl: "http://127.0.0.1:1" }),
      };
    },
  );
  await runtime.start("candidate");
  await runtime.close();

  assert.equal(typeof options?.fetch, "function");
  assert.notEqual(options?.fetch, globalThis.fetch);
  assert.equal(options?.config?.mcp, undefined, "shared runtime stays unchanged unless self-test is explicitly enabled");
});

test("SDK runtime reports an unexpected server exit and clears it on restart", async () => {
  let exit!: (info: OpenCodeServerExit) => void;
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => {
    exit = options.onServerExit!;
    return { server: { url: "http://localhost:1", close() {} }, client: createOpencodeClient({ baseUrl: "http://localhost:1" }) };
  });
  await runtime.start("candidate");
  assert.equal(runtime.serverExit(), undefined);
  exit({ code: null, signal: "SIGKILL" });
  assert.deepEqual(runtime.serverExit(), { code: null, signal: "SIGKILL" });
  await runtime.close();
  await runtime.start("candidate");
  assert.equal(runtime.serverExit(), undefined);
  await runtime.close();
});

test("sdkFetch adapts the SDK's Node Request objects", async () => {
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      bodies.push(raw);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "ses_probe", title: "probe" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = createOpencodeClient({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    fetch: sdkFetch,
  });
  try {
    const response = await client.session.create({ body: { title: "probe" } });
    assert.equal(response.error, undefined);
    assert.equal(response.data?.id, "ses_probe");
    assert.deepEqual(
      bodies.map((body) => JSON.parse(body) as unknown),
      [{ title: "probe" }],
    );
  } finally {
    server.close();
  }
});

test("sdkFetch completes a request whose response headers arrive late", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, 600);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await sdkFetch(`${url}/slow`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    server.close();
  }
});

test("SDK runtime forwards the gateway and preserves raw model IDs in all model calls", async () => {
  for (const model of ["small-model", "vendor/model-v1"]) {
    let options: Parameters<typeof createOpencode>[0];
    let sent: Record<string, unknown> | undefined;
    const runtime = new SdkOpenCodeRuntime({
      apiKey: "gateway-test-secret", baseUrl: "https://gateway.example/v1", model,
    }, async (input) => {
      options = input;
      return {
        server: { url: "http://127.0.0.1:1", close() {} },
        client: createOpencodeClient({
          baseUrl: "http://127.0.0.1:1",
          fetch: async (request) => {
            sent = await (request as Request).json();
            return Response.json({ info: {}, parts: [{ type: "text", text: "done" }] });
          },
        }),
      };
    });
    await runtime.start("candidate");
    assert.equal(await runtime.prompt("session", { systemPrompt: "system", taskPrompt: "task" }), "done");
    await runtime.close();

    assert.ok(options?.port && options.port > 0);
    assert.equal(options.config?.model, `shallow-gateway/${model}`);
    assert.equal(options.config?.small_model, `shallow-gateway/${model}`);
    assert.deepEqual(options.config?.enabled_providers, ["shallow-gateway"]);
    const provider = options.config?.provider?.["shallow-gateway"];
    assert.equal(provider?.options?.apiKey, "gateway-test-secret");
    assert.equal(provider?.options?.baseURL, "https://gateway.example/v1");
    assert.equal(provider?.models?.[model].id, model);
    assert.deepEqual(sent?.model, { providerID: "shallow-gateway", modelID: model });
    assert.equal(sent?.system, "system");
    assert.doesNotMatch(JSON.stringify(sent), /gateway-test-secret/);
  }
});

test("SDK runtime trims unused OpenCode subsystems to reduce memory overhead", async () => {
  let config: Parameters<typeof createOpencode>[0];
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => {
    config = options;
    return { server: { url: "http://127.0.0.1:1", close() {} }, client: createOpencodeClient({ baseUrl: "http://127.0.0.1:1" }) };
  });
  await runtime.start("candidate");
  await runtime.close();

  assert.equal(config?.config?.snapshot, false);
  assert.equal(config?.config?.autoupdate, false);
  assert.equal(config?.config?.share, "disabled");
  assert.equal(config?.config?.formatter, false);
  assert.equal(config?.config?.lsp, false);
  assert.deepEqual(config?.config?.watcher, { ignore: ["node_modules/**", "dist/**", ".git/**", ".arc/**"] });
  assert.deepEqual({ ...OPENCODE_MEMORY_ENV }, {
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_EMBEDDED_WEB_UI: "1",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  });
});

test("SDK runtime does not report an exit that follows the controller's own close", async () => {
  let exit!: (info: OpenCodeServerExit) => void;
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => {
    exit = options.onServerExit!;
    return {
      server: { url: "http://localhost:1", close() { exit({ code: 0, signal: null }); } },
      client: createOpencodeClient({ baseUrl: "http://localhost:1" }),
    };
  });
  await runtime.start("candidate");
  await runtime.close();

  assert.equal(runtime.serverExit(), undefined, "an intentional shutdown is not an environment kill");
});

test("SDK runtime disconnects the Builder MCPs only once per server instance", async () => {
  let disconnects = 0;
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async () => ({
    server: { url: "http://localhost:1", close() {} },
    client: createOpencodeClient({ baseUrl: "http://localhost:1", fetch: async (input) => {
      const path = new URL((input as Request).url).pathname;
      if (path.endsWith("/disconnect")) { disconnects += 1; return Response.json(true); }
      if (path.endsWith("/connect")) return Response.json(true);
      if (path === "/mcp") return Response.json({ playwright: { status: "connected" } });
      return Response.json({ info: {}, parts: [{ type: "text", text: "done" }] });
    } }),
  }), { baseUrl: "http://127.0.0.1:45678", artifactsDir: "artifacts" });
  await runtime.start("candidate");
  await runtime.prompt("session", { systemPrompt: "system", taskPrompt: "task" });
  await runtime.close();

  assert.equal(disconnects, 1);
});

test("SDK runtime denies Builder tool access to .arc and external paths", async () => {
  const arcPathDenies = {
    "**/.arc/**": "deny",
    ".arc/**": "deny",
    "**\\.arc\\**": "deny",
    ".arc\\**": "deny",
  };
  let config: Parameters<typeof createOpencode>[0];
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => {
    config = options;
    return { server: { url: "http://127.0.0.1:1", close() {} }, client: createOpencodeClient({ baseUrl: "http://127.0.0.1:1" }) };
  });
  await runtime.start("candidate");
  await runtime.close();

  const permission = config?.config?.permission as Record<string, unknown> | undefined;
  assert.deepEqual(permission?.read, arcPathDenies);
  assert.deepEqual(permission?.edit, arcPathDenies);
  assert.deepEqual(permission?.bash, { "*.arc*": "deny" });
  assert.equal(permission?.external_directory, "deny");
});

test("SDK runtime treats an assistant error in an HTTP success response as failure", async () => {
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async () => ({
    server: { url: "http://127.0.0.1:1", close() {} },
    client: createOpencodeClient({
      baseUrl: "http://127.0.0.1:1",
      fetch: async () => Response.json({ info: { error: { name: "APIError", data: { message: "upstream unavailable" } } }, parts: [] }),
    }),
  }));
  await runtime.start("candidate");
  await assert.rejects(runtime.prompt("session", { systemPrompt: "system", taskPrompt: "task" }), /upstream unavailable/);
  await runtime.close();
});

test("SDK runtime submits reference images as file parts with image-capable provider metadata", async () => {
  let sent: Record<string, unknown> | undefined;
  let config: Parameters<typeof createOpencode>[0];
  const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => {
    config = options;
    return {
      server: { url: "http://127.0.0.1:1", close() {} },
      client: createOpencodeClient({ baseUrl: "http://127.0.0.1:1", fetch: async (request) => {
        sent = await (request as Request).json();
        return Response.json({ info: {}, parts: [{ type: "text", text: "done" }] });
      } }),
    };
  });
  await runtime.start("candidate");
  await runtime.prompt("session", { systemPrompt: "system", taskPrompt: "task", images: [
    { reference: "reference/ui.png", mime: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" },
  ] });
  await runtime.close();
  assert.deepEqual(sent?.parts, [
    { type: "text", text: "task" },
    { type: "file", mime: "image/png", filename: "reference/ui.png", url: "data:image/png;base64,aW1hZ2U=" },
  ]);
  assert.deepEqual(config?.config?.provider?.["shallow-gateway"].models?.model.modalities?.input, ["text", "image"]);
});

test("OpenCode log tail surfaces the newest server errors for diagnostics", async () => {
  await withTempDir("shallow-opencode-", async (directory) => {
    const logDir = join(directory, "opencode", "log");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, "old.log"), "level=ERROR message=old failure\n", "utf8");
    await writeFile(join(logDir, "new.log"), "level=INFO message=started\nlevel=ERROR message=backend crashed\n", "utf8");
    const past = new Date(Date.now() - 60_000);
    await utimes(join(logDir, "old.log"), past, past);

    assert.equal(await readOpencodeLogTail(directory), "level=ERROR message=backend crashed");
    assert.equal(await readOpencodeLogTail(join(directory, "missing")), undefined);
  });
});
