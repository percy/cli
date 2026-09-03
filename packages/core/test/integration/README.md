# Integration harnesses — Android gRPC + iOS HTTP resolver validation

Documented merge gates for the cross-platform view-hierarchy resolver work
(plans: `percy-maestro/docs/plans/2026-05-06-004-feat-cross-platform-maestro-resolver-unification-plan.md`,
`cli/docs/plans/2026-05-07-002-feat-android-grpc-direct-resolver-plan.md`).
All harnesses are env-gated and skip cleanly in CI; they require a real
device + Maestro CLI + a running Percy CLI.

## Harnesses

### `maestro-hierarchy-concurrent.harness.js` (2026-05-07-002 plan Unit 6)

Concurrent-access regression for the Android gRPC primary path. Calls
`runAndroidGrpcDump` against Maestro's `dev.mobile.maestro` agent (via
gRPC over the realmobile/mobile-injected `PERCY_ANDROID_GRPC_PORT`)
while a real Maestro flow holds the device active. Asserts
`{kind: 'hierarchy'}` on every iteration and records p50/p95/p99 timings.

**Pre-merge gate (D11):** `p95 < 1200ms AND p99 < 2000ms` across 100
iterations under live `tapOn` flow load. Failure means D11's deadline
budget is wrong OR the device-side agent is contention-fragile —
investigate before relaxing the threshold.

Required env:

- `MAESTRO_ANDROID_TEST_DEVICE=<serial>` — connected Android device
- `PERCY_ANDROID_GRPC_PORT=<port>` — host port forwarded to device's
  `dev.mobile.maestro` (`adb forward tcp:<host_port> tcp:7001`); typically
  realmobile/mobile-injected, but for local validation set up the forward
  manually
- `MAESTRO_BIN=<path>` — optional; defaults to `maestro` on PATH

Run from `cli/packages/core/`:

```sh
MAESTRO_ANDROID_TEST_DEVICE=<serial> \
PERCY_ANDROID_GRPC_PORT=<port> \
node test/integration/maestro-hierarchy-concurrent.harness.js
```

Paste the result block (with p50/p95/p99 + iteration count) into the PR
description.



### `maestro-hierarchy-ios-http-concurrent.harness.js` (Unit 7 — V4.2)

Concurrent-access regression. Calls `runIosHttpDump` against Maestro's
iOS XCTestRunner /viewHierarchy endpoint while a real Maestro flow holds
the device active via `extendedWaitUntil` (`fixtures/pause-30s-flow-ios.yaml`).
Asserts `{kind: 'hierarchy'}` on every iteration and records p50/p95/p99
timings to feed `IOS_HTTP_HEALTHY_DEADLINE_MS` tuning.

Required env:

- `MAESTRO_IOS_TEST_DEVICE=<udid>` — connected iOS device or simulator
- `PERCY_IOS_DRIVER_HOST_PORT=<port>` — typically `wda_port + 2700` per realmobile
- `MAESTRO_BIN=<path>` — optional; defaults to `maestro` on PATH

Run from `cli/packages/core/`:

```sh
MAESTRO_IOS_TEST_DEVICE=<udid> \
PERCY_IOS_DRIVER_HOST_PORT=<port> \
node test/integration/maestro-hierarchy-ios-http-concurrent.harness.js
```

Paste the result block (with p50/p95/p99 + alive flag) into the PR
description. Bump `IOS_HTTP_HEALTHY_DEADLINE_MS` to `p95 × 2` if the
harness warns that p95 is within 10% of the deadline.

### `cross-platform-parity.harness.js` (Unit 5 — V2)

Cross-platform R6 parity check. Runs `parity-flow-android.yaml` and
`parity-flow-ios.yaml` against their respective devices. V1 of the
harness is log-only (manual eyeball); V1.1 may add programmatic
±2px assertion once a documented dimension table for the example AUT
exists.

Required env:

- `MAESTRO_PARITY_DEVICES=<android-serial>:<ios-udid>`
- `PERCY_SERVER=http://127.0.0.1:<port>`
- `PERCY_IOS_DRIVER_HOST_PORT=<port>` — for the iOS leg

Run:

```sh
MAESTRO_PARITY_DEVICES=<android-serial>:<ios-udid> \
PERCY_SERVER=http://127.0.0.1:5338 \
PERCY_IOS_DRIVER_HOST_PORT=<port> \
node test/integration/cross-platform-parity.harness.js
```

Open both Percy build URLs and compare the `ParityAndroid` /
`ParityIOS` snapshots side-by-side; the element-region overlay should
cover the same logical UI element on both platforms.

## Fixtures

`fixtures/pause-30s-flow-ios.yaml` — iOS pause flow used by the
concurrent harness. Holds the device active via `extendedWaitUntil` +
impossible selector for ~30s.

`fixtures/parity-flow-android.yaml` + `fixtures/parity-flow-ios.yaml` —
matched cross-platform flows resolving the same `id: "submitBtn"`
selector through Percy's relay.

`fixtures/scripts/percy-pause-sentinel.js` — `runScript` step Maestro
flushes synchronously. Harnesses watch for the `PERCY_PAUSE_BEGIN` line
to know the upcoming pause step has started.

## Why env-gated

These harnesses spawn real Maestro flows against real devices and need a
running Percy CLI on the loopback port the relay endpoints use. CI does
not have devices; running them blindly would fail every CI run. The
env-gate is the standard "skip silently when prerequisites are absent"
pattern; a green harness output pasted into the PR description is the
documented evidence of validation.
