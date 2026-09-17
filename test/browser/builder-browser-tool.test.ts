import assert from "node:assert/strict";
import { test } from "node:test";

import { closeSharedBrowser, createBrowserTool } from "../../src/builder/pi-browser-tool.js";

test("browser tool opens a page, runs the script, and captures console errors", { timeout: 90_000 }, async () => {
  const tool = createBrowserTool();
  try {
    const result = await tool.execute(
      "call-1",
      {
        url: "data:text/html,<title>probe-page</title><body><h1>Hello browser</h1><script>console.error('boom')</script></body>",
        code: "return await page.title();",
      },
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    const payload = JSON.parse(text) as { title: string; consoleErrors: string[]; result: string; pageText: string };
    assert.equal(payload.title, "probe-page");
    assert.equal(payload.result, '"probe-page"');
    assert.ok(payload.pageText.includes("Hello browser"));
    assert.ok(payload.consoleErrors.some(error => error.includes("boom")));
    assert.equal((result.details as { consoleErrorCount: number }).consoleErrorCount, 1);
  } finally {
    await closeSharedBrowser();
  }
});

test("browser tool surfaces script failures", { timeout: 90_000 }, async () => {
  const tool = createBrowserTool();
  try {
    await assert.rejects(
      tool.execute("call-2", { url: "about:blank", code: "throw new Error('script boom');" }, undefined, undefined, {} as never),
      /script boom/,
    );
  } finally {
    await closeSharedBrowser();
  }
});
