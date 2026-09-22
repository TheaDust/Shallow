import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayRequestError, httpGatewayFailure, observeGatewayFailures } from "../src/gateway-failure.js";
import { GatewayRecovery, GatewayUnavailableError } from "../src/gateway-recovery.js";

function fixture() {
  let now = 0;
  const delays: number[] = [];
  return { recovery: new GatewayRecovery({ now: () => now, sleep: async ms => { delays.push(ms); now += ms; } }),
    now: () => now, delays };
}
const unlimited = () => Infinity;
const down = () => new GatewayRequestError(httpGatewayFailure(429));

test("Shared recovery retries the same operation through a five-minute outage", async () => {
  const f = fixture();
  let calls = 0;
  const result = await f.recovery.run("builder", "packet-a", unlimited, async () => {
    calls++;
    if (f.now() < 300_000) throw down();
    return "completed";
  });
  assert.equal(result, "completed");
  assert.equal(calls, 5);
  assert.equal(f.now(), 450_000);
  assert.ok(f.delays.every(delay => delay <= 30_000));
  assert.equal(f.recovery.exhausted, false);
});

test("Persistent outages exhaust the caller's window without disabling later calls", async () => {
  const f = fixture();
  const windowMs = 3_600_000;
  let calls = 0;
  await assert.rejects(f.recovery.run("planner", "packet-a", () => windowMs - f.now(), async () => { calls++; throw down(); }),
    error => error instanceof GatewayRequestError && error.gatewayFailure.status === 429);
  assert.ok(calls > 10, `expected recovery to outlast the old five-attempt cap, saw ${calls} attempts`);
  assert.equal(f.now(), windowMs);
  assert.equal(f.recovery.exhausted, false);
  const result = await f.recovery.run("builder", "packet-b", unlimited, async () => { calls++; return "recovered"; });
  assert.equal(result, "recovered");
});

test("Builder authentication failures still stop all new calls", async () => {
  const f = fixture();
  await assert.rejects(f.recovery.run("builder", "packet-a", unlimited, async () => {
    throw new GatewayRequestError(httpGatewayFailure(401));
  }), GatewayRequestError);
  assert.equal(f.recovery.exhausted, true);
  let calls = 0;
  await assert.rejects(f.recovery.run("builder", "packet-b", unlimited, async () => { calls++; }), GatewayUnavailableError);
  assert.equal(calls, 0);
});

test("Retry-After and stage budgets bound one call's recovery window", async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(f.recovery.run("builder", "a", () => 60_000 - f.now(), async () => {
    calls++;
    throw new GatewayRequestError(httpGatewayFailure(429, "120"));
  }), error => error instanceof GatewayRequestError && error.gatewayFailure.retryAfterMs === 120_000);
  assert.equal(calls, 1);
  assert.deepEqual(f.delays, [30_000, 30_000]);
  assert.equal(f.now(), 60_000);
  assert.equal(f.recovery.exhausted, false);
  assert.equal(httpGatewayFailure(503, "2").retryAfterMs, 2000);
  assert.equal(httpGatewayFailure(503, "Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("2015-10-21T07:27:00Z")).retryAfterMs, 60_000);
  assert.equal(httpGatewayFailure(429, "invalid").retryAfterMs, undefined);
  assert.equal(httpGatewayFailure(429, "-1").retryAfterMs, undefined);
});

test("Authentication and request failures are not retried, and ordinary error text is not transport metadata", async () => {
  for (const error of [new GatewayRequestError(httpGatewayFailure(401)), new GatewayRequestError(httpGatewayFailure(400)), new Error("test expected 429")]) {
    const f = fixture();
    let calls = 0;
    await assert.rejects(f.recovery.run("builder", "a", unlimited, async () => { calls++; throw error; }), candidate => candidate === error);
    assert.equal(calls, 1);
    assert.equal(f.delays.length, 0);
    assert.equal(f.recovery.exhausted, error instanceof GatewayRequestError && error.gatewayFailure.kind === "authentication");
  }
});

test("Planner requests are serialized while Builder can execute alongside the current planner", async () => {
  const f = fixture();
  const calls: string[] = [];
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = f.recovery.run("planner", "a", unlimited, async () => { calls.push("planner-a"); await blocked; });
  const second = f.recovery.run("planner", "b", unlimited, async () => { calls.push("planner-b"); });
  await f.recovery.run("builder", "build", unlimited, async () => { calls.push("builder"); });
  assert.ok(calls.includes("planner-a"));
  assert.ok(calls.includes("builder"));
  assert.ok(!calls.includes("planner-b"));
  release();
  await Promise.all([first, second]);
  assert.equal(calls.at(-1), "planner-b");
});

test("Planner-specific authorization errors leave Builder available", async () => {
  const f = fixture();
  await assert.rejects(f.recovery.run("planner", "a", unlimited, async () => {
    throw new GatewayRequestError(httpGatewayFailure(401));
  }));
  assert.equal(await f.recovery.run("builder", "a", unlimited, async () => "ok"), "ok");
});

test("An in-flight success cannot release a cooldown raised by the other client", async () => {
  let now = 0;
  const sleepers: Array<() => void> = [];
  const recovery = new GatewayRecovery({ now: () => now, sleep: () => new Promise<void>(resolve => { sleepers.push(resolve); }) });
  let finishPlanner!: () => void;
  let plannerStarted!: () => void;
  const started = new Promise<void>(resolve => { plannerStarted = resolve; });
  const planner = recovery.run("planner", "a", unlimited, async () => {
    plannerStarted();
    await new Promise<void>(resolve => { finishPlanner = resolve; });
  });
  await started;
  let builderCalls = 0;
  const builder = recovery.run("builder", "a", unlimited, async () => { if (++builderCalls === 1) throw down(); });
  await new Promise<void>(resolve => setImmediate(resolve));
  finishPlanner();
  await planner;
  let secondPlannerCalls = 0;
  const next = recovery.run("planner", "b", unlimited, async () => { secondPlannerCalls++; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(secondPlannerCalls, 0);
  assert.equal(builderCalls, 1);
  now = 30_000;
  sleepers.forEach(resolve => resolve());
  await Promise.all([builder, next]);
  assert.equal(secondPlannerCalls, 1);
  assert.equal(builderCalls, 2);
});

test("Gateway observation preserves response bodies and clears errors after a successful response", async () => {
  const original = globalThis.fetch;
  let status = 429;
  globalThis.fetch = async () => new Response("body unchanged", { status, headers: { "retry-after": "7" } });
  const observer = observeGatewayFailures("https://gateway.invalid/v1");
  try {
    assert.equal(await (await fetch("https://other.invalid/test")).text(), "body unchanged");
    assert.equal(observer.failure(), undefined);
    assert.equal(await (await fetch(new Request("https://gateway.invalid/v1/chat/completions"))).text(), "body unchanged");
    assert.deepEqual(observer.failure(), httpGatewayFailure(429, "7"));
    status = 200;
    await fetch("https://gateway.invalid/v1/chat/completions");
    assert.equal(observer.failure(), undefined);
  } finally { observer.uninstall(); globalThis.fetch = original; }
});
