# Understand data handling

## Fetch PR data

The app searches for reviewed PRs, outstanding review requests, authored PRs, and mentions. It then fetches PR details in batches through GraphQL. Open review requests have no age limit. Statistics use the configured `since` window.

GitHub search excludes repositories that your account or token cannot access. This can produce an empty view without an error. See the [token requirements](../README.md#use-a-github-token) and use `--repo owner/name` to expose access errors for a specific repository.

Searches run sequentially, with paced requests for each page. The default policy allows 25 search requests per minute and retries rate-limited requests up to three times. The header shows a countdown during a wait. If requests still fail, the app keeps the previous data and asks you to reload later.

Narrow the search with `--repo` or `--since` when loads take too long. See [GitHub access](../src/github.ts) for search queries, pagination, and retry behavior, and [data loading](../src/tui/data/load.ts) for load coordination.

## Cache and saved state

Closed and merged PRs are cached individually. Searches and the review data of open PRs are fetched again on each load, and the mention data of a PR is fetched again only when GitHub reports new activity on it. The app also saves the last successful load, so the next session can display data while it refreshes.

The cache directory is `~/Library/Caches/pr-stats` on macOS. Elsewhere, it is `$XDG_CACHE_HOME/pr-stats` or `~/.cache/pr-stats`. `PR_STATS_CACHE_DIR` overrides the location.

`--no-cache` skips cache reads for one run, but fresh results still update the cache. Settings can disable cache reads for every run. Clear cache removes cached PR data, your cached login and team membership, the saved last load, and the mention baseline. It keeps saved filters, settings, snoozes, and mention read state.

`settings.json` stores app configuration. `mention-reads.json` stores mention read state per account. `snoozes.json` stores snoozes, and `teams.json` caches team membership for six hours.

See [cache storage](../src/cache.ts) for persistence and clearing behavior.

## Track mentions

A mention is your login after `@` in text from someone else, in any letter case, where a longer login that starts the same way does not count. The app examines PR descriptions, comments, reviews, and inline review comments. Code spans, code blocks, and HTML comments do not count. Your own PRs, drafts, and closed or merged PRs can contain mentions.

The first load establishes a baseline, so only later mentions appear as unread. The baseline survives restarts. A new mention on a read PR makes it unread again, but editing text that you already handled does not.

`trackMentions` is on by default. It adds one search for PRs updated within the `since` window. The search combines GitHub's mentions index, which covers PR descriptions and conversation comments, with a text search for your login on the PRs you are involved in, which also reaches reviews and inline review comments. A mention in a review of a PR you are not otherwise involved in stays out. Turning tracking off hides the inbox and removes its baseline.

Press `d` in Mentions to mark a PR read or unread. Press `D` to mark all visible unread mentions read. An unread mention on a PR in your review queue adds an `@` badge.

See [mention extraction](../src/data.ts) and [read state](../src/mentions.ts) for the matching and persistence rules.

## Track team requests

Awaiting review has a Requested of your team section. It lists requests for teams you belong to and names each team. A direct request for you takes precedence. A team request leaves the section when you or a teammate reviews the PR.

`teamReviews` enables this section by default. Team membership uses a six-hour cache, and `R` refreshes it immediately. The lookup needs `read:org` on a classic token or read access to organization members on a fine-grained token. Without permission, the lookup fails quietly.

`teamReviewStats` includes team reviews in the Review time sub-tab of Stats. It is off by default, so review times measure requests that name you directly. The JSON export includes `reviewedTeam` and `pendingTeam` regardless of this setting.

## Snooze requests and mentions

Press `s` to snooze the selected request or mention. Enter a duration such as `30m`, `2h`, `1d`, or `1w`, up to four weeks. The dialog starts with `snoozeDuration`.

The item moves to a Snoozed list with its wake-up time. Press `s` there to end its snooze. Press `d` on a snoozed mention to mark it read and end its snooze.

When a snooze expires, an item that still awaits you returns with a notification if notifications are enabled. A review, merge, or closure ends a request snooze quietly. A repeated review request or a newer mention ends the corresponding snooze. Snoozes survive cache clearing and expire on startup if their wake-up time passed while the app was closed.

See [snooze handling](../src/snooze.ts) for duration parsing and wake-up rules.

## Export JSON

`--json` writes the report to standard output. Progress goes to standard error, so piping the report does not mix data with progress messages.

```bash
pr-stats --json | jq '.review.reviewTimeHours'
```

The report contains the `review` and `authored` objects with summaries and entries for individual PRs, and a `comments` object with comment totals and a per-PR summary, next to the user, the window, the repositories, and the options it covers. Summaries contain `count`, `mean`, `p50`, `p90`, `min`, and `max`. The `p50` and `p90` values are the 50th and 90th percentiles. Durations respect the configured work schedule or elapsed-time mode.

The export action in settings writes the same report to `pr-stats.json`. See [the report schema and export code](../src/tui/data/export.ts) for the full structure.
