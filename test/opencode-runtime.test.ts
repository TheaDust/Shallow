import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpencodeClient, type createOpencode } from "@opencode-ai/sdk";
import { SdkOpenCodeRuntime } from "../src/builder/opencode-sdk.js";

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
