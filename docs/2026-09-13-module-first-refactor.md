# Module-first pipeline

> 本文记录模块优先重构的设计。后续引擎已由 OpenCode 替换为 Pi coding-agent（`docs/2026-09-14-pi-sdk-refactor-plan.md`），文中“OpenCode 作为应用写入者”的表述现由 Pi 承担；模块调度、独立验收与集中修复流程不变。

## Approved direction

Replace main's atomic implement/grade/rollback loop with module implementation, independent audit, and bounded consolidated repair. Baseline remains the control. OpenCode is the sole application writer; Judge receives requirements and browser observations only. No official tests or scores enter the harness.

## Implementation ownership and sequence

1. `scheduler.ts`: group complete ROOT child modules, order by cross-module dependencies, combine mutually dependent module groups if atomic dependencies require it. Provide independent atomic audit packets with dependency prerequisites as context.
2. `pipeline.ts`, `types.ts`, `run-state.ts`: separate implementation progress from verification. Save buildable, ready application checkpoints after module calls; Planner/locator faults retain that checkpoint with inconclusive status. Implement all modules before audit. Consolidate reproducible business failures into at most two repair calls, rerun cached behavior plans including regression coverage, and restore a repair on lost passes or broken readiness. No self-reported verification.
3. `run-budget.ts`, CLI, Python entry, Builder port/runtime: main defaults to unlimited total time; when an explicit positive budget is supplied, reserve 60% for implementation, 20% for initial audit, 15% for repair and 5% for final checks. Bound each model call by remaining phase time and fixed per-call ceilings; final delivery repair has a single attempt. Reuse the implementation conversation, discard it after rollback/runtime failure, isolate repair conversations.
4. `judge/probe-schema.ts`, planner, runner: add bounded scoped accessible locators for repeated cards/rows/dialogs; require an explicit assertion in the wire case structure; retain parser validation and immutable expected behavior during refinement. Mixed failures can refine locator failures on Judge's side. Invalid plans never send application edits.
5. `prompts/`: module-level action and short receipt, bounded optional browser self-test, include complete module and seed evidence. No repeated mandatory documentation/rebuild/test cycle.
6. `human-log.ts`, ARC projection and README/AGENTS: report runnable checkpoints separately from independent pass/fail/inconclusive; final summary describes evidence for the delivered version. Existing public ARC schema stays fixed; private plans stay private.

## Validation

- Scheduler: full subtrees, deterministic dependency ordering, cross-module cycles, atomic audit coverage.
- Pipeline: all implementations precede audit; uncertain Judge preserves code and later modules; checkpoint requires build/readiness; repair collects failures and cannot retain regressions; final repairs invalidate stale evidence; limited rounds and phase/call budgets; failure cleanup and projection/log isolation.
- Runtime: implementation session reuse, fresh repair sessions, invalidation after rollback/server death and image fallback; real SDK serialization and baseline remain supported.
- Judge: wire assertions required, nested unsafe scopes rejected, repeated-label Chromium fixture, unchanged assertions during refinement, schema/model errors remain inconclusive.
- Run `npm run test:all`, adapter/package checks and local OpenCode startup without a model call. Real 15/30/45-minute model evaluations remain a separate empirical comparison; do not claim speed or score gains from fake tests.

## Verification completed

- `npm run test:all`: typecheck passed; 271 unit/integration tests passed, 2 opt-in tests skipped; 7 Chromium browser tests passed.
- Exported submission ZIP contains all current source and prompt assets, including audit and budget modules; excludes build/test/docs trees.
- Python adapter command construction checked for Windows/Linux, absent budget, explicit zero and positive budget. Default remains unlimited.
- Installed Windows OpenCode starts, creates independent sessions and closes without a model request.
- Real WSL/model timing and external accuracy comparisons have not been run. These checks establish implementation behavior, not a measured speedup or score gain.
