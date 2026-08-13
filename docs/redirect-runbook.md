# Redirect Runbook — keeping two years of links alive at cutover

Written for whoever is doing the launch. Assumes you're comfortable with HTML
and the browser, and that DNS and deploy pipelines are not your daily work.
Nothing here requires that they be.

## The one-paragraph version

`educationprogress.org` has been the Substack for two years. Every old
newsletter email, every restack, every link anyone else published points at
`educationprogress.org/p/[slug]`. At cutover that address starts serving the
new hub instead. Two files keep the old links working: `public/_redirects`
holds the forwarding rules, and `scripts/check-redirects.mjs` proves they work
before you flip anything. If the redirects are broken, nothing throws an
error — the links just quietly die, and you find out weeks later from traffic
that stopped arriving.

## What the two files do

**`public/_redirects`** — a plain text file, one rule per line, in the form
`/old/path  https://destination  301`. Cloudflare Pages reads it from the root
of the built site. Astro copies everything in `public/` into `dist/` untouched,
so it arrives there on its own. There is no build step and nothing to
configure. Editing this file is editing the redirect map.

**`scripts/check-redirects.mjs`** — reads that same file, works out where every
old URL *should* go, then requests each one against a real deployment and
confirms it actually goes there. It reads the rules rather than repeating them,
so the two can't drift apart.

## Do these in order

### 1. Take the inventory — before anything else

```
node scripts/check-redirects.mjs --inventory
```

This asks Substack for the full list of published posts and writes
`data/substack-urls.json`. Commit that file.

**Do this before the cutover.** It reads Substack's archive API on the current
domain, and that endpoint stops answering there once the domain swaps. If you
miss this window you can still get the list from the Substack dashboard, but
it's manual and annoying.

### 2. Get the site onto Cloudflare Pages

Connect the GitHub repo to Cloudflare Pages. Build command `npm run build`,
output directory `dist`. This gives you a preview URL like
`https://abc123.ep-website.pages.dev` that serves the real site with the real
redirect rules — without touching the live domain. Nothing is at risk yet.

### 3. Dry run against the preview URL

```
node scripts/check-redirects.mjs --base https://abc123.ep-website.pages.dev
```

Every line should read OK. Any FAIL tells you which path broke and which line
of `_redirects` is responsible.

At this stage the script checks only that each old URL returns a `301` pointing
at the right place. It does **not** check that the destination loads, because
`news.educationprogress.org` isn't serving yet — Substack only starts answering
there in step 4. That's expected, not a problem.

Fix, push, wait for the deploy, run again. Repeat until zero failures.

### 4. Cutover day

Full sequence is in `CEP_website_work_plan_v2.md` Phase 6b — follow that, it's
authoritative. Roughly one hour, and the order matters:

1. In Substack settings, change the custom domain to
   `news.educationprogress.org`. Confirm posts, archive, and feed serve there.
2. Point the apex and `www` DNS at Cloudflare Pages.
3. Flip the feed source: `src/lib/substack.ts` line 4, change `FEED_URL` to
   `https://news.educationprogress.org/feed`. Push, let it deploy.

### 5. Verify immediately, with the destinations this time

```
node scripts/check-redirects.mjs --base https://educationprogress.org --follow
```

`--follow` adds the check that was impossible earlier: each destination is
fetched to confirm it returns a real page rather than a 404. This is the run
that actually proves the migration worked.

Then, by hand, open three genuine `/p/` links from old newsletter emails and
confirm they land on the right posts. The script tests what it was told about;
a real email tests what readers actually have.

### 6. Week one

Watch Cloudflare analytics for 404s on the apex. **Every 404 is a missed
redirect** — find the pattern, add a rule, redeploy. Also submit both sitemaps
in Google Search Console so the 301s hand the search ranking over to `news.`

## Two open questions to settle before cutover

**Where should `/subscribe` go?** It's currently pointed at the hub's signup
section, on the theory that the hub offers both Buttondown and Substack. The
alternative is sending people straight to `news.educationprogress.org/subscribe`.
This is Thomas's call, and it's a one-line change. What matters is that it never
404s — it's in the footer of every newsletter ever sent.

**VERIFY: do query strings survive the redirect?** Real email links carry
tracking parameters (`/p/some-post?utm_source=substack`). Cloudflare should
preserve them through a 301, but confirm it rather than assume — the inventory
deliberately includes one URL with parameters so the dry run in step 3 tests
exactly this. If that check fails, the fix is a Cloudflare setting, not a
change to this file.

## The rule that matters

`/p/*` is the one. Everything else in the map is worth having; that one is
load-bearing. If you have five minutes and a bad feeling, test that one.

## And the thing not to do

Don't delete this file, and don't let anyone "clean it up" in six months
because the site works fine without it. The site works fine because of it.
Redirects are permanent infrastructure. They stay forever.
