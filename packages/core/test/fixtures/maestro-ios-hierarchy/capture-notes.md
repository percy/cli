# Maestro iOS view-hierarchy fixtures — capture notes

`MAESTRO_SOURCE_VERSION`: **`cli-2.0.7`** (realmobile production-default per `/usr/local/.browserstack/realmobile/config/constants.yml` `maestro_version_mapping`).

`CAPTURE_METHOD`: source-synthesis from `mobile-dev-inc/Maestro` at `ref=cli-2.0.7` (Codable-deterministic for HTTP+JSON; PR #2210's binary-bytes wire-capture procedure is not necessary here). Wire-bytes-vs-source-types validation deferred to Unit 5/6/7 BS validation. See `docs/plans/2026-05-06-004-feat-cross-platform-maestro-resolver-unification-plan.md` Plan Viability Gate 2 for the trade-off rationale.

## Reproducibility

```bash
REF=cli-2.0.7
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/ViewHierarchyHandler.swift?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Models/AXElement.swift?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Models/ViewHierarchyRequest.swift?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-ios-driver/src/main/kotlin/hierarchy/AXElement.kt?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-ios-driver/src/main/kotlin/xcuitest/api/ViewHierarchyRequest.kt?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-client/src/main/java/maestro/drivers/IOSDriver.kt?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-client/src/main/java/maestro/TreeNode.kt?ref=$REF" --jq '.content' | base64 -d
gh api "repos/mobile-dev-inc/Maestro/contents/maestro-cli/src/main/java/maestro/cli/command/PrintHierarchyCommand.kt?ref=$REF" --jq '.content' | base64 -d
```

## PR #2365 status at cli-2.0.7 — LANDED

`ViewHierarchyHandler.swift:22` calls `RunningApp.getForegroundApp()` with **no parameters**. The handler does not iterate `requestBody.appIds` to pick the AUT — server detects the foreground app itself via `XCUIApplication.activeAppsInfo()`. The Kotlin `ViewHierarchyRequest` data class still has `appIds: Set<String>` and the Swift `ViewHierarchyRequest` still has `appIds: [String]` (Kotlin client still sends the field for forward-compat with older runners), but the server ignores it.

**Implication for Percy CLI Unit 2:** sending `{"appIds": [], "excludeKeyboardElements": false}` works correctly on cli-2.0.7+. **No bundleId YAML scraping required for the realmobile fast path.** See `viewHierarchy-request.json`.

## PR #2402 status at cli-2.0.7 — LANDED with a different wrap

`ViewHierarchyHandler.swift:73,84,86` shows the AUT-found case returns a wrap, but the children differ from cli-1.39.13:
- **cli-1.39.13:** `AXElement(children: [springboardHierarchy, appHierarchy])` — both `elementType == 1`.
- **cli-2.0.7:** `AXElement(children: [appHierarchy, AXElement(children: statusBars)])` — only `appHierarchy` has `elementType == 1`; the statusBars wrapper has `elementType == 0` (defaulted by `AXElement.init(children:)` at `AXElement.swift:39-56`).

So the deepening pass's parser rule ("first `elementType == 1` whose `identifier != 'com.apple.springboard'`") still works correctly at cli-2.0.7, but for a different reason: there is no SpringBoard sibling to skip in the happy path. The springboard-skip is only relevant when the AUT-not-found case fires (`ViewHierarchyHandler.swift:23-29`), where the response root IS `com.apple.springboard`.

The AUT-not-found case is unchanged from cli-1.39.13 — still returns SpringBoard hierarchy directly, no wrap.

## Wire-format ground truth at cli-2.0.7

### Request body

```json
{
  "appIds": [],
  "excludeKeyboardElements": false
}
```

`appIds` is required at the Codable level (no default; absent key returns 4xx with `"incorrect request body provided"`) but server-ignored after PR #2365. Empty array is the recommended Percy CLI value.

### Response body — happy path (AUT found)

Full source citations:
- Outer wrap: `ViewHierarchyHandler.swift:73` `AXElement(children: [appHierarchy, AXElement(children: statusBars)].compactMap { $0 })`
- Wrap defaults: `AXElement.swift:39-56` (synthetic init: `identifier=""`, `elementType=0`, `frame=zero`, all booleans `false`, etc.)
- Encoding: `AXElement.swift:104-121` (`encode(to encoder:)`):
  - Always emits: `identifier`, `frame`, `label`, `elementType`, `enabled`, `horizontalSizeClass`, `verticalSizeClass`, `selected`, `hasFocus`, `windowContextID`, `displayID`
  - `encodeIfPresent`: `value`, `title`, `placeholderValue`, `children`
- Frame keys are PascalCase (`AXElement.kt:5-10` `@JsonProperty("X")` / `("Y")` / `("Width")` / `("Height")`).
- Root envelope: `{ axElement: AXElement, depth: Int }` per `AXElement.swift:5-8` `struct ViewHierarchy: Codable`.

See `viewHierarchy-response.json` for the canonical fixture (variant 2): one synthetic outer wrap with two children — the AUT (elementType=1, identifier=`com.example.app`) and a synthetic statusBars container (elementType=0, identifier=`""`).

### Response body — AUT-not-found (SpringBoard fallback)

`ViewHierarchyHandler.swift:23-29`. When `RunningApp.getForegroundApp()` returns nil:

```swift
let springboardHierarchy = try elementHierarchy(xcuiElement: springboardApplication)
let springBoardViewHierarchy = ViewHierarchy.init(axElement: springboardHierarchy, depth: ...)
```

No wrap — `axElement` IS the SpringBoard tree directly. `axElement.identifier == "com.apple.springboard"`, `elementType == 1`. See `viewHierarchy-response-springboard-only.json`.

### Window-offset adjustment (NEW in cli-2.0.7)

`ViewHierarchyHandler.swift:65-87`. When `deviceFrame != appFrame` (iPad multi-window scenarios), the handler calls `expandElementSizes` to shift child frames by `(offsetX, offsetY)`. Implication: frame coordinates may be device-relative not app-relative on iPad. **For iPhone full-screen apps `deviceFrame == appFrame` so no adjustment occurs** (lines 65-66 short-circuit).

### Tree-depth fallback (NEW in cli-2.0.7)

`ViewHierarchyHandler.swift:9, 118-189`. `snapshotMaxDepth = 60`. Trees deeper than 60 trigger iterative descent via `getHierarchyWithFallback`. May produce truncated hierarchies. Defensive — Unit 2 parser should handle missing/sparse children gracefully.

## Variant 6 — maestro CLI iOS stdout shape

`maestro --udid <udid> --driver-host-port <port> hierarchy` invokes `PrintHierarchyCommand.kt:131` `session.maestro.viewHierarchy().root` — the `viewHierarchy()` Kotlin method on `Maestro` class. Implementation at `IOSDriver.kt:174-220`:

```kotlin
private fun viewHierarchy(excludeKeyboardElements: Boolean): TreeNode {
    val hierarchyResult = iosDevice.viewHierarchy(excludeKeyboardElements)
    val hierarchy = hierarchyResult.axElement
    return mapViewHierarchy(hierarchy)
}

private fun mapViewHierarchy(element: AXElement): TreeNode {
    val attributes = mutableMapOf<String, String>()
    attributes["accessibilityText"] = element.label
    attributes["title"] = element.title ?: ""
    attributes["value"] = element.value ?: ""
    attributes["text"] = element.title?.ifEmpty { element.value } ?: ""
    attributes["hintText"] = element.placeholderValue ?: ""
    attributes["resource-id"] = element.identifier
    attributes["bounds"] = element.frame.boundsString    // "[X,Y][X+W,Y+H]"
    attributes["enabled"] = element.enabled.toString()
    attributes["focused"] = element.hasFocus.toString()
    attributes["selected"] = element.selected.toString()

    val checked = element.elementType in CHECKABLE_ELEMENTS && element.value == "1"
    attributes["checked"] = checked.toString()

    val children = element.children.map { mapViewHierarchy(it) }

    return TreeNode(
        attributes = attributes,
        children = children,
        enabled = element.enabled,
        focused = element.hasFocus,
        selected = element.selected,
        checked = checked,
    )
}
```

`TreeNode.kt:23-32` shape:
```kotlin
data class TreeNode(
    val attributes: MutableMap<String, String> = mutableMapOf(),
    val children: List<TreeNode> = emptyList(),
    val clickable: Boolean? = null,
    val enabled: Boolean? = null,
    val focused: Boolean? = null,
    val checked: Boolean? = null,
    val selected: Boolean? = null,
)
```

`PrintHierarchyCommand.kt:153-156` serializes with `JsonInclude.Include.NON_NULL` — null Boolean fields are omitted, but the `attributes` map always serializes (even when values are `""` strings).

See `maestro-cli-ios-stdout.json` for the source-derived fixture mirroring `viewHierarchy-response.json`'s logical content but in TreeNode shape.

### Critical finding: iOS TreeNode does NOT carry `class`

Maestro's `mapViewHierarchy` does **not** add a `class` (or `elementType`) attribute to the TreeNode `attributes` map. Only `resource-id` (from `identifier`) is selector-relevant on iOS. This contradicts the iOS-WIP scaffold's `IOS_SELECTOR_KEYS_WHITELIST = ['id', 'class']` — `class` selectors against the maestro CLI stdout path return no matches.

**Implications for Percy CLI Unit 2:**
- iOS selector vocabulary should be `['id']` only for V1 (matches Maestro's actual capability).
- The originally absorbed Unit 2b XCUI `elementType` integer-to-name table is **not needed for selector matching** — drop the standalone `xcui-element-types.js` from Unit 2 scope.
- `id` selectors on iOS: `region.element = {id: "submitBtn"}` matches against `attributes["resource-id"]`. Already aligned with how iOS-WIP scaffold's `flattenMaestroNodes` reads attribute keys.
- HTTP path can theoretically expose `class` from raw `AXElement.elementType` (since the table is purely informational), but that creates an asymmetry vs. CLI fallback. Keep both paths symmetric: `id` only.

## Plan Viability Gate 1 status

`/tmp/<sessionId>_test_suite/flows/*.yaml` discovery: documented in `docs/solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md` as the canonical layout for Percy-Maestro sessions on BS realmobile, validated 2026-05-06 with Percy build #9 on host 185.255.127.52. The validation skill's Step 9 cites this path (`sudo cat /tmp/${SID}_test_suite/logs/<flow-id>/maestro.log`).

**However:** with PR #2365 landed in cli-2.0.7, **YAML-based bundleId discovery is no longer required for the realmobile fast path.** The server detects AUT itself when `appIds: []` is sent. YAML scraping was the deepening pass's mitigation for pre-PR-2365 versions; that mitigation is now optional.

**Implication for Unit 2:** drop the `discoverAutBundleId` helper, the YAML-reader's TOCTOU/symlink defenses, the multiple-app-ids refusal, the YAML-size-cap. Send `appIds: []`. If the response is a SpringBoard-only tree (cli-1.39.x sessions where `appIds: []` returns SpringBoard), the parser detects that case and routes to maestro CLI shell-out fallback (which knows the AUT internally via Maestro's flow context). Significant Unit 2 scope reduction.

## What this means for the plan's other Units

| Plan section | Source-research finding | Implication |
|---|---|---|
| Unit 2: bundleId YAML discovery | Not needed at cli-2.0.7 (PR #2365 landed) | Drop the YAML reader; send `appIds: []`; SpringBoard-only fallback handles older versions |
| Unit 2: XCUI elementType table (`xcui-element-types.js`) | Not needed (iOS Maestro doesn't expose `class`) | Drop the standalone table file |
| Unit 2: `IOS_SELECTOR_KEYS_WHITELIST` | Should be `['id']` only | Update from `['id', 'class']` |
| Unit 2: `flattenMaestroNodes` iOS branch | Two shapes to handle: HTTP raw AXElement + CLI TreeNode | HTTP adapter walks AXElement → emits `{attributes: {id, bounds}, children}`; CLI path consumes TreeNode unchanged |
| Unit 2: parser rule | "First `elementType == 1` whose `identifier != 'com.apple.springboard'`" | Rule still correct for cli-2.0.7's `[AUT, statusBars]` wrap; statusBars wrap has `elementType == 0` so it's naturally skipped |
| Unit 5: cross-platform parity | Selector vocabulary must match between Android (id/class/text/...) and iOS (id only) | R6 parity test must use selectors that work on both — `id` on iOS maps to `resource-id` on Android too |
| Unit 6: WDA failure regression | Unchanged — still tests AUT-crash-mid-flow case | — |

The plan should be updated to absorb these simplifications. Net effect: Unit 2's scope is smaller than the deepening pass + document-review absorption framing implied. Drop `xcui-element-types.js`, drop `maestro-ios-bundleid-resolver.js`, drop YAML-related test scenarios.

## Variant matrix disposition

| # | Scenario | Source | Status |
|---|---|---|---|
| 1 | App-just-launched baseline | `ViewHierarchyHandler.swift:21-37` | Same shape as variant 2 |
| 2 | Foreground app + element regions (canonical) | `ViewHierarchyHandler.swift:30-37` + `getAppViewHierarchy` | **`viewHierarchy-response.json`** |
| 3 | Foreground app + keyboard | `getAppViewHierarchy` calls `getHierarchyWithFallback` which includes keyboard subtree when `excludeKeyboardElements=false` | Same shape as variant 2 with extra keyboard children; not separately fixtured |
| 4 | AUT terminated, only SpringBoard | `ViewHierarchyHandler.swift:23-29` | **`viewHierarchy-response-springboard-only.json`** |
| 5 | Empty `appIds` | `RunningApp.getForegroundApp()` with no params | At cli-2.0.7: equivalent to variant 2 (server detects AUT). At cli-1.39.x: equivalent to variant 4 (SpringBoard returned). Parser handles both. |
| 6 | maestro CLI iOS stdout | `IOSDriver.kt:174-220` `mapViewHierarchy` + `PrintHierarchyCommand.kt:153-156` | **`maestro-cli-ios-stdout.json`** |

## Source files saved locally during research

`/tmp/maestro-cli-2.0.7/`:
- `ViewHierarchyHandler.swift` (249 lines — significantly more than cli-1.39.13's ~46)
- `AXElement.swift` (166 lines — Codable + window-offset helpers)
- `AXElement.kt` (39 lines)
- `ViewHierarchyRequest.swift` (6 lines — `[String]` field)
- `ViewHierarchyRequest.kt` (6 lines — `Set<String>` field)
- `XCTestHTTPServer.swift` (41 lines)
- `IOSDriver.kt` (611 lines — viewHierarchy + mapViewHierarchy + many other methods)
- `TreeNode.kt` (36 lines)
- `PrintHierarchyCommand.kt` (232 lines)

These are temporary research artifacts; not committed. Reproduce with the `gh api` block at the top of this file.

## Future capture work (deferred, optional)

- **Wire-bytes confidence boost.** During whatever next BS Percy-Maestro session you trigger anyway, `sudo curl -X POST http://127.0.0.1:<driver-port>/viewHierarchy -d '{"appIds":[],"excludeKeyboardElements":false}' -H 'Content-Type: application/json' > /tmp/real-bytes.json` and diff against `viewHierarchy-response.json`. Document any divergence as a `wire-bytes-vs-source-derived` addendum.
- **Re-vendor on Maestro upgrade.** When realmobile's `maestro_version_mapping` advances past `cli-2.0.7`, repeat this source-research procedure against the new tag. The schema-class drift bit (`maestroHierarchyDrift.ios` in healthcheck) catches version-skew at runtime if re-vendoring is delayed.
