# Swing By

Find a playground worth the trip. Swing By lists playgrounds with who runs them, where the details came from and when they were last checked. Hertfordshire is the launch region.

## What's here

- `src/content/playgrounds/`: one JSON file per playground. This is the content people edit.
- `src/data/`: counties and towns, motorway junctions, and the labels for equipment and facilities.
- `src/pages/`: the pages (finder with map, playground pages, road trips, memberships, my parks).
- `public/admin/`: the content editor (Decap CMS).
- `worker/` and `functions/api/`: GitHub sign-in for the content editor, and the "Where should we go next?" vote (`worker/vote.js`), run on Cloudflare.
- `src/data/next-areas.json`: the areas people can vote for. Edit this list to change the options.
- `db/votes.sql`: the table behind the vote, in the Cloudflare D1 database `swing-by-votes`.
- `tests/a11y.mjs`: automated accessibility (axe, WCAG 2.2 AA) and smoke checks.

## Rules for content

- When adding a county or district, or checking one for gaps, follow [docs/finding-playgrounds.md](docs/finding-playgrounds.md). It lists every type of source to check: council directories, leisure operators, county park portals, and town and parish councils.

- Playground details are unverified until they are checked against an official source. Leave "Last checked" blank until then, and the site labels the playground "Unverified".
- Photos must be openly licensed or used with permission, credited, and must not show identifiable children.
- Don't copy data from Google Maps or Google Places. Their terms don't allow storing it or showing it on a non-Google map.

## Run it on a computer

You need Node 22 or newer.

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # builds the site into dist/
npm test           # accessibility and smoke checks against dist/
```

To use the content editor locally, run `npm run cms` in one terminal and `npm run dev` in another, then open http://localhost:4321/admin/.

## Free hosting on Cloudflare

The site runs as a Cloudflare Worker that serves the built pages (see `wrangler.jsonc`), with `worker/index.js` handling sign-in for the content editor.

1. Sign up at https://dash.cloudflare.com (free).
2. Go to Workers & Pages, create an application, choose to import a repository and pick this one.
3. Use these build settings:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Root directory: leave blank (`/`)
   - Build variable: `NODE_VERSION` = `22`
4. Deploy. The site is at https://swing-by.co.uk (and still at `https://swing-by.<your-subdomain>.workers.dev`).

### The swing-by.co.uk domain

The domain's DNS is on Cloudflare, in the same account as the Worker. `routes` in `wrangler.jsonc` attaches `swing-by.co.uk` and `www.swing-by.co.uk` to the Worker as custom domains, so each deploy creates the DNS records and certificates. `worker/index.js` redirects www to the bare domain. If you change the domain, update `routes`, `site` in `astro.config.mjs`, `base_url` and `site_url` in `public/admin/config.yml`, and the GitHub OAuth app's URLs.

## Turn on the content editor online

1. On GitHub, go to Settings > Developer settings > OAuth Apps > New OAuth App.
2. Set the homepage URL to `https://swing-by.co.uk` and the callback URL to `https://swing-by.co.uk/api/callback`.
3. Copy the client ID, and generate a client secret.
4. In the Worker's Settings > Variables and Secrets, add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Make the secret a **Secret**; the client ID can be either. `wrangler.jsonc` has `keep_vars: true` so deploys don't delete them. Redeploy.
   - If signing in sends you to a GitHub page with `client_id=undefined` in the address, the Worker can't see `GITHUB_CLIENT_ID`: add it again.
5. Open `https://<your-site-link>/admin/` and sign in with GitHub. Edits are saved as pull requests for review before they go live.

## The next-area vote

Votes are stored in the D1 database `swing-by-votes`, bound to the Worker as `VOTES` in `wrangler.jsonc`. Each browser gets one vote (remembered with a cookie) and can change it. To see the totals, open `/api/vote` on the site, or in the Cloudflare dashboard go to Storage & databases > D1 > swing-by-votes and run:

```sql
SELECT area, COUNT(*) AS votes FROM votes GROUP BY area ORDER BY votes DESC;
```

Branch previews use a separate test database, `swing-by-votes-preview` (the `previews` block in `wrangler.jsonc`), so votes cast while testing a pull request don't count.

To try the vote on your computer: `npx wrangler d1 execute swing-by-votes --local --file db/votes.sql`, then `npm run build` and `npx wrangler dev`.

## Parent photos

Parents can share a photo from any playground page. The page shrinks it to about 1600px and strips hidden location data before sending. Photos are stored in the D1 database `swing-by-photos` (table: `db/photos.sql`) and **stay hidden until a moderator approves them**. An approved photo replaces the illustration on the playground page and on result cards. Anyone can report a photo, which hides it again until it's re-checked. Rejected photos are deleted.

To turn on moderation, add a secret called `MOD_TOKEN` to the Worker: Workers & Pages > swing-by > Settings > Variables and Secrets > Add > type Secret. Use a long random value and keep it private. Then open `/moderate/` on the site and enter it to check photos.

After a parent ticks "We've been here" (or rates a playground), the page asks if they took a photo and takes them to the form.

### Photos found on Geograph and Wikimedia Commons

Every Monday, and whenever playgrounds change on main, the **Find playground photos** workflow (`.github/workflows/photos.yml`, `scripts/find-photos.mjs`) looks for openly licensed photos taken within 200 m of each playground that has no photo yet, on Geograph (CC BY-SA 2.0) and Wikimedia Commons (CC BY, CC BY-SA, CC0 or public domain). It only suggests photos whose title or description mentions play equipment, at most three waiting per playground, and up to 150 playgrounds a run (Geograph asks for on-demand use, not bulk downloads). Suggestions land in `/moderate/` with the title, photographer, licence, distance from the pin and a link to the source, and **nothing shows on the site until a moderator approves it**. Rejected suggestions are never suggested again. Approved photos carry their credit, linked to the source, on the playground page and a short credit on result cards.

It needs two repository secrets (Settings > Secrets and variables > Actions): `MOD_TOKEN`, the same moderator key as the Worker, and `GEOGRAPH_KEY`, a free key from geograph.org.uk/get-api-key.php. Without `GEOGRAPH_KEY` it searches Wikimedia Commons only. Run it any time from the Actions tab (Find playground photos > Run workflow). On other branches it only does a dry run.

The extra columns it uses are in `db/photos-sources.sql`.

Uploads are limited to 5 an hour and 20 a day per connection. Photos are stored in D1 while R2 isn't enabled on the account; the free plan holds roughly 1,000 to 1,500 photos per database. Move them to R2 if uploads grow.

## Coming next

- Shared parent reports and ratings (Supabase free tier), with reports shown once another parent has confirmed them.
- Postcode positions for the 96 council playgrounds that aren't mapped yet.
- More counties, following the UK-wide data plan in the project brief.
