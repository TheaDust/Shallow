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
import { ExecutionFault } from "../execution-fault.js";

export interface ProbeRunOptions {
  baseUrl: string;
  stepTimeoutMs: number;
  caseTimeoutMs: number;
}

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  crashed: boolean;
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

export function deriveProbeVerdict(
  failures: ProbeFailure[],
): ShadowReport["verdict"] {
  if (failures.length === 0) return "pass";
  const locatorOnly = failures.every((failure) => failure.category === "locator");
  const hasSnapshot = failures.some(
    (failure) => failure.locatorSnapshot !== undefined,
  );
  return locatorOnly && hasSnapshot ? "inconclusive" : "fail";
}

export class PlaywrightProbeRunner {
  constructor(private readonly launchBrowser: () => Promise<Browser> = () => chromium.launch({ headless: true })) {}

  async run(plan: ProbePlan, options: ProbeRunOptions): Promise<ShadowReport> {
    let browser: Browser | undefined;
    const passedCases: string[] = [];
    const failures: ProbeFailure[] = [];

    try {
      try {
        browser = await this.launchBrowser();
      } catch (error) {
        throw new ExecutionFault("browser", "browser_launch", false, { cause: error });
      }
      for (const probeCase of plan.cases) {
        const failure = await this.runCase(browser, probeCase, options);
        if (failure) failures.push(failure);
        else passedCases.push(probeCase.id);
      }
    } catch (error) {
      const fault = error instanceof ExecutionFault ? error
        : browser && !browser.isConnected()
        ? new ExecutionFault("browser", "browser_disconnected", true, { cause: error }) : undefined;
      // Earlier deterministic product failures must not be erased by a later crash/retry.
      if (fault && !failures.some((failure) =>
        ["assertion", "navigation", "timeout"].includes(failure.category))) throw fault;
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
      verdict: deriveProbeVerdict(failures),
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
          if (session.crashed || !browser.isConnected()) {
            throw new ExecutionFault("browser", session.crashed ? "page_crashed" : "browser_disconnected", true, { cause: error });
          }
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

  const locator = await resolveLocator(session, step, timeoutMs);

  try {
    switch (step.op) {
      case "click":
        await locator.click({ timeout: timeoutMs });
        break;
      case "doubleClick":
        await locator.dblclick({ timeout: timeoutMs });
        break;
      case "hover":
        await locator.hover({ timeout: timeoutMs });
        break;
      case "press":
        await locator.press(step.key, { timeout: timeoutMs });
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
        await expectAnyText(locator, step, timeoutMs);
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

/**
 * Try candidates in order; non-final candidates get a short probe so a wrong
 * guess does not consume the step budget, the final one keeps the full timeout.
 * Only an all-candidates miss is a locator failure; a hit followed by a failing
 * operation stays an assertion/timeout failure.
 */
async function resolveLocator(
  session: BrowserSession,
  step: Extract<ProbeStep, { locator: ProbeLocator }>,
  timeoutMs: number,
): Promise<Locator> {
  const primary = locate(session.page, step.locator);
  if (step.op === "expectCount" && step.count === 0) return primary;
  const candidates: ProbeLocator[] = [step.locator, ...(step.locator.fallbacks ?? [])];
  let lastMiss: unknown;
  for (let index = 0; index < candidates.length; index += 1) {
    const isFinal = index === candidates.length - 1;
    const candidate = locate(session.page, candidates[index]);
    try {
      await candidate.waitFor({
        state: "attached",
        timeout: isFinal ? timeoutMs : Math.min(LOCATOR_PROBE_TIMEOUT_MS, timeoutMs),
      });
      return candidate;
    } catch (error) {
      lastMiss = error;
    }
  }
  throw new ProbeExecutionError(
    "locator",
    compactError(lastMiss),
    await ariaSnapshot(session.page, timeoutMs),
  );
}

/** expectText anyOf tries candidates in order; Playwright array form is multi-element, not any-of. */
async function expectAnyText(
  locator: Locator,
  step: Extract<ProbeStep, { op: "expectText" }>,
  timeoutMs: number,
): Promise<void> {
  const candidates = [step.text, ...(step.anyOf ?? [])];
  let lastError: unknown;
  for (let index = 0; index < candidates.length; index += 1) {
    const isFinal = index === candidates.length - 1;
    const timeout = isFinal ? timeoutMs : Math.min(LOCATOR_PROBE_TIMEOUT_MS, timeoutMs);
    try {
      if (step.exact === false) {
        await expect(locator).toContainText(candidates[index], { timeout });
      } else {
        await expect(locator).toHaveText(candidates[index], { timeout });
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const LOCATOR_PROBE_TIMEOUT_MS = 500;

async function createSession(browser: Browser): Promise<BrowserSession> {
  const context = await browser.newContext();
  try {
    const session: BrowserSession = { context, page: await context.newPage(), crashed: false };
    session.page.on("crash", () => { session.crashed = true; });
    return session;
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
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
