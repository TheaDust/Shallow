import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { OpenCodeSdkBuilder, SdkOpenCodeRuntime } from "../src/builder/opencode-sdk.js";
import { loadRequirementCatalog } from "../src/catalog.js";
import { selectNextPacket } from "../src/scheduler.js";
import { createArcPlatformContract } from "../src/runtime-config.js";
import type { BuilderRequest } from "../src/builder/port.js";
import { withTempDir } from "./helpers/temp-dir.js";

interface SentPrompt {
  sessionId: string;
  system: string;
  parts: Array<{ type: string; text?: string; url?: string }>;
}

test("Image rejection falls back in a clean session and later packets stay text-only", async () => {
  await withImageBuilder(async ({ builder, request, prompts, aborted }) => {
    const result = await builder.run(request);
    assert.equal(result.outcome, "completed");
    assert.equal(result.referenceImages?.mode, "text_fallback");
    assert.equal(result.sessionId, "session-2");
    assert.equal(prompts[0].parts.filter((part) => part.type === "file").length, 1);
    assert.deepEqual(aborted, ["session-1"]);
    assert.equal(prompts[1].sessionId, "session-2");
    assert.equal(prompts[1].parts.length, 1);
    assert.match(prompts[1].parts[0].text!, /图片输入不受支持/);
    assert.doesNotMatch(prompts[1].parts[0].text!, /已附加图片/);
    assert.equal(request.mode === "delivery_repair" ? 0 : request.packet.attempt, 1);
    assert.equal((await builder.run(request)).outcome, "completed");
    assert.equal(prompts.length, 3);
    assert.equal(prompts[2].parts.length, 1);
  }, (prompt) => prompt.parts.some((part) => part.type === "file")
    ? Response.json({ info: { error: { name: "APIError", data: { message: "This model does not support image input" } } }, parts: [] })
    : Response.json({ info: {}, parts: [{ type: "text", text: "done" }] }));
});

test("Ordinary gateway errors do not trigger an image fallback", async () => {
  for (const message of ["Invalid API key", "upstream unavailable", "Unsupported parameter: temperature (request included image_url)"]) {
    await withImageBuilder(async ({ builder, request, prompts }) => {
      const result = await builder.run(request);
      assert.equal(result.outcome, "failed");
      assert.equal(prompts.length, 1);
      assert.equal(result.referenceImages?.mode, "attached");
    }, () => Response.json({ error: { message } }, { status: 400 }));
  }
});

test("Server restart preserves text fallback after an image rejection", async () => {
  let calls = 0;
  await withImageBuilder(async ({ builder, request, prompts }) => {
    const result = await builder.run(request);
    assert.equal(result.outcome, "completed");
    assert.equal(result.referenceImages?.mode, "text_fallback");
    assert.equal(result.referenceImages?.attachedCount, 0);
    assert.equal(prompts.length, 3);
    assert.equal(prompts[0].parts.filter((part) => part.type === "file").length, 1);
    assert.equal(prompts[1].parts.length, 1);
    assert.deepEqual(prompts[2].parts, prompts[1].parts);
  }, (_prompt, exitServer) => {
    calls += 1;
    if (calls === 1) return Response.json({ error: { message: "image_url is not supported by this model" } }, { status: 400 });
    if (calls === 2) {
      exitServer();
      throw new TypeError("fetch failed");
    }
    return Response.json({ info: {}, parts: [{ type: "text", text: "done" }] });
  });
});

test("An HTTP image rejection falls back only once and text failure remains failure", async () => {
  await withImageBuilder(async ({ builder, request, prompts }) => {
    const result = await builder.run(request);
    assert.equal(result.outcome, "failed");
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1].parts.length, 1);
  }, () => Response.json({ error: { message: "image_url is not supported by this model" } }, { status: 400 }));
});

test("Image-related errors after a tool step do not bypass the Builder attempt limit", async () => {
  await withImageBuilder(async ({ builder, request, prompts }) => {
    assert.equal((await builder.run(request)).outcome, "failed");
    assert.equal(prompts.length, 1);
  }, () => Response.json({
    info: { error: { name: "APIError", data: { message: "This model does not support image input" } } },
    parts: [{ type: "tool", tool: "edit", state: { status: "completed" } }],
  }));
});

test("A late image rejection cannot start a fallback after the Builder timeout", async () => {
  await withImageBuilder(async ({ builder, request, prompts }) => {
    assert.equal((await builder.run(request)).outcome, "timed_out");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(prompts.length, 1);
  }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return Response.json({ info: { error: { data: { message: "This model does not support image input" } } }, parts: [] });
  }, 15);
});

test("The original Builder timeout also aborts a hanging text fallback", async () => {
  await withImageBuilder(async ({ builder, request, prompts, aborted }) => {
    const result = await builder.run(request);
    assert.equal(result.outcome, "timed_out");
    assert.equal(prompts.length, 2);
    assert.equal(result.sessionId, "session-2");
    assert.deepEqual(aborted, ["session-1", "session-2"]);
  }, (prompt) => prompt.parts.some((part) => part.type === "file")
    ? Response.json({ info: { error: { data: { message: "This model does not support image input" } } }, parts: [] })
    : new Promise<Response>(() => {}), 100);
});

async function withImageBuilder(
  callback: (context: {
    builder: OpenCodeSdkBuilder; request: BuilderRequest; prompts: SentPrompt[]; aborted: string[];
  }) => Promise<void>,
  respond: (prompt: SentPrompt, exitServer: () => void) => Response | Promise<Response>,
  timeoutMs = 1_000,
): Promise<void> {
  await withTempDir("shallow-image-input-", async (directory) => {
    const catalog = await loadRequirementCatalog(resolve("test/fixtures/requirements.yaml"));
    const packet = selectNextPacket(catalog)!;
    for (const requirement of packet.requirements) requirement.references = ["reference/ui.png"];
    await mkdir(join(directory, "reference"));
    await writeFile(join(directory, "reference/ui.png"), Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64",
    ));
    const prompts: SentPrompt[] = [];
    const aborted: string[] = [];
    let sessions = 0;
    const runtime = new SdkOpenCodeRuntime({ apiKey: "key", baseUrl: "https://gateway.example/v1", model: "model" }, async (options) => ({
      server: { url: "http://sdk.invalid", close() {} },
      client: createOpencodeClient({ baseUrl: "http://sdk.invalid", fetch: async (input) => {
        const request = input as Request;
        const path = new URL(request.url).pathname;
        if (path === "/session") return Response.json({ id: `session-${++sessions}` });
        if (path.endsWith("/abort")) {
          aborted.push(path.split("/")[2]);
          return Response.json(true);
        }
        const body = await request.json() as Omit<SentPrompt, "sessionId">;
        const prompt = { ...body, sessionId: path.split("/")[2] };
        prompts.push(prompt);
        return respond(prompt, () => options.onServerExit!({ code: null, signal: "SIGKILL" }));
      } }),
    }));
    const builder = new OpenCodeSdkBuilder(runtime, { timeoutMs, promptSettleTimeoutMs: 20, requirementsDir: directory });
    const request: BuilderRequest = {
      mode: "implement", packet,
      projectContext: { product: packet.requirements[0].product, ancestors: [], satisfiedDependencies: [] },
      outputDir: join(directory, "output"), platformContract: createArcPlatformContract(process.platform, 3210),
    };
    try { await callback({ builder, request, prompts, aborted }); }
    finally { await builder.close(); }
  });
}
