# CEP Website — Scoping Document

**For:** the incoming front-end developer
**Repo:** `ep-website` (Astro 5.18.2) · **Target:** educationprogress.org
**Written:** 2026-08-13 · DNS facts verified live on that date

---

## The job in one paragraph

The Center for Educational Progress is a 501(c)(3) education-policy think tank.
For two years, `educationprogress.org` has pointed at their Substack. We are
replacing that with a purpose-built hub site — already designed and largely
built — while moving the newsletter to `news.educationprogress.org`. The site
is not the hard part; it mostly exists. **The hard part is taking over a live
domain without breaking two years of published links.** That is what this
project actually is.

---

## Where things stand right now

Verified by DNS lookup on 2026-08-13 — not from documentation, from the live
records:

| Thing | Current state |
|---|---|
| Registrar | **Namecheap** — and it stays there. No transfer needed. |
| Nameservers | `dns1/dns2.registrar-servers.com` — still Namecheap's. **The planned move of DNS management to Cloudflare has not happened yet.** |
| `www` | CNAME → `target.substack-custom-domains.com` — this is Substack |
| Apex (bare domain) | A record → `162.255.119.43`, Namecheap's URL-forwarding service, sending visitors to `www` |
| `news.` subdomain | Does not exist yet |
| Email | MX → `smtp.google.com` — Google Workspace |

Two things follow from that table, and they are the two most important facts
in this document:

1. **The site has not started cutting over.** Every step is still ahead of you,
   which is good — nothing is half-migrated.
2. **Those MX records are CEP's actual email.** If they are lost during the DNS
   move, staff email stops working. Not the website — the email. Check them
   line by line before changing nameservers, and again afterwards.

---

## Hosting: Astro does not constrain your choice

Short version: **use whatever host you already use.**

This site is a fully static build. There is no adapter configured, no
`output: 'server'`, no database, no server-side runtime. `npm run build`
produces ordinary HTML, CSS, and JavaScript in `dist/`. Netlify, Cloudflare
Pages, Vercel, GitHub Pages, or a plain bucket will all serve it identically.

If Netlify is your standard, use Netlify. A site living in the dashboard you
check daily gets noticed when it breaks; a site in an account nobody opens does
not. That operational reality outweighs any theoretical preference.

One convenient detail: the redirect file in this repo uses the `_redirects`
format, which is **originally Netlify's convention** — Cloudflare Pages adopted
it later. It works on either host with no changes.

**Recommended split:** DNS management at Cloudflare (free, and the project's
existing plan is written around it), hosting wherever you prefer. Cloudflare DNS
pointing at Netlify hosting is an entirely ordinary arrangement.

---

## The stack

| Layer | What it is |
|---|---|
| Framework | Astro 5.18.2 — components are JSX-adjacent; a React developer reads them on day one |
| Content | Markdown files validated by Zod schemas (`src/content.config.ts`) |
| Styling | Hand-written CSS, scoped per component. No framework, no Tailwind. |
| Maps | `src/lib/gt-map.ts` projects TopoJSON into static SVG **at build time** via d3-geo — no charting library reaches the browser. It works; try not to break it. |
| Data prep | Two Python scripts convert Excel to JSON. They run at authoring time only and are not part of the build or deploy. |
| Fonts | Self-hosted via `@fontsource` — no external font requests |

Local setup is `npm install` then `npm run dev`, which serves at
`http://localhost:4321`.

**Do not take the Astro 7 upgrade before launch.** The dev server will offer it.
You are on 5.18.2 and it works.

---

## The launch, in four moves

Full runbook lives in `ep-website/docs/CEP_website_work_plan_v2.md` Phase 6 —
that document is authoritative and unusually good. Read it. The shape:

**1. Move DNS management to Cloudflare.** Registration stays at Namecheap; only
the nameservers change. Compare Cloudflare's imported records against Namecheap's
list line by line before switching — especially MX and TXT. Set the Substack
records to "DNS only" (grey cloud), never Proxied, or Substack's SSL breaks. The
apex forwarding Namecheap does today will **not** carry over and must be
recreated as a Cloudflare rule.

**2. Deploy the hub to a preview URL.** Nothing live is touched. Connect the
repo, build command `npm run build`, output directory `dist`.

**3. Prove the redirects work — before cutover.** See below.

**4. Cut over.** Change Substack's custom domain to `news.`, point the apex and
`www` at your host, activate the redirects, flip one line in
`src/lib/substack.ts` so the homepage reads the new feed. Roughly an hour, and
the order matters.

