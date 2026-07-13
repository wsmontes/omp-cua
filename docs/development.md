# Development

## Repository layout

```text
extensions/computer-use.ts       Public OMP tool registration
src/bridge.ts                    TypeScript runtime and tool implementation
src/actions.ts                   Action preparation and result reconciliation
src/runtime.ts                   Immutable state store and resource scheduler
src/state.ts                     Saved UI state ownership and restoration
src/view.ts                      Stable refs and resulting-state change views
src/outline.ts                   Outline parsing, folding, search, and ref mapping
src/note.ts                      Disposable running-note generation
native/macos/bridge.swift        macOS helper for AX, capture, permissions, and input
native/windows/                 Windows backend/helper code when developing on Windows
scripts/build-native.mjs         Native helper build script
scripts/setup-helper.mjs         Native helper install script
scripts/check-invariants.mjs     Architecture invariant checks
scripts/check-runtime-concurrency.mjs Scheduler/state concurrency checks
scripts/omp-cubench-agent.mjs    Cubench gateway adapter using registered OMP tools
```

The public tool surface lives in `extensions/computer-use.ts`. Keep it small. Internal complexity belongs in `src/bridge.ts`, `src/outline.ts`, `src/note.ts`, and the native helper.

## Checks

Run all static checks:

```bash
bun run test
```

This runs TypeScript, tool-schema compatibility checks, architecture invariants, and native helper checks available on the current platform.

On macOS, rebuild the native helper after Swift changes:

```bash
bun run build:native
```

## Architecture rules

The runtime is state-scoped and outline-first:

- `observe_ui` returns a folded UI outline and running note.
- `search_ui`, `expand_ui`, and `inspect_ui` provide progressive disclosure.
- `act_ui` is the only public desktop action entrypoint.
- UI observations are immutable records; request-local hydration replaces global current state.
- Cached queries bypass scheduling; live work is ordered per physical resource.
- Browser pages and desktop surfaces share the `@r` root forest and `@e` outline contract.
- The helper owns grounding, preflight, execution, and verification.
- Removed direct tools such as `screenshot`, `click`, `set_text`, and `computer_actions` should not reappear as public extension tools.

Run invariants after architecture changes:

```bash
bun run test:invariants
```

Set `PI_CU_LIVE=1` only when you want live helper checks in addition to static checks.

## Cubench

`scripts/omp-cubench-agent.mjs` drives a headed Cubench Chromium window through the same registered OMP tools used by the extension. Cubench must launch its web driver headed:

```bash
CUBENCH_HEADLESS=0 bun ../cubench/bin/cubench.mjs suite run \
  --suite ../cubench/suites/core.json \
  --agent "bun $PWD/scripts/omp-cubench-agent.mjs" \
  --driver web \
  --trials 3 \
  --label omp-cu
```

The adapter uses Cubench only for the instruction and final oracle; UI observation and action go through `omp-computer-use`. Gateway action/observation counters therefore do not trigger Cubench interference hooks, so stale/reorder cases need a native-driver integration before their interference timing can be treated as benchmark evidence.

## Native platform helpers

On macOS, the helper installed for permissions is:

```text
/Applications/pi-computer-use.app
```

The macOS helper targets macOS 14+ and uses ScreenCaptureKit. Local installs use a stable per-user signing identity so the Accessibility and Screen Recording permission target remains consistent.

On Windows, development uses the Windows platform backend/helper and the active desktop session rather than the macOS app bundle or TCC permission model.

