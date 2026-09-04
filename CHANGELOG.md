# Changelog

All notable changes to this project are documented in this file.

## [0.2.19](https://github.com/d3lm/pr-stats/releases/tag/v0.2.19) - 2026-09-04

### Bug Fixes

- fix: exclude your own PRs from the review searches ([36633cf](https://github.com/d3lm/pr-stats/commit/36633cf6a808e84ad86397498d1035569a4aae5b))

## [0.2.18](https://github.com/d3lm/pr-stats/releases/tag/v0.2.18) - 2026-09-02

### Bug Fixes

- fix: seed the notification baseline from the startup snapshot ([d3328b2](https://github.com/d3lm/pr-stats/commit/d3328b2a2526b53b9fb109ffd5d2f21cfe9749e1))

## [0.2.17](https://github.com/d3lm/pr-stats/releases/tag/v0.2.17) - 2026-09-02

### Features

- feat: count reviewed PRs apart from review rounds on the Reviews tab ([570e222](https://github.com/d3lm/pr-stats/commit/570e222a2280555732c1a200d15be3f8b796daa1))

## [0.2.16](https://github.com/d3lm/pr-stats/releases/tag/v0.2.16) - 2026-09-02

### Features

- feat: post macOS notifications through a bundled helper app ([3585424](https://github.com/d3lm/pr-stats/commit/35854240f1dbd7430be79f57d2578544971b790e))

### Bug Fixes

- fix: rename the Reviewing queue to Reviewed ([8dbf142](https://github.com/d3lm/pr-stats/commit/8dbf142947973df04bd6ac52875b2b88e67bdd83))

## [0.2.15](https://github.com/d3lm/pr-stats/releases/tag/v0.2.15) - 2026-09-01

### Features

- feat: add bell notification channel and terminal quirk caveats ([cee0e04](https://github.com/d3lm/pr-stats/commit/cee0e0473f5766099c603e23685bcdd7ffb85a1e))

## [0.2.14](https://github.com/d3lm/pr-stats/releases/tag/v0.2.14) - 2026-09-01

### Features

- feat: add auto reload on a configurable interval ([157ffa8](https://github.com/d3lm/pr-stats/commit/157ffa853242d254b2c81eeec3037dcfd9076cf3))
- feat: add desktop notifications for new and re-requested reviews ([35095f6](https://github.com/d3lm/pr-stats/commit/35095f6ec54e81454198cf63fea7bcbc6c743332))

## [0.2.13](https://github.com/d3lm/pr-stats/releases/tag/v0.2.13) - 2026-08-31

### Features

- feat: add --work-days to configure which days count as working days ([f660697](https://github.com/d3lm/pr-stats/commit/f6606975c2b5d6775f6ed34aee427a2d51a9726a))

## [0.2.12](https://github.com/d3lm/pr-stats/releases/tag/v0.2.12) - 2026-08-30

### Features

- feat: show a footer checkmark notice when options are saved ([323c138](https://github.com/d3lm/pr-stats/commit/323c13863842860392195ced04c823d908d55dd3))

## [0.2.11](https://github.com/d3lm/pr-stats/releases/tag/v0.2.11) - 2026-08-30

### Features

- feat: report review target status at a configurable percentile ([a2ffa33](https://github.com/d3lm/pr-stats/commit/a2ffa33c1404d226ec1b2977ba2919c660e02586))

## [0.2.10](https://github.com/d3lm/pr-stats/releases/tag/v0.2.10) - 2026-08-29

### Features

- feat: add --review-types to configure what counts as a review ([3ea69da](https://github.com/d3lm/pr-stats/commit/3ea69da7169a772f45c6fc1df96e57177d877211))

## [0.2.9](https://github.com/d3lm/pr-stats/releases/tag/v0.2.9) - 2026-08-29

### Features

- feat: add JSON export through --json and the settings dialog ([fed6c06](https://github.com/d3lm/pr-stats/commit/fed6c0690711e6e4781b59c82d29657586a57d93))
- feat: chart review time against PR size on the review tab ([916e119](https://github.com/d3lm/pr-stats/commit/916e11995863f955f00b5d899bdf34ddc7da0384))
- feat: measure time to first review received ([eb38b17](https://github.com/d3lm/pr-stats/commit/eb38b170145dabaff60965059a13d5ee2740366a))

## [0.2.8](https://github.com/d3lm/pr-stats/releases/tag/v0.2.8) - 2026-08-28

### Features

- feat: add reviewer leaderboard and review coverage to the merged tab ([ca86871](https://github.com/d3lm/pr-stats/commit/ca868718b48840493cc5b64d6538d4fd8e0e876a))

### Bug Fixes

- fix: resync the scrollbar thumb when the slider clamps its viewport ([4036aff](https://github.com/d3lm/pr-stats/commit/4036affdf8164928507b00cf793ee5a4a8f2aa93))

## [0.2.7](https://github.com/d3lm/pr-stats/releases/tag/v0.2.7) - 2026-08-28

### Features

- feat: add new charts across the review, size, and merged tabs ([796fc84](https://github.com/d3lm/pr-stats/commit/796fc8442bd8e30f77e70dccc6f07364ef637d59))

## [0.2.6](https://github.com/d3lm/pr-stats/releases/tag/v0.2.6) - 2026-08-28

### Features

- feat: split the awaiting-review tab into awaiting and reviewing queues ([f7e9c7f](https://github.com/d3lm/pr-stats/commit/f7e9c7fbafc3d2a2eec8208863f3be7a7a58055d))

## [0.2.5](https://github.com/d3lm/pr-stats/releases/tag/v0.2.5) - 2026-08-28

### Features

- feat: show a spinner next to indeterminate load phases ([a41e881](https://github.com/d3lm/pr-stats/commit/a41e881d28c01933ddb246f6a4f11f8a25f53590))
- feat: label the heatmap hour axis at 3-hour intervals ([d947785](https://github.com/d3lm/pr-stats/commit/d947785c379b06e497649e59125779d8215d60ba))

## [0.2.4](https://github.com/d3lm/pr-stats/releases/tag/v0.2.4) - 2026-08-28

### Bug Fixes

- fix: copy links through OpenTUI's clipboard service instead of xclip ([15be4ee](https://github.com/d3lm/pr-stats/commit/15be4ee3ad3defc3c9292b9063ac44e644182248))

## [0.2.3](https://github.com/d3lm/pr-stats/releases/tag/v0.2.3) - 2026-08-28

### Bug Fixes

- fix: keep a broken clipboard pipe from quitting the TUI ([0f268fc](https://github.com/d3lm/pr-stats/commit/0f268fca24cf31e5c958111e35e5db96b970a27d))

## [0.2.2](https://github.com/d3lm/pr-stats/releases/tag/v0.2.2) - 2026-08-28

### Features

- feat: split the Your PRs tab into open and merged sub-tabs ([101d53c](https://github.com/d3lm/pr-stats/commit/101d53c9b5f2949ee8a6f880d57428953492320d))

## [0.2.1](https://github.com/d3lm/pr-stats/releases/tag/v0.2.1) - 2026-08-27

### Features

- feat: add setting to copy PR links instead of opening them ([0b741ef](https://github.com/d3lm/pr-stats/commit/0b741efb38ad9c5ebda7b16af8d23162d311857b))

## [0.2.0](https://github.com/d3lm/pr-stats/releases/tag/v0.2.0) - 2026-08-27

### Features

- feat: initial commit ([e0b844a](https://github.com/d3lm/pr-stats/commit/e0b844ad744ec98e19ebc5339108e937220b45e5))
- feat: re-organize workspace ([243644b](https://github.com/d3lm/pr-stats/commit/243644b80baea091264d91b38da2ea491df1ba15))
- feat: drop spark chart from default chart output ([21bc06a](https://github.com/d3lm/pr-stats/commit/21bc06a9cc339ac6207a5ca6e6da2050e4b0c7db))
- feat: accept 12-hour am/pm ranges in --work-hours ([f27562a](https://github.com/d3lm/pr-stats/commit/f27562ae0af8a474933d2bcaa72edc8b1c3750ec))
- feat: implement interactive TUI ([635eab0](https://github.com/d3lm/pr-stats/commit/635eab000d4e7c1fcc34a51aeb60a8acc418c011))
