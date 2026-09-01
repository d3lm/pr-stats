# pr-stats

An interactive terminal UI for GitHub PR statistics, built with [OpenTUI](https://github.com/anomalyco/opentui) and React. It shows time to review, PR size, and comment stats for any repository your GitHub login can see, plus a live queue of the PRs waiting on you.

![pr-stats](./assets/screenshot.png)

## Requirements

- Node 26.4+ or Bun 1.3+. The TUI renders through native FFI. Node gates that behind `--experimental-ffi`, and the launcher re-executes itself with the flag, so a plain `pr-stats` works on both runtimes.
- Either an authenticated gh CLI (`gh auth login`) or a GitHub access token via `--token`, `GITHUB_TOKEN`, or `GH_TOKEN`. With a token, the tool calls the GitHub API directly and does not need the gh CLI. See [Tokens](#tokens) for the access a token needs.

## Install

```bash
npm install -g @d3lm/pr-stats
```

You can also run it without installing through `npx @d3lm/pr-stats` or `bunx --bun @d3lm/pr-stats`.

## Usage

```bash
pr-stats
```

Without flags, it covers PRs from the last 90 days across all repositories you can access.

- **Queue** lists the open PRs awaiting your review with their wait time, and below them the open PRs you already reviewed. A fresh review request moves a PR back into the awaiting list.
- **Your PRs** splits into your open PRs and a merged-and-closed report with merge-time, first-review, backlog, and outcome charts plus a reviewer leaderboard. The `t` key switches the sub-tabs.
- **Time to review** charts your review times as a histogram, trend, heatmap, and weekly volume, plus review cycles, verdicts, an off-hours gauge, and the requests still waiting on you.
- **PR size** carries the same charts for PR sizes and adds a weekly net-lines trend.
- **Comments** holds a histogram of comments per PR, a scatter against PR size, and the most commented PRs.

When the data spans multiple repos, every tab opens on a repo picker that drills into one repo or the aggregate. On the queue lists, `g` groups the aggregate by repo, and on stats tabs, `x` lifts the row cap on comparison cards.

## Options

All flags pre-seed the options modal. Run `pr-stats --help` for full details.

| Flag                          | Default   | Description                                                                                                      |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `-s, --since <value>`         | `90d`     | Only include PRs created after this point. Accepts an ISO date or a relative value like `30d`, `8w`, `6m`, `1y`. |
| `-r, --repo <name>`           | all repos | Restrict the search to a repository, repeatable. Accepts `owner/name` or a bare name.                            |
| `-u, --user <login>`          | you       | Compute stats for this user instead of the authenticated one.                                                    |
| `--token <token>`             |           | Authenticate with a GitHub access token instead of the gh CLI.                                                   |
| `-t, --target <value>`        |           | Report how many reviews finished within this time, like `24h`, `2d`, or `90m`.                                   |
| `--target-percentile <value>` | `90`      | Check the target against this percentile of your review times, like `90` or `p90`.                               |
| `--size-target <value>`       |           | Report how many authored PRs fit within this size, like `400`, `400l`, `20f`, or `400l,20f`.                     |
| `--tz <zone>`                 | system    | Set the IANA timezone for the weekend and working-hours math.                                                    |
| `--work-days <days>`          | `mon-fri` | Count only these days as working days, like `mon-fri`, `sun-thu`, or `mon,wed,fri`.                              |
| `-w, --work-hours <value>`    | `0-24`    | Count only these working hours, like `9-17`, `8:30-16:30`, or `9am-6pm`.                                         |
| `--wall-clock`                | off       | Measure raw elapsed time, including weekends.                                                                    |
| `--include-drafts`            | off       | Include PRs that are currently drafts.                                                                           |
| `--review-types <list>`       | all       | Count only these review types. Takes a comma-separated list of `approve`, `comment`, and `request-changes`.      |
| `--no-cache`                  | off       | Refetch every PR instead of reading the disk cache.                                                              |
| `--json`                      | off       | Print every stat as JSON to stdout instead of starting the TUI.                                                  |
| `--debug <path>`              |           | Serve canned data from a fake `gh` binary in a testdata directory.                                               |
| `-h, --help`                  |           | Show the help page.                                                                                              |

A few examples:

```bash
# Limit the search to one repository and a start date
pr-stats --repo owner/name --since 2026-01-01

# Report how many reviews finished within one working day
pr-stats --work-hours 9-17 --target 1d

# Count only approvals and change requests as reviews
pr-stats --review-types approve,request-changes
```

## Tokens

The `--token` flag and the `GITHUB_TOKEN` and `GH_TOKEN` environment variables switch the tool from the gh CLI to direct GitHub API calls. The PR list comes from the GitHub search API, which silently leaves out every repository the token cannot see, so a token with too little access shows an empty view instead of an error.

A classic token needs the `repo` scope, or `public_repo` when every repository is public.

A fine-grained token needs more care, because it only covers one resource owner and only the repositories you select for it.

- Pick the organization as the resource owner when the PRs live in an organization's repositories. A token owned by your user account never sees them.
- Grant access to all repositories or select the ones you care about. The public repositories option hides every private one.
- Grant read access to `Metadata`, `Pull requests`, and `Contents`. Searching pull requests in private repositories needs `Contents` on top of `Pull requests`, even though GitHub's permission tables do not mention it.
- Ask an organization owner to approve the token when the organization requires approval for fine-grained tokens. Until then, the token sees nothing in that organization.

To check a token, run `pr-stats --token <token> --repo owner/name` against a repository you expect to see. Naming the repository makes the search fail with a `422 Validation Failed` error when the token cannot see it, where a search without `--repo` would just return nothing.

## JSON export

The `--json` flag prints the full report to stdout instead of starting the TUI. Every other flag applies the same way, and progress renders on stderr, so a piped stdout stays pure JSON.

```bash
pr-stats --json | jq '.review.reviewTimeHours'
```

The report holds a `review`, `authored`, and `comments` object with one entry per PR. Summaries report the count, mean, p50, p90, min, and max, and every duration respects the configured time mode. The settings dialog has an export row that writes the same report to `pr-stats.json` in the current directory.

## Caching

Closed and merged PRs are cached on disk per PR, because their timelines and sizes no longer change. Searches and open PRs are fetched fresh on each run. The TUI also snapshots the last successful load, so a later start with the same options renders instantly while the real load refreshes in the background.

The cache lives in `~/Library/Caches/pr-stats` on macOS and in `$XDG_CACHE_HOME/pr-stats` or `~/.cache/pr-stats` elsewhere. The `PR_STATS_CACHE_DIR` environment variable overrides the location. `--no-cache` skips every cache read for one run, and the settings dialog can disable the cache permanently.

The options modal saves the current options to the cache directory with the `s` key. Later runs start from the saved options wherever no flag was given, and flags always take precedence.

## Auto Reload

The `r` key reloads the data by hand, and `R` refetches everything past the cache. The TUI can also keep itself fresh while it stays open. The Auto reload row in the settings dialog turns background reloads on, and the Reload interval row below it sets how long the TUI waits after one load finishes before the next one starts, as a value in seconds, minutes, or hours like `30s`, `10m`, or `2h`. The header shows the interval next to the refresh time while it is on. Both settings persist in `settings.json` in the cache directory.

```json
{
  "autoReload": true,
  "reloadInterval": "10m"
}
```

## Notifications

The Desktop notifications row in the settings dialog makes the TUI send a desktop notification whenever a load finds a PR newly awaiting your review or a review re-requested from you after you already reviewed the PR. Every load diffs its review requests against the load before it, so the first load of a session only records what is already waiting and never notifies about it. Manual reloads count as well, but the feature pairs naturally with auto reload, which lets the TUI watch your review queue from a spare terminal. The setting persists in `settings.json` in the cache directory.

```json
{
  "notifications": true,
  "notifyChannel": "auto"
}
```

Notifications go through the terminal itself when it supports a notification escape sequence, which covers iTerm2, Kitty, Ghostty, WezTerm, and most VTE-based terminals like GNOME Terminal. The terminal posts the notification under its own notification permission and the sequence travels through SSH, so this path needs no setup. Some terminals only show the banner while their window is unfocused. Terminals without such support get the platform's own command instead, `osascript` on macOS and `notify-send` on Linux. A notification that fails to send reports in the footer, for example when `notify-send` is missing on a Linux machine.

The "Notification channel" row picks the path, and the choice persists as `notifyChannel` with the values `auto`, `terminal`, and `command`. On `auto` the TUI tries the terminal first and falls back to the platform command, while the other two force one path. The dialog shows the `command` value as the command's name on this platform. Forcing the command pays off inside editor terminals like the one in VS Code, which render the terminal path as a small in-editor toast instead of a system notification. The "Send test notification" row below it names the channel the next send takes and sends a sample notification, so you can check that your desktop displays it before relying on it.

The macOS fallback posts through the built-in Script Editor, and since macOS 15 those notifications stay invisible until Script Editor holds notification permission, without any prompt appearing. To grant it once, open the Script Editor app, run the one-line script `display notification "test"`, and allow the prompt that appears. Script Editor then shows up under Notifications in the System Settings like any other app.

## Theming

The TUI ships five built-in themes, the warm amber default plus green, blue, purple, and yellow variants. The Theme row in the settings dialog cycles through them, and the Edit colors row below it edits individual colors, which creates a custom theme that joins the cycle as a sixth entry. Everything persists in a `theme` object in `settings.json` in the cache directory, which you can also edit by hand.

```json
{
  "theme": {
    "preset": "custom",
    "base": "blue",
    "accent": "#89b4f0",
    "heat": ["#32475c", "#49688a", "#5f92c0", "#89b4f0"]
  }
}
```

The `preset` key names the active theme, one of `default`, `green`, `blue`, `purple`, `yellow`, and `custom`. The `base` key names the built-in theme the custom colors start from. The color keys are `bg`, `border`, `text`, `muted`, `dim`, `accent`, `selectedBg`, `inputBg`, `inputFocusedBg`, `warn`, `error`, `success`, `chartBar`, `chartLine`, `chartDim`, and `heat`, where `heat` takes four heatmap colors from cool to hot. An invalid key or color fails the start with a message naming the mistake.

## Development

The TUI runs with `bun tui/main.tsx`, or under Node with `pnpm tui:node`. The `--debug tui/testdata` flag serves canned data from the fake `gh` binary in that directory instead of fetching from GitHub, and `bun test tui` drives the whole pipeline against it. `pnpm build` bundles everything into `dist/`, where `tui.mjs` is the launcher and `tui-app.mjs` is the app bundle it loads.

## License

OpenTUI is licensed under the [MIT License](LICENSE).
