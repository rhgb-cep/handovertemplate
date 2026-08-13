#!/usr/bin/env node
// ============================================================================
// check-redirects.mjs — verify the Substack redirect map before we cut over
// ============================================================================
//
// WHY THIS EXISTS
// public/_redirects forwards two years of old Substack URLs to
// news.educationprogress.org. If it is wrong, nothing errors — links just
// quietly stop working. This script proves it works before launch day
// instead of after.
//
// It reads public/_redirects directly, so that file stays the single source
// of truth. Edit the rules there; this script tests whatever is there now.
//
// ---------------------------------------------------------------------------
// HOW TO RUN IT  (needs Node 18 or newer — check with: node --version)
// ---------------------------------------------------------------------------
//
// STEP 1 — Take the inventory. Do this BEFORE cutover; it reads Substack's
//          archive API, which stops answering on this domain after the swap.
//
//     node scripts/check-redirects.mjs --inventory
//
//          Writes data/substack-urls.json — every published post URL plus the
//          standard Substack paths. Commit it. It is the launch checklist.
//
// STEP 2 — Dry run against the Cloudflare Pages preview URL, before cutover.
//          Find the preview URL in the Cloudflare dashboard; it looks like
//          https://abc123.ep-website.pages.dev
//
//     node scripts/check-redirects.mjs --base https://abc123.ep-website.pages.dev
//
//          This checks that each old URL returns a 301 pointing at the right
//          destination. It does NOT check that the destination loads, because
//          news.educationprogress.org isn't serving yet. That's expected.
//
// STEP 3 — After cutover, run it against the real domain with --follow, which
//          additionally confirms each destination actually returns a page.
//
//     node scripts/check-redirects.mjs --base https://educationprogress.org --follow
//
//          Every line should say OK. Any FAIL is a broken link somebody in
//          the world is going to click.
//
// Exits with code 1 if anything fails, so it can gate a deploy later.
// ============================================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REDIRECTS_FILE = resolve(ROOT, 'public/_redirects');
const INVENTORY_FILE = resolve(ROOT, 'data/substack-urls.json');

// The domain Substack currently serves. Used only for taking the inventory.
const SUBSTACK_ORIGIN = 'https://www.educationprogress.org';

// How many requests to have in flight at once. Kept low deliberately — we are
// hitting someone else's server and there is no prize for finishing fast.
const CONCURRENCY = 6;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const getFlag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

// ---------------------------------------------------------------------------
// Reading public/_redirects
// ---------------------------------------------------------------------------

/**
 * Parse the _redirects file into rules we can apply ourselves.
 * Blank lines and anything starting with # are comments.
 */
export async function loadRules() {
  const text = await readFile(REDIRECTS_FILE, 'utf8');
  const rules = [];

  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;

    const [from, to, status] = line.split(/\s+/);
    if (!from || !to) {
      console.warn(`  warning: line ${i + 1} of _redirects looks malformed, skipping: "${line}"`);
      return;
    }
    rules.push({
      from,
      to,
      status: Number(status) || 301,
      isWildcard: from.endsWith('/*'),
      prefix: from.endsWith('/*') ? from.slice(0, -1) : null, // "/p/*" -> "/p/"
      line: i + 1,
    });
  });

  return rules;
}

/**
 * Given a path, work out where _redirects says it should go.
 * Mirrors Cloudflare's behaviour: first matching rule wins.
 * Returns null when no rule matches (meaning: the hub serves this path).
 */
