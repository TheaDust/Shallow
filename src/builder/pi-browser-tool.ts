import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Type } from "typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

const SCRIPT_TIMEOUT_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const MAX_CONSOLE_ERRORS = 20;
const MAX_PAGE_TEXT = 3_000;
const MAX_RESULT_TEXT = 2_000;

// One lazy Chromium per worker call; each tool call gets an isolated context.
// The worker's owned process tree is killed after the call regardless, so a
// leaked browser cannot outlive the Builder turn.
let sharedBrowser: Browser | undefined;

async function sharedBrowserInstance(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

/** Best-effort cleanup when the worker finishes normally. */
export async function closeSharedBrowser(): Promise<void> {
  const current = sharedBrowser;
  sharedBrowser = undefined;
  await current?.close().catch(() => undefined);
}

const parameters = Type.Object({
  url: Type.String({ description: "URL of the locally started application page to open first" }),
  code: Type.String({ description: "Async JavaScript function body executed with (page, context) after the URL opens; may return a JSON-serializable observation" }),
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (page: Page, context: BrowserContext) => Promise<unknown>;

export function createBrowserTool(): ToolDefinition<typeof parameters> {
  return {
    name: "browser",
    label: "Browser (expensive)",
    description:
      "EXPENSIVE: drive a real Chromium page (Playwright) against a locally running app. " +
      "Use only when builds, type checks and traditional tests cannot answer a real-browser behavior question; " +
      "keep it to the one or two most critical flows per task. Start the app per the platform contract first and wait for its health check.",
    promptSnippet: "browser: expensive real-browser check against the locally started app; use sparingly",
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const instance = await sharedBrowserInstance();
      const context = await instance.newContext();
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", message => {
        if (message.type() === "error" && consoleErrors.length < MAX_CONSOLE_ERRORS) consoleErrors.push(message.text());
      });
      page.on("pageerror", error => {
        if (consoleErrors.length < MAX_CONSOLE_ERRORS) consoleErrors.push(String(error));
      });
      try {
        signal?.throwIfAborted();
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
        const run = new AsyncFunction("page", "context", params.code);
        const script = run(page, context);
        // The race below reports a rejection; this handler only avoids an
        // unhandled rejection when the timeout or abort wins first.
        void script.catch(() => undefined);
        const timedOut = delay(SCRIPT_TIMEOUT_MS).then(() => {
          throw new Error(`browser script exceeded ${SCRIPT_TIMEOUT_MS / 1_000}s`);
        });
        const aborted = new Promise<never>((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("browser tool aborted")), { once: true }));
        const value = await Promise.race([script, timedOut, aborted]);
        signal?.throwIfAborted();
        const pageText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        const title = await page.title().catch(() => "");
        const payload = {
          url: page.url(),
          title,
          consoleErrors,
          result: serialize(value),
          pageText: pageText.slice(0, MAX_PAGE_TEXT),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 1) }],
          details: { url: payload.url, title, consoleErrorCount: consoleErrors.length },
        };
      } finally {
        await context.close().catch(() => undefined);
      }
    },
  };
}

function serialize(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value)?.slice(0, MAX_RESULT_TEXT) ?? null;
  } catch {
    return String(value).slice(0, MAX_RESULT_TEXT);
  }
}
