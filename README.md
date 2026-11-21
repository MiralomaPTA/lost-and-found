# Miraloma PTA lost and found

A small Next.js app that puts the school's lost-and-found bin online. Anyone with the school code can scroll photos of what's in the bin, tap *This is mine*, and add items they find; admins, who have a separate admin code, fix mistakes and run the monthly clear-out. The product spec is in [`specs/`](specs/).

Everything the app keeps lives in one Cloudflare R2 bucket: a few JSON files and the photos. The app runs on Vercel, like [reimburse-me](https://github.com/MiralomaPTA/reimburse-me) and [asset-manager](https://github.com/MiralomaPTA/asset-manager), and sends no email.

**Status: Phase 1 in progress.** Done: the school code, the admin code and remembered phones; the grid, the item page, claiming and *My items*; adding items (bulk add from the live camera, and one from a photo with a crop box). Next: *Fix tags* on the item page, then the admin section.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

No Cloudflare setup is needed for development. With the default `STORAGE=local`, the bucket is the folder `.data/bucket/`, with the same file names R2 will have.

The first visit asks for a code. In development with local storage, the admin code is `local admin code` unless `INITIAL_ADMIN_CODE` is set in `.env.local` (with `STORAGE=r2` there is no default, so it can't end up in the real bucket). Type it in the code box, give the phone a name, then set a school code on Settings and try it in a private window. Delete `.data/` to start over.

`npm run seed` fills the local bucket with made-up items (drawn shapes in each item's color) to browse and claim; `npm run seed -- 120` adds 120. It only ever writes to local storage. To add real ones, use *Add*: the live camera in bulk add works on `localhost` (browsers allow cameras only there and on HTTPS); from another device on your network, it falls back to the phone's camera app.

```bash
npm test             # unit tests (vitest)
npm run typecheck
npm run lint
npm run build
npm run check:r2     # Phase 0: confirms the R2 bucket refuses out-of-date writes (needs the R2_* values)
```

The first four run in GitHub Actions on every push and pull request; see `.github/workflows/ci.yml`. CI uses local storage, so it needs no secrets.

## Configuration

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL, e.g. `https://lostandfound.miralomasf.com` |
| `STORAGE` | `local` (default) or `r2` |
| `CONTACT_EMAIL` | The address shown for questions; defaults to `lostandfound@miralomasf.com` |
| `INITIAL_ADMIN_CODE` | The first admin code: at least three words of three or more letters, 15+ characters (three random words work well). Copied into `settings.json` when it has no admin code, so it can be set after the first deploy. After that, admins change it on Settings and this is ignored. Development with local storage defaults to `local admin code` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | The Cloudflare account and the bucket-only API token |
| `R2_BUCKET` | Defaults to `miraloma-pta-lost-and-found` |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | `1` only to try a production build on a laptop with `STORAGE=local` |

## Phase 0: setup

One-time steps, mostly in other people's dashboards. The spec's *Rollout plan* has the reasons.

1. **Workspace account.** The PTA's Google Workspace super admin creates **lostandfound@miralomasf.com**. It owns the Cloudflare and Vercel accounts and receives questions from families, so forward its mail to the admins (spec open question 15).
2. **Cloudflare, as lostandfound@.**
   - Create the account and turn on R2. Cloudflare may ask for a payment method even for the free tier.
   - Create a bucket named `miraloma-pta-lost-and-found` (automatic location).
   - Create an R2 API token with **Object Read & Write**, applied to **that bucket only**. Note the Access Key ID, the Secret Access Key and the account ID.
3. **Check safe writes.** Put the three R2 values in `.env.local` and run `npm run check:r2`. It writes, changes and races one scratch file under `_checks/`, deletes it, and prints PASS or FAIL for each step. Every line should say PASS. If the line "Refuses a write with an out-of-date version tag" fails, stop and decide on the fallback in the spec (a small Cloudflare Worker for `items.json` and `settings.json` writes) before Phase 1 builds on it. **Done Nov 20, 2026: every check passed.**
4. **Vercel, as lostandfound@.**
   - Create a Hobby account and import `MiralomaPTA/lost-and-found`. An owner of the MiralomaPTA GitHub organization may need to approve Vercel's GitHub app.
   - Set `STORAGE=r2`, the four `R2_*` values, `APP_URL=https://lostandfound.miralomasf.com`, `CONTACT_EMAIL` and `INITIAL_ADMIN_CODE`.
   - Add the domain `lostandfound.miralomasf.com`, then add the CNAME record Vercel shows wherever miralomasf.com's DNS is managed.
5. **Codes.** Pick the first school code (a short word for the newsletter and the sign at the bin) and the first admin code (three random words, for admins only; the app refuses anything shorter than three words of three or more letters). The admin code goes in `INITIAL_ADMIN_CODE`. Then open the site, type the admin code in the code box, and set the school code on Settings; until then only admins can get in.
6. **Photo spot.** Set up a spot by the bin with good light and a plain lime-green poster board as the backdrop (spec open question 11).
