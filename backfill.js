#!/usr/bin/env node
/**
 * backfill.js
 *
 * One-time backfill script to ingest the last 30 days of Playwright test runs
 * from GitHub Actions artifacts into the dashboard data folder.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxxx node backfill.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || 'MLeslie-Retinize/animotive_playwright_tests';

if (!GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN env var not set.');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data', 'runs');
const INDEX_FILE = path.join(__dirname, 'data', 'index.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// GitHub API helper
function githubRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'BackfillScript/1.0',
      },
    };

    https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API ${res.statusCode}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    }).on('error', reject).end();
  });
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }, (res) => {
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Normalize run data (simplified)
function normalizeRun(data, id, timestamp, branch, commit, url) {
  const tests = [];
  let stats = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };

  if (data?.suites) {
    function walk(suite, path = []) {
      const nextPath = suite.title ? [...path, suite.title] : path;
      if (suite.specs) {
        for (const spec of suite.specs) {
          if (spec.tests) {
            for (const test of spec.tests) {
              const results = test.results || [];
              let status = test.status || test.outcome || 'unknown';
              const flaky = test.outcome === 'flaky' || (results.length > 1 && status === 'passed');

              tests.push({
                title: spec.title,
                fullTitle: [...nextPath, spec.title].join(' > '),
                file: suite.file || '',
                status,
                duration: results[results.length - 1]?.duration || 0,
                retries: results.length - 1,
                flaky,
                errorMessage: null,
              });

              stats.total++;
              if (status === 'passed' && !flaky) stats.passed++;
              else if (status === 'failed') stats.failed++;
              else if (flaky) stats.flaky++;
              else if (status === 'skipped') stats.skipped++;
            }
          }
        }
      }
      if (suite.suites) {
        for (const child of suite.suites) walk(child, nextPath);
      }
    }
    for (const suite of data.suites) walk(suite);
  }

  return {
    id, date: id.split('-').slice(0, 3).join('-'), timestamp, branch, commit,
    workflowUrl: url, status: stats.failed > 0 ? 'failed' : 'passed', stats, tests,
  };
}

// Main
async function run() {
  console.log(`[backfill] Fetching last 30 days of runs from ${REPO}…`);

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const runsResp = await githubRequest(
  `/repos/${REPO}/actions/runs?per_page=100&status=completed`
);
    const allRuns = runsResp.workflow_runs || [];
    const runs = allRuns.filter(run => new Date(run.created_at) >= since);
    console.log(`[backfill] Found ${runs.length} runs.`);

  let added = 0;
  for (const run of runs) {
    const id = `${run.created_at.slice(0, 10)}-${run.id}`;
    const file = path.join(DATA_DIR, `${id}.json`);

    if (fs.existsSync(file)) {
      console.log(`  ✓ ${id} exists`);
      continue;
    }

    console.log(`  ⟳ ${id}…`);

    try {
      const artsResp = await githubRequest(`/repos/${REPO}/actions/runs/${run.id}/artifacts`);
      let data = { suites: [] };

      for (const art of artsResp.artifacts || []) {
        if (['playwright-report', 'test-results'].includes(art.name)) {
          const buf = await downloadFile(art.archive_download_url);
          // For now, assume the artifact contains JSON data directly
          try {
            data = JSON.parse(buf.toString('utf8'));
            break;
          } catch (e) {
            // Couldn't parse as JSON
          }
        }
      }

      const norm = normalizeRun(
        data, id, run.created_at, run.head_branch, run.head_commit?.id, run.html_url
      );

      fs.writeFileSync(file, JSON.stringify(norm, null, 2));
      console.log(`    ✓ Added (${norm.stats.passed}p ${norm.stats.failed}f)`);
      added++;
    } catch (e) {
      console.log(`    ✗ ${e.message}`);
    }
  }

  // Update index
  if (added > 0) {
    let index = [];
    if (fs.existsSync(INDEX_FILE)) {
      index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    }

    const newFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    const merged = [];
    for (const file of newFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
      if (!merged.find(e => e.id === data.id)) {
        merged.push({
          id: data.id,
          date: data.date,
          timestamp: data.timestamp,
          branch: data.branch,
          commit: data.commit,
          workflowUrl: data.workflowUrl,
          status: data.status,
          stats: data.stats,
        });
      }
    }

    merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    fs.writeFileSync(INDEX_FILE, JSON.stringify(merged, null, 2));
  }

  console.log(`[backfill] Done. Added ${added} runs.`);
}

run().catch(e => { console.error(e); process.exit(1); });