---

## The redirect map — the one thing that must not slip

Every old newsletter email, restack, and outside link points at
`educationprogress.org/p/[slug]`. **There are 59 published posts.** At cutover,
that address starts serving the hub. Without a redirect layer, all 59 break at
once — and nothing errors, so you find out weeks later from traffic that stopped
arriving.

This repo carries the solution, already written and tested:

- `public/_redirects` — the forwarding rules, commented for a first-time reader
- `scripts/check-redirects.mjs` — requests every old URL against a real
  deployment and confirms it lands correctly. Plain Node, no dependencies.
- `data/substack-urls.json` — the inventory, pulled from Substack's archive API
- `docs/redirect-runbook.md` — **read this one**; four steps in order

> **Critical:** `_redirects` only functions from inside the deployed repo. Copy
> it into `ep-website/public/` and confirm it appears in `dist/` after a build.
> It currently lives here, in the handover repo, where it does nothing.

A caution earned the hard way: the inventory script originally reported 23 posts.
The real number is 59. Substack returns short pages regardless of the requested
page size, and the obvious pagination idiom silently truncated the archive. There
is a comment in the script telling you not to "fix" it back. Re-run the inventory
shortly before cutover to catch anything published in the meantime.

---

## What is built, and what is left

**Built:** design system, header/footer, homepage, Library, Research, About,
Donate, nine feature essays, the state gifted-regulations map, Substack RSS
pulling at build time.

**Developer work remaining — roughly 35–40 hours:**

| Item | State |
|---|---|
| Redirect layer installed and dry-run | Written, not yet in the site repo |
| Custom 404 page | Does not exist. Matters here — stray Substack URLs land on it. |
| Buttondown email signup | Form posts nowhere yet |
| Sitemap + robots.txt | Not installed |
| Analytics | None |
| Host connection and deploy | Not started |
| Accessibility and mobile pass | Not done — check red-on-cream at small sizes |
| Decap CMS (`/admin`) so staff can edit without you | Not set up |

**CEP's work, not yours — and it is the real critical path:**

- Roughly 24 bracketed placeholders remain in the pages. The most consequential
  are the two paragraphs on the About page describing what CEP is.
- Staff bios are marked PLACEHOLDER and were drafted from public sources. Real
  people, published page — they need sign-off.
- No privacy policy or terms page exists. The site takes donations and email
  addresses. **VERIFY** scope with counsel; CCPA/CPRA and VCDPA are the bar.
- **VERIFY** the hardcoded Stripe donation link resolves to a CEP-controlled
  account before any money moves.
- **VERIFY** with Substack support that changing the custom domain to `news.`
  is a settings change on the existing paid plan.

If the copy and legal items land late, the launch slips no matter how fast the
development goes. Assign them now, with names and dates.

---

## Ground rules

- Page background is cream `#F5F0E8`, never pure white. Ink is `#111111`.
- Palette: signal red `#CC2222`, deep navy `#1A2744`, gold `#D4901F`, bright
  blue `#3B82C4`. Flat fields, hard edges, no gradients.
- Charts are inline SVG in that palette with direct labels — never a charting
  library's default styling.
- Feature bodies in `src/partials/` are hand-maintained and are the source of
  truth. Do not regenerate them from `content-drafts/`.
- Never commit secrets. Use gitignored `.env` files.
- Adding a report or an initiative must never require touching layout code.
- CEP staff are lawyers and writers, not engineers. Explain in plain English and
  flag tradeoffs rather than deciding silently.

---

## Open decisions

- **Where should `/subscribe` point?** Currently the hub's signup section; the
  alternative is straight to Substack. One line. It must never 404 — it is in
  the footer of every newsletter ever sent.
- **VERIFY: do query strings survive the 301?** Real email links carry
  `?utm_source=substack`. The inventory deliberately includes one such URL so
  the dry run tests it.
- **National G&T Data tool** is deliberately `coming-soon` pending a framing
  decision. It is designed to degrade gracefully; it does not block launch.

---

## Accounts and ownership

Every account — host, Cloudflare, Namecheap, Stripe, Buttondown, GitHub —
should be **owned by CEP**, with the developer added as a collaborator. Never
the other way round. This costs nothing to get right at the start and is
expensive to unwind later.

Worth agreeing in writing before launch: what post-launch support covers,
expected response time, and what it costs. Unpaid informal arrangements are the
ones that quietly lapse.
