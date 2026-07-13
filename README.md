# omp-computer-use

Native [Oh My Pi](https://github.com/can1357/oh-my-pi) extension for state-scoped desktop control on macOS and Windows.

`omp-computer-use` lets OMP agents inspect application windows, find controls, click, type, scroll, wait for UI changes, and verify observable outcomes. It keeps complete immutable observations behind compact `stateId`-scoped views so concurrent calls cannot silently act on stale UI.

The macOS helper requires macOS 14 or newer.

## When to use it

Prefer a reliable API, MCP server, file operation, terminal command, or OMP's dedicated browser tool when one fits. Computer use is for software whose usable interface is the app on screen.

The extension adds:

- first-class OMP tools with read/write/exec approval tiers;
- macOS Accessibility and ScreenCaptureKit integration;
- Windows UI Automation and native input integration;
- immutable UI states with stale-write rejection;
- cached search, expansion, inspection, and paginated text;
- checked action batches, semantic postconditions, and successor diffs;
- optional OCR-backed fused observations;
- managed CDP browser roots sharing the same state model.

## Install

```bash
omp install git:github.com/edlsh/omp-computer-use
```

Start OMP interactively after installation:

```bash
omp
```

On macOS, the first computer-use tool call registers the native helper and asks for:

- **Accessibility**
- **Screen Recording**, called **Screen & System Audio Recording** on newer macOS releases

Grant both permissions to:

```text
/Applications/pi-computer-use.app
```

The helper retains the upstream app identity so upgrades do not unnecessarily replace the macOS permission target. Enable each toggle, return to OMP, and choose **Recheck (restarts helper)**.

On Windows, run OMP in an unlocked interactive desktop session. The package does not include a Windows executable; its first live tool call builds the included Rust helper, so Rust and `cargo` must be on `PATH`. The helper is then installed under:

```text
%USERPROFILE%\.omp\agent\helpers\omp-computer-use\windows-bridge.exe
```

Use `/computer-use` inside OMP to show the effective configuration and its sources.

## Core workflow

```text
find_roots → observe_ui → search_ui / expand_ui / inspect_ui → act_ui
```

An `@eN` element ref belongs only to the `stateId` that returned it. Continue from the successor state after every mutation; re-observe after uncertain outcomes or external UI changes.

Main tools:

- `find_roots`
- `observe_ui`
- `search_ui`
- `expand_ui`
- `inspect_ui`
- `act_ui`
- `read_text`
- `wait_for`
- `launch_browser`
- `navigate_browser`
- `evaluate_browser`

The included `omp-computer-use` skill teaches OMP the state/ref workflow automatically.

## Configuration

User configuration:

```text
~/.omp/agent/extensions/omp-computer-use.json
```

Project configuration:

```text
<project>/.omp/computer-use.json
```

Example:

```json
{
  "browser_use": true,
  "headless": false,
  "cursor_overlay": true
}
```

Project settings override user settings. `PI_COMPUTER_USE_BROWSER_USE`, `PI_COMPUTER_USE_HEADLESS`, and `PI_COMPUTER_USE_CURSOR_OVERLAY` override both. See [Configuration](./docs/configuration.md) for details.

## Development

```bash
bun install
bun run test
```

Additional platform checks:

```bash
bun run test:platform
bun run test:windows-scripts
```

See:

- [Usage](./docs/usage.md)
- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Development](./docs/development.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Contributing](./CONTRIBUTING.md)

## Upstream

This project is an OMP-native port of [`injaneity/pi-computer-use`](https://github.com/injaneity/pi-computer-use). It preserves the upstream native helpers, state model, and MIT license while replacing the host integration, package metadata, paths, approval policy, runtime guidance, and Bun lifecycle for Oh My Pi.

## License

MIT
