import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import type { ProbeCase, ProbeLocator, ProbePlan, ProbeStep } from "./probe-schema.js";
import type { ProbeFailure, ShadowReport } from "../types.js";

export interface ProbeRunOptions {
  baseUrl: string;
  stepTimeoutMs: number;
  caseTimeoutMs: number;
}

interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

class ProbeExecutionError extends Error {
  constructor(
    readonly category: ProbeFailure["category"],
    message: string,
    readonly locatorSnapshot?: string,
  ) {
    super(message);
    this.name = "ProbeExecutionError";
  }
}

export class PlaywrightProbeRunner {
  async run(plan: ProbePlan, options: ProbeRunOptions): Promise<ShadowReport> {
    let browser: Browser | undefined;
    const passedCases: string[] = [];
    const failures: ProbeFailure[] = [];

    try {
      browser = await chromium.launch({ headless: true });
      for (const probeCase of plan.cases) {
        const failure = await this.runCase(browser, probeCase, options);
        if (failure) failures.push(failure);
        else passedCases.push(probeCase.id);
      }
    } catch (error) {
      failures.push({
        caseId: "<runner>",
        stepIndex: -1,
        category: "runner",
        message: compactError(error),
      });
    } finally {
      await browser?.close().catch(() => undefined);
    }

    return {
      packetId: plan.packetId,
      verdict:
        failures.length === 0
          ? "pass"
          : failures.every((failure) => failure.category === "locator")
            ? "inconclusive"
            : "fail",
      passedCases,
      failures,
    };
  }

  private async runCase(
    browser: Browser,
    probeCase: ProbeCase,
    options: ProbeRunOptions,
  ): Promise<ProbeFailure | undefined> {
    let session = await createSession(browser);
    const deadline = Date.now() + options.caseTimeoutMs;
    try {
      for (let stepIndex = 0; stepIndex < probeCase.steps.length; stepIndex += 1) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          return {
            caseId: probeCase.id,
            stepIndex,
            category: "timeout",
            message: `Case exceeded ${options.caseTimeoutMs}ms`,
          };
        }
        const timeoutMs = Math.min(options.stepTimeoutMs, remainingMs);
        try {
          session = await executeStep(
            browser,
            session,
            probeCase.steps[stepIndex],
            options.baseUrl,
            timeoutMs,
          );
        } catch (error) {
          const executionError =
            error instanceof ProbeExecutionError
              ? error
              : new ProbeExecutionError("runner", compactError(error));
          return {
            caseId: probeCase.id,
            stepIndex,
            category: executionError.category,
            message: compactError(executionError),
            ...(executionError.locatorSnapshot
              ? { locatorSnapshot: executionError.locatorSnapshot }
              : {}),
          };
        }
      }
      return undefined;
    } finally {
      await session.context.close().catch(() => undefined);
    }
  }
}

async function executeStep(
  browser: Browser,
  session: BrowserSession,
  step: ProbeStep,
  baseUrl: string,
  timeoutMs: number,
): Promise<BrowserSession> {
  if (step.op === "newContext") {
    await session.context.close();
    return createSession(browser);
  }
  if (step.op === "goto") {
    const base = new URL(baseUrl);
    if (!step.path.startsWith("/") || step.path.startsWith("//")) {
      throw new ProbeExecutionError("navigation", "Navigation path must be relative to app origin");
    }
    const target = new URL(step.path, base);
    if (target.origin !== base.origin) {
      throw new ProbeExecutionError("navigation", "Navigation target changed app origin");
    }
    try {
      await session.page.goto(target.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return session;
    } catch (error) {
      throw new ProbeExecutionError("navigation", compactError(error));
    }
  }
  if (step.op === "reload") {
    try {
      await session.page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
      return session;
    } catch (error) {
      throw new ProbeExecutionError("navigation", compactError(error));
    }
  }

  const locator = locate(session.page, step.locator);
  if (step.op !== "expectCount" || step.count !== 0) {
    try {
      await locator.waitFor({ state: "attached", timeout: timeoutMs });
    } catch (error) {
      throw new ProbeExecutionError(
        "locator",
        compactError(error),
        await ariaSnapshot(session.page, timeoutMs),
      );
    }
  }

  try {
    switch (step.op) {
      case "click":
        await locator.click({ timeout: timeoutMs });
        break;
      case "fill":
        await locator.fill(step.value, { timeout: timeoutMs });
        break;
      case "select":
        await locator.selectOption(step.value, { timeout: timeoutMs });
        break;
      case "expectVisible":
        await expect(locator).toBeVisible({ timeout: timeoutMs });
        break;
      case "expectText":
        if (step.exact === false) {
          await expect(locator).toContainText(step.text, { timeout: timeoutMs });
        } else {
          await expect(locator).toHaveText(step.text, { timeout: timeoutMs });
        }
        break;
      case "expectValue":
        await expect(locator).toHaveValue(step.value, { timeout: timeoutMs });
        break;
      case "expectCount":
        await expect(locator).toHaveCount(step.count, { timeout: timeoutMs });
        break;
    }
  } catch (error) {
    const assertion = step.op.startsWith("expect");
    throw new ProbeExecutionError(assertion ? "assertion" : "timeout", compactError(error));
  }
  return session;
}

async function createSession(browser: Browser): Promise<BrowserSession> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

function locate(page: Page, locator: ProbeLocator): Locator {
  if (locator.by === "label") {
    return page.getByLabel(locator.text, { exact: locator.exact });
  }
  if (locator.by === "text") {
    return page.getByText(locator.text, { exact: locator.exact });
  }
  type AriaRole = Parameters<Page["getByRole"]>[0];
  return page.getByRole(locator.role as AriaRole, {
    name: locator.name,
    exact: locator.exact,
  });
}

async function ariaSnapshot(page: Page, timeoutMs: number): Promise<string | undefined> {
  try {
    const snapshot = await page.locator("body").ariaSnapshot({
      timeout: Math.min(timeoutMs, 500),
    });
    return snapshot
      .replace(/\b(password|token|api[_-]?key|cookie)\s*[:=]\s*\S+/gi, "$1=[redacted]")
      .slice(0, 4_000);
  } catch {
    return undefined;
  }
}

function compactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 1_000);
}
