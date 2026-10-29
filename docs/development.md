# Develop pr-stats

The terminal interface uses OpenTUI and React. The source lives under `src/`, and the published executable loads the bundles in `dist/`.

## Run from source

Install pnpm and Bun, then run these commands from the repository root.

```bash
pnpm install
pnpm tui
```

`pnpm tui` runs `bun src/tui/main.tsx`. To run with Node.js 26.4+, use `pnpm tui:node`, which builds the app first.

To use test data instead of GitHub, run the app with the bundled fake `gh` executable.

```bash
bun src/tui/main.tsx --debug src/tui/testdata
```

Debug mode ignores GitHub tokens and disables cache and settings persistence.

The debug path can name a directory containing a `gh` executable, or the executable itself. See [test data](../src/tui/testdata) for the fixtures and [startup configuration](../src/tui/bootstrap.ts) for debug behavior.

## Run checks

| Command                                            | Purpose                           |
| -------------------------------------------------- | --------------------------------- |
| `pnpm check`                                       | Check TypeScript types.           |
| `pnpm lint`                                        | Run the source linters.           |
| `pnpm test`                                        | Run the Bun tests.                |
| `bun test src/tui`                                 | Run the terminal interface tests. |
| `pnpm exec prettier --check README.md 'docs/*.md'` | Check documentation formatting.   |

## Build the app

```bash
pnpm build
```

The build creates `dist/tui.mjs` as the launcher and `dist/tui-app.mjs` as the app bundle. The launcher supports Bun and Node.js.

Under Bun, the launcher loads the app directly. Under Node.js, it restarts with `--experimental-ffi` when needed for OpenTUI's native rendering. If Node.js is too old, it tries Bun before reporting the runtime requirement.

See [the launcher](../src/tui/launch.ts) and [build scripts](../package.json).

## Build the macOS notifier

The notification helper lives in [native/macos](../native/macos). Building it requires macOS and the Xcode command line tools.

```bash
pnpm build:notifier
```

The script creates `dist/pr-stats.app` as a universal bundle for Apple Silicon and Intel, with an ad hoc signature. The publish workflow builds it on macOS and includes it in the package.

The bundle identifier `dev.d3lm.pr-stats.notifier` controls notification permission and must stay the same across releases. Source checkouts without the bundle use `osascript` instead, so the helper is not required for other development work.

See [the notifier build script](../scripts/build-notifier.sh) and [notification configuration](configuration.md#configure-notifications).