export function expectedDestination(path, rules) {
  for (const rule of rules) {
    if (rule.isWildcard) {
      if (path.startsWith(rule.prefix)) {
        const splat = path.slice(rule.prefix.length);
        return { to: rule.to.replace(':splat', splat), status: rule.status, rule };
      }
    } else if (path === rule.from) {
      return { to: rule.to, status: rule.status, rule };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 1: inventory
// ---------------------------------------------------------------------------

/**
 * Pull every published post from Substack's archive API, 50 at a time.
 * Returns a list of paths like "/p/some-slug".
 */
async function takeInventory() {
  console.log(`Reading the post archive from ${SUBSTACK_ORIGIN} ...\n`);

  const paths = [];
  const seen = new Set();
  const LIMIT = 50;

  // Substack ignores our page size and returns fewer than we ask for, so we
  // advance the offset by however many we actually got and keep going until a
  // page comes back empty. Do NOT "optimise" this into stopping when a page is
  // shorter than LIMIT — that silently truncates the archive, which is the
  // exact bug this script exists to catch.
  let offset = 0;
  for (let guard = 0; guard < 500; guard++) {
    const url = `${SUBSTACK_ORIGIN}/api/v1/archive?sort=new&limit=${LIMIT}&offset=${offset}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });

    if (!res.ok) {
      throw new Error(
        `Archive API returned ${res.status}. If this is a 404, the domain may ` +
        `already have been cut over — in which case pull the inventory from ` +
        `https://news.educationprogress.org instead, or from Substack's dashboard.`
      );
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const post of batch) {
      if (post.slug && !seen.has(post.slug)) {
        seen.add(post.slug);
        paths.push(`/p/${post.slug}`);
      }
    }
    offset += batch.length;
    console.log(`  ${paths.length} posts so far ...`);
  }

  // The standard Substack paths that also need to survive. These aren't in
  // the archive API — they're structural.
  const structural = [
    '/archive',
    '/feed',
    '/subscribe',
    // A post URL carrying tracking parameters, which is what an email link
    // actually looks like in the wild. Confirms query strings survive.
    paths[0] ? `${paths[0]}?utm_source=substack&utm_medium=email` : null,
  ].filter(Boolean);

  const inventory = {
    takenFrom: SUBSTACK_ORIGIN,
    postCount: paths.length,
    // Deliberately not stamped with a date — record when you ran this in the
    // commit message, so the file itself stays diff-stable.
    paths: [...paths, ...structural],
  };

  await mkdir(dirname(INVENTORY_FILE), { recursive: true });
  await writeFile(INVENTORY_FILE, JSON.stringify(inventory, null, 2) + '\n');

  console.log(`\nDone. ${paths.length} posts + ${structural.length} structural paths.`);
  console.log(`Written to data/substack-urls.json — commit this file.`);
}

// ---------------------------------------------------------------------------
// Step 2/3: checking
// ---------------------------------------------------------------------------

/** Check one path. Returns a result object rather than throwing. */
async function checkPath(path, base, rules, follow) {
  const expected = expectedDestination(path.split('?')[0], rules);

  if (!expected) {
    return { path, ok: false, why: 'no rule in _redirects matches this path — it would 404' };
  }

  let res;
  try {
    res = await fetch(base + path, { redirect: 'manual' });
  } catch (err) {
    return { path, ok: false, why: `request failed: ${err.message}` };
  }

  if (res.status !== expected.status) {
    return {
      path,
      ok: false,
      why: `expected ${expected.status}, got ${res.status} (rule on _redirects line ${expected.rule.line})`,
    };
  }

  const location = res.headers.get('location') || '';
  // Compare ignoring any query string the server tacked back on, then check
  // separately that the query string survived at all.
  const gotBase = location.split('?')[0];
  const wantBase = expected.to.split('?')[0];

  if (gotBase !== wantBase) {
    return { path, ok: false, why: `redirects to ${location}\n         expected ${expected.to}` };
  }

  const sentQuery = path.includes('?') ? path.split('?')[1] : null;
  if (sentQuery && !location.includes(sentQuery.split('&')[0])) {
    return {
      path,
      ok: false,
      why: `query string was dropped — went to ${location}. Tracking parameters ` +
           `in old email links will be lost. VERIFY this against Cloudflare's ` +
           `query-string handling before launch.`,
    };
  }

  if (follow) {
    try {
      const dest = await fetch(location, { redirect: 'follow' });
      if (!dest.ok) {
        return { path, ok: false, why: `301 is correct, but ${location} returned ${dest.status}` };
      }
    } catch (err) {
      return { path, ok: false, why: `301 is correct, but destination unreachable: ${err.message}` };
    }
  }

  return { path, ok: true };
}

/** Run checks in small batches so we don't hammer anything. */
async function runChecks(base, follow) {
  const rules = await loadRules();

  let inventory;
  try {
    inventory = JSON.parse(await readFile(INVENTORY_FILE, 'utf8'));
  } catch {
    console.error(
      `Could not read data/substack-urls.json.\n` +
      `Run this first:  node scripts/check-redirects.mjs --inventory\n`
    );
    process.exit(1);
  }

  const paths = inventory.paths;
  console.log(`Checking ${paths.length} URLs against ${base}`);
  console.log(`Rules loaded from public/_redirects: ${rules.length}`);
  console.log(follow
    ? `Following redirects through to the destination.\n`
    : `Checking the 301 only. Destinations are not fetched — pass --follow after cutover.\n`);

  const results = [];
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map((p) => checkPath(p, base, rules, follow)));
    for (const r of settled) {
      results.push(r);
      if (!r.ok) console.log(`  FAIL  ${r.path}\n        ${r.why}`);
    }
    process.stdout.write(`  ...checked ${Math.min(i + CONCURRENCY, paths.length)}/${paths.length}\r`);
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`OK:   ${passed}`);
  console.log(`FAIL: ${failed.length}`);

  if (failed.length) {
    console.log(
      `\nEach FAIL above is a link that will break for real readers.\n` +
      `Fix public/_redirects, redeploy, and run this again until it is zero.`
    );
    process.exit(1);
  }

  console.log(`\nEvery old URL forwards correctly. Safe to proceed.`);
}

// ---------------------------------------------------------------------------

// Only run the command line when this file is executed directly, so the
// functions above can be imported by a test without the script firing.
const runDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const base = getFlag('--base');

if (!runDirectly) {
  // imported as a module — do nothing
} else if (hasFlag('--inventory')) {
  await takeInventory();
} else if (base) {
  await runChecks(base.replace(/\/$/, ''), hasFlag('--follow'));
} else {
  console.log(`
Usage:

  Take the inventory of old Substack URLs (do this BEFORE cutover):
    node scripts/check-redirects.mjs --inventory

  Dry run against the Cloudflare Pages preview URL (before cutover):
    node scripts/check-redirects.mjs --base https://YOUR-PREVIEW.pages.dev

  Full check against the live site (after cutover):
    node scripts/check-redirects.mjs --base https://educationprogress.org --follow
`);
  process.exit(1);
}
