# Integration harness — `maestro-hierarchy-concurrent.harness.js`

Documented merge gate for the Phase 2.2 gRPC view-hierarchy resolver
([R6 in the plan](../../../../percy-maestro-android/docs/plans/2026-04-29-001-feat-grpc-element-region-resolver-plan.md)).
Runs `dump()` against a real Android device while a parallel Maestro flow
holds the UiAutomator session, asserts `{ kind: 'hierarchy' }` on every
iteration, and confirms the Maestro flow stays alive. CI skips this
silently — it requires a connected device + Maestro CLI, which CI does not
have.

The negative-control version of this harness reproduces the
`adb-uiautomator-dump` SIGKILL bug deterministically (see
[`maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`](../../../../percy-maestro-android/docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md))
— that's the failure mode this harness exists to prevent regressing.

## When to run

Before merging the Phase 2.2 gRPC PR. Paste the harness output (including
p50/p95/p99 timings) into the PR description as the documented merge gate.

Re-run after any change that touches:
- `packages/core/src/maestro-hierarchy.js` (resolver dispatch / classification)
- `@grpc/grpc-js` or `@grpc/proto-loader` version bumps
- `packages/core/src/proto/maestro_android.proto` (vendored proto refresh)

## Prerequisites

- A connected Android device (USB or `adb connect`)
- `MAESTRO_BIN` pointing to the Maestro CLI binary (or `maestro` on PATH)
- `adb forward tcp:<host-port> tcp:6790` set up against the device, **OR**
  `MAESTRO_GRPC_PORT=<host-port>` exported in the environment
- Wikipedia sample app (`org.wikipedia.alpha`) installed, or override
  `appId:` in `fixtures/pause-30s-flow.yaml` to match a different installed
  package

## Invocation

From `cli/packages/core/`:

```sh
MAESTRO_ANDROID_TEST_DEVICE=<adb-serial> \
  MAESTRO_BIN=/path/to/maestro \
  ANDROID_SERIAL=<adb-serial> \
  node test/integration/maestro-hierarchy-concurrent.harness.js
```

Optional knobs:

- `PERCY_GRPC_HARNESS_ITERATIONS=N` — override the default 100 dump
  iterations.
- `MAESTRO_GRPC_PORT=<port>` — pin the gRPC port and skip the
  `adb forward --list` probe.
- `PERCY_MAESTRO_GRPC=0` — flip the harness to exercise the maestro CLI
  fallback path instead (negative control: the harness should still pass,
  but timings will be ~9s p50 instead of <100ms).

## Expected output (success)

```
harness: device=28201FDH300J1S iterations=100 maestro=/nix/store/.../maestro
harness: spawning maestro test fixtures/pause-30s-flow.yaml...
harness: PERCY_PAUSE_BEGIN seen — Maestro flow now holds UiAutomator session.
harness: completed 100/100 iterations
harness: timings p50=42ms p95=89ms p99=121ms
harness PASS
```

If `p99 ≥ 250ms × 0.9` the plan KTD calls for bumping
`GRPC_HEALTHY_DEADLINE_MS` (in `maestro-hierarchy.js`) to `p99 × 2` before
merge. The 2s circuit-breaker deadline is independent and stays as-is.

## Expected output (skip — CI default)

```
skip: MAESTRO_ANDROID_TEST_DEVICE not set — harness requires a real Android device
```

Exit code 0 on skip — CI will not block on this script.

## Expected output (negative control: regression detected)

```
harness FAIL: 87 iteration(s) failed:
  - iter 0: kind=dump-error reason=fallback-dump-exit-137 (3502ms)
  - iter 1: kind=dump-error reason=fallback-dump-exit-137 (3503ms)
  ...
```

This is what running the same harness against the pre-Phase-2.1 build
(adb-uiautomator-dump as primary) produces — the deterministic SIGKILL
contention the gRPC primary path sidesteps.

## Pause primitive — known imperfection

`extendedWaitUntil` is not a hard mutex. There is a sub-millisecond gap
between Maestro's polling iterations where the UiAutomator session is
briefly released. Real-Android session acquisition takes 50–200ms, so the
gap is unexploitable in practice — but if the harness ever shows flaky
passes under contention, that's the suspect. The plan's risk treatment
(Risk 3) documents this trade-off.
