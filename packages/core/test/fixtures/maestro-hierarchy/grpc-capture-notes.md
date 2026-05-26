# Maestro gRPC viewHierarchy fixture — capture notes

This fixture is the wire-format `ViewHierarchyResponse.hierarchy` (string) that
`dev.mobile.maestro` returns for the
`maestro_android.MaestroDriver/viewHierarchy` RPC.

## Status

**Synthesized placeholder.** The shape mirrors `simple.xml` (the existing
uiautomator-dump fixture) plus the three Maestro-only attributes documented
upstream — `hintText`, `NAF`, `visible-to-user` — which the parser already
ignores because `flattenNodes` only reads the four selector attributes
(`resource-id`, `text`, `content-desc`, `class`) plus `bounds`.

The structural assumption (Maestro's gRPC response is the same UIAutomator XML
format as `adb shell uiautomator dump`) is verified at the source level:
`mobile-dev-inc/maestro/maestro-android/.../ViewHierarchy.kt` says
"Logic largely copied from `AccessibilityNodeInfoDumper`" — the same AOSP
class behind `uiautomator dump`.

## Empirical verification — deferred

To capture the real wire payload from a running BrowserStack Maestro Android
session and replace this fixture:

1. Drop a temporary `console.log('GRPC_RAW_HIERARCHY=' + response.hierarchy)`
   immediately before `extractXmlEnvelope` in `runGrpcDump`
   (`packages/core/src/maestro-hierarchy.js`).
2. Build (`yarn build`), package the overlay (per the host-overlay technique
   in `project_e2e_validation_state.md`), deploy to a pinned BrowserStack
   host (`POST /app-automate/maestro/v2/android/build` with
   `"machine": "<ip>:<serial>"`), and run a Percy-Maestro flow with at least
   one element-region snapshot.
3. Grep `GRPC_RAW_HIERARCHY=` in the percy CLI debug log on the host, copy the
   value verbatim (it's a single line of escaped XML), unescape into a file,
   replace `grpc-response.xml`.
4. Revert the temporary `console.log`.
5. Append a row to the table below.

| Date | BS session URL | Device profile | Maestro CLI version | Captured by |
|------|----------------|----------------|---------------------|-------------|
| _deferred_ | — | — | — | — |

## Drift policy

If a real capture surfaces structural differences (different root tag, missing
`<?xml` prelude, namespaced elements, attribute renames affecting the four
selector keys), revisit `runGrpcDump`'s parser-reuse decision — the fix is a
new helper, not a fudge of `extractXmlEnvelope`.
