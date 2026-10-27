# Animotive Test Dashboard

A static, dependency-free dashboard that visualizes Playwright test-run results from the
[`animotive_playwright_tests`](https://github.com/MLeslie-Retinize/animotive_playwright_tests)
CI pipeline. It's a single `index.html` page backed by JSON files in `data/`, designed to be
served directly via GitHub Pages.

## Features

- **Latest run summary** — pass rate, status, and per-status test counts at a glance
- **Pass rate trend** — history chart with selectable ranges (5 / 14 / 30 / 60 runs / all)
- **Top failing tests** — most frequent offenders over a chosen range
- **Flaky tests** — tests that pass only after retries, ranked by frequency
- **Pass rate by spec file** — coverage overview per spec
- **Failure diff** — new, persistent, and recovered failures between the two most recent runs
- **Run history table** — every recorded run (paginated), with links to the GitHub Actions run
- **Test details dialog** — click a chart entry or history row to see full test info (status,
  duration, retries, error message)
- Click a commit hash to copy it to the clipboard

## Architecture

```
index.html                     # The entire dashboard (HTML + CSS + JS in one file)
backfill.js                    # One-time script: pull last 30 days of runs from GitHub Actions
data/
  index.json                   # Lightweight metadata for every run (stats only, no test list)
  runs/
    <date>-<runId>.json        # Full per-run data, including every test result
assets/                        # Favicon / logo images
.nojekyll                      # Tells GitHub Pages not to process the site with Jekyll
```

- `index.html` fetches `data/index.json` on load, then lazily downloads `data/runs/<id>.json`
  only when a run's details are needed (kept in an in-memory cache).
- Charts are rendered with [Chart.js 4](https://www.chartjs.org/) loaded from a CDN.
- No build step, no npm dependencies, no server required — any static file host works.

## Data format

Each run file in `data/runs/` follows this shape:

```json
{
  "id": "2026-10-27-40466124850",
  "date": "2026-10-27",
  "timestamp": "2026-10-27T08:23:34.186Z",
  "branch": "main",
  "commit": "26e1f89c…",
  "workflowUrl": "https://github.com/…/actions/runs/40466124850",
  "status": "failed",
  "stats": { "total": 279, "passed": 259, "failed": 12, "flaky": 2, "skipped": 6 },
  "tests": [
    {
      "title": "log out user from settings page",
      "fullTitle": "specs/account_settings_tests.spec.ts > … > log out user…",
      "file": "specs/account_settings_tests.spec.ts",
      "project": "chromium",
      "status": "passed",
      "duration": 3706,
      "retries": 0,
      "flaky": false,
      "errorMessage": null
    }
  ]
}
```

`data/index.json` is an array of the same objects with `tests` omitted (stats only), so the
page stays fast even with hundreds of runs.

## Running locally

Any static server works. For example:

```bash
# Python
python -m http.server 8000

# Node
npx serve .
```

Then open <http://localhost:8000>. Opening `index.html` directly via `file://` won't work
because the dashboard uses `fetch()` to load the data files.

## Backfilling historical runs

`backfill.js` is a one-off script that pulls the last 30 days of completed workflow runs from
GitHub Actions, downloads the `playwright-report` / `test-results` artifacts, normalizes them,
and writes them into `data/runs/` plus `data/index.json`.

```bash
GITHUB_TOKEN=ghp_xxxx node backfill.js
```

- `GITHUB_TOKEN` (required) — token with access to the source repo's Actions artifacts
- `GITHUB_REPOSITORY` (optional) — source repo, defaults to
  `MLeslie-Retinize/animotive_playwright_tests`

Existing run files are skipped, so the script is safe to re-run.

## Adding new runs

CI commits new run data to this repo (commits of the form `ci: add run <date>-<id>`). Each new
run adds one file under `data/runs/` and one entry at the top of `data/index.json`. GitHub
Pages then serves the updated dashboard automatically.

## Deployment

Served via GitHub Pages from the repository root (the `.nojekyll` file disables Jekyll
processing). No build or deployment step is needed beyond pushing to the default branch.
