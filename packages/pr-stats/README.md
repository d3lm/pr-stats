# pr-stats

Prints statistics for a GitHub user, e.g., time to review or size of authored PRs. It works with any repository your GitHub login can see.

## Requirements

You need Node 20 or newer and one of two ways to authenticate.

- An authenticated gh CLI. Run `gh auth login` if you have not set that up yet.
- A GitHub access token, passed through `--token` or the `GITHUB_TOKEN` or `GH_TOKEN` environment variable. When a token is present, the tool calls the GitHub API directly and does not need the gh CLI at all. The token needs the `repo` scope to see private repositories.

## Install

```sh
npm install -g @d3lm/pr-stats
```

You can also run it without installing through `npx @d3lm/pr-stats`.

## Usage

```sh
pr-stats
```

Without flags, it looks at PRs from the last 90 days across all repositories you can access. It reports how quickly you finish review requests and how large your authored PRs are. The `--reports` flag picks which of these run. The size report includes three charts, a log-bucketed size histogram, a quantile strip per metric, and a line chart of PR sizes over time. The `--charts` flag picks which of them get printed.

```sh
# Limit the search to one repository and a start date
pr-stats --repo owner/name --since 2026-01-01

# Run only the time-to-review analysis
pr-stats --reports review-time

# Report how many reviews finished within one working day
pr-stats --work-hours 9-17 --target 1d

# Report how many authored PRs stayed under 400 changed lines
pr-stats --size-target 400

# Print only the size histograms and skip the other charts
pr-stats --charts histogram

# Print no size charts at all
pr-stats --charts none

# Authenticate with an access token instead of the gh CLI
pr-stats --token ghp_yourtoken
```

Run `pr-stats --help` for the full list of options.
