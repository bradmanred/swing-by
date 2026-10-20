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
4. Deploy. Your link will be `https://swing-by.<your-subdomain>.workers.dev`. Change `site` in `astro.config.mjs` and `base_url` and `site_url` in `public/admin/config.yml` to match.

## Turn on the content editor online

1. On GitHub, go to Settings > Developer settings > OAuth Apps > New OAuth App.
2. Set the homepage URL to your site link and the callback URL to `https://<your-site-link>/api/callback`.
3. Copy the client ID, and generate a client secret.
4. In the Worker's Settings > Variables and Secrets, add `GITHUB_CLIENT_ID` as a text variable and `GITHUB_CLIENT_SECRET` as a secret. Redeploy.
5. Open `https://<your-site-link>/admin/` and sign in with GitHub. Edits are saved as pull requests for review before they go live.

## The next-area vote

Votes are stored in the D1 database `swing-by-votes`, bound to the Worker as `VOTES` in `wrangler.jsonc`. Each browser gets one vote (remembered with a cookie) and can change it. To see the totals, open `/api/vote` on the site, or in the Cloudflare dashboard go to Storage & databases > D1 > swing-by-votes and run:

```sql
SELECT area, COUNT(*) AS votes FROM votes GROUP BY area ORDER BY votes DESC;
```

To try the vote on your computer: `npx wrangler d1 execute swing-by-votes --local --file db/votes.sql`, then `npm run build` and `npx wrangler dev`.

## Coming next

- Shared parent reports and ratings (Supabase free tier), with reports shown once another parent has confirmed them.
- Postcode positions for the 96 council playgrounds that aren't mapped yet.
- More counties, following the UK-wide data plan in the project brief.
