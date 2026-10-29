# Configure pr-stats

Press `o` to edit filters and targets. Targets and the work schedule apply at once. A changed search filter (since, repositories, user, drafts, or review types) applies on the next reload with `r`. Press `s` in that dialog to save the values. Command-line flags override saved values. Run `pr-stats --help` for the full flag reference.

Press `S` to open settings. Changes save automatically to `settings.json` in the [cache directory](data.md#cache-and-saved-state). You can also edit this file directly.

## Set filters and targets

`--since` accepts an ISO date or a relative value such as `30d`, `8w`, `6m`, or `1y`. It defaults to `90d`. Older open requests still appear in the awaiting queue, but their completed reviews stay outside the statistics.

Repeat `--repo` to include several repositories. Use `owner/name`, or a bare name that resolves against the repository owner in your current directory. Use `--user <login>` to report on another user.

Review durations count all hours on Monday through Friday by default. `--work-days`, `--work-hours`, and `--tz` define your work schedule. `--wall-clock` counts all elapsed time.

```bash
# Measure reviews against one working day in Berlin.
pr-stats --work-days mon-fri --work-hours 9-17 --tz Europe/Berlin --target 1d

# Count only approvals and requests for changes as reviews.
pr-stats --review-types approve,request-changes

# Set limits for changed lines and files.
pr-stats --size-target 400l,20f
```

`--target` accepts hours, minutes, or days, such as `24h`, `90m`, or `2d`. A day means 24 counted hours, or one working day when `--work-hours` is set. Pending requests that already exceed the target count as misses.

`--target-percentile` defaults to `90`, which compares your target against the time within which 90% of reviews finish. It accepts a whole number from 1 to 100, with an optional `p` prefix.

`--size-target` accepts a line limit, a file limit, or both. Changed lines include additions and deletions. `--review-types` accepts `approve`, `comment`, and `request-changes`. A review outside the selected types does not answer a request, so the PR remains in the awaiting queue.

## Edit settings

This example enables automatic reloads and notifications.

```json
{
  "autoReload": true,
  "reloadInterval": "10m",
  "openIn": "github",
  "copyLinks": false,
  "notifications": true,
  "notifyMentions": true,
  "notifyTeamReviews": false,
  "notifyChannel": "auto",
  "trackMentions": true,
  "teamReviews": true,
  "teamReviewStats": false,
  "snoozeDuration": "30m",
  "theme": { "preset": "default" }
}
```

## Reload automatically

`autoReload` enables background reloads. `reloadInterval` sets the wait between loads, such as `30s`, `10m`, or `2h`. The header shows the interval while automatic reloads are active.

## Open links

`openIn` selects `github` or `linear` for PR links. The latter opens Linear Diffs at `linear.review`, which requires Diffs to be enabled in your Linear workspace. `copyLinks` makes PR links copy to the clipboard instead. Copied links always point to GitHub.

## Configure notifications

`notifications` enables desktop notifications for new or repeated review requests. Each load compares requests against the previous data. The first load compares against the previous session, so restarting can report requests that arrived while the app was closed.

`notifyMentions` adds notifications for new mentions and requires `trackMentions`. Editing text that already mentions you does not send another notification. `notifyTeamReviews` adds notifications for new team requests and requires `teamReviews`.

`notifyChannel` selects how the app sends notifications.

| Value      | Behavior                                                                        |
| ---------- | ------------------------------------------------------------------------------- |
| `auto`     | Try the terminal notification sequence, then fall back to the platform command. |
| `terminal` | Use the terminal notification sequence.                                         |
| `command`  | Use the platform command.                                                       |
| `bell`     | Ring the terminal bell.                                                         |

Use Send test notification in settings to try the selected channel. In editor terminals such as VS Code, select `command` for desktop notifications instead of an editor toast.

### Configure terminal permissions

iTerm2, Kitty, Ghostty, WezTerm, and most VTE terminals support the terminal channel. In iTerm2, enable Notification Center Alerts under Settings → Profiles → Terminal. Under Filter Alerts, enable Send escape sequence-generated alerts. The advanced setting Omit session identifier from notifications removes the session name prefix.

Apple Terminal uses the platform command. On macOS, the command runs the bundled `dist/pr-stats.app`, which requests notification permission on its first send. Manage this permission in System Settings → Notifications.

A source checkout without that bundle falls back to `osascript`. These notifications appear under Script Editor and need its notification permission. On Linux, the command uses `notify-send`. Send failures appear in the footer.

## Customize colors

The built-in presets are `default` (warm amber), `green`, `blue`, `purple`, and `yellow`. The Theme row cycles through them. Edit colors creates a `custom` preset.

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

`base` selects the built-in preset for colors that you do not override. The color keys are `bg`, `border`, `text`, `muted`, `dim`, `accent`, `selectedBg`, `inputBg`, `inputFocusedBg`, `warn`, `error`, and `success`. Chart colors use `chartBar`, `chartLine`, `chartDim`, and `heat`. The `heat` value contains four colors from cool to hot.

An invalid key or color prevents startup and produces an error that names the problem.
