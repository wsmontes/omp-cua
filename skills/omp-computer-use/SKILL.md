---
name: omp-computer-use
description: Use OMP's state-scoped desktop and managed-browser tools to observe and control macOS or Windows apps.
---

# OMP Computer Use

Use these tools when the requested target is a desktop app, or when a managed browser must share the same immutable UI-state model. Prefer a reliable API, MCP server, file operation, terminal command, or OMP's dedicated `browser` tool when those are a better fit.

## Core flow

```text
find_roots → observe_ui → search_ui / expand_ui / inspect_ui → act_ui
```

1. Call `find_roots` when you do not already have the target root.
2. Call `observe_ui` once for that root and retain its `stateId`.
3. Use `search_ui`, `expand_ui`, and `inspect_ui` against that cached state instead of repeatedly observing.
4. Call `act_ui` with the exact `stateId` owning every `@e` ref.
5. Continue from the successor `stateId` returned by `act_ui`; never reuse a stale state after a mutation.

Refs are state-scoped: `@rN` identifies a root, while `@eN` belongs only to one immutable observation. Re-observe after eviction, uncertain outcomes, or external UI changes.

## Acting safely

- Prefer semantic refs over coordinates.
- Batch dependent steps only when no intermediate observation is needed. For click-then-type, place both actions in one `act_ui` call and omit the typing ref so input follows the focus established by the click.
- Use `expect` for observable completion, such as text appearing or disappearing, rather than treating event delivery as success.
- A result of `didnt` or `unknown` is not success. Observe again before retrying; never replay an ambiguous pointer action.
- Set `headless: true` only when foreground activation, global input, and cursor movement are prohibited.
- Do not send messages, submit forms, purchase, delete, or change account/security settings unless the user explicitly requested that action.

## Observation modes

- `semantic`: accessibility data without OCR.
- `visual`: force OCR/image evidence.
- `fused`: accessibility plus OCR when useful; this is the default.

Use `read_text` for long text, and `wait_for` for asynchronous UI changes instead of polling `observe_ui`.

## Managed browser roots

`launch_browser` returns browser-page roots compatible with the same state/ref workflow. Use `navigate_browser` for direct navigation and reserve `evaluate_browser` for targeted inspection that semantic observation cannot provide.
