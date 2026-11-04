# Swing By

Find a playground worth the trip. Swing By lists playgrounds with who runs them, where the details came from and when they were last checked. Hertfordshire is the launch region.

## What's here

- `src/content/playgrounds/`: one JSON file per playground. This is the content people edit.
- `src/data/`: counties and towns, motorway junctions, and the labels for equipment and facilities.
- `src/pages/`: the pages (finder with map, playground pages, road trips, memberships, my parks).
- `src/pages/playgrounds/in/` and `src/lib/places.ts`: the browse-by-area pages (`/playgrounds/in/`): one for each region, and one for each town or area with at least 5 playgrounds, so people can find "playgrounds in Chelmsford" in a search. They're built from each playground's `region` and `area`, which must match exactly, so "Abbots Langley" and "Abbots Langley, Three Rivers" get separate pages. Use one spelling per place to keep them together.
- Search engines: `@astrojs/sitemap` writes the sitemap at build time, `public/robots.txt` points to it, and `src/layouts/Base.astro` adds the canonical link, share tags (the picture is `public/og-default.png`) and optional structured data. Pages with `noindex` (moderator, My parks, advanced search) are kept out of both.
- `public/admin/`: the content editor (Decap CMS).
- `worker/` and `functions/api/`: GitHub sign-in for the content editor, and the home page's feedback form (`worker/feedback.js`), run on Cloudflare.
- `db/feedback.sql`: the table behind the feedback form, in the Cloudflare D1 database `swing-by-photos`.
- `tests/a11y.mjs`: automated accessibility (axe, WCAG 2.2 AA) and smoke checks.

## Rules for content

- When adding a county or district, or checking one for gaps, follow [docs/finding-playgrounds.md](docs/finding-playgrounds.md). It lists every type of source to check: council directories, leisure operators, county park portals, and town and parish councils.

- Playground details are unverified until they are checked against an official source. Leave "Last checked" blank until then, and the site labels the playground "Unverified". Playgrounds mapped on OpenStreetMap can be listed this way even when no council lists them, with the OpenStreetMap page as the source and the OpenStreetMap credit.
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

## Site feedback

The home page asks "How could we make Swing By better?". Suggestions are stored in the `feedback` table (`db/feedback.sql`) of the D1 database `swing-by-photos`, through `worker/feedback.js`, and are never shown on the site. Moderators read the newest 200 at `/moderate/`, below the photos. Previews save to `swing-by-photos-preview`. A hidden field catches most spam bots, and nobody is asked for a name or email address.

The old "Where should we go next?" vote was removed in November 2026. Its votes are still in the D1 database `swing-by-votes`, which nothing uses any more and can be deleted from the Cloudflare dashboard once you don't need them.

## Parent photos

Parents can share a photo from any playground page. The page shrinks it to about 1600px and strips hidden location data before sending. Photos are stored in the D1 database `swing-by-photos` (table: `db/photos.sql`) and **stay hidden until a moderator approves them**. An approved photo replaces the illustration on the playground page and on result cards. Anyone can report a photo, which hides it again until it's re-checked. Rejected photos are deleted.

To turn on moderation, add a secret called `MOD_TOKEN` to the Worker: Workers & Pages > swing-by > Settings > Variables and Secrets > Add > type Secret. Use a long random value and keep it private. Then open `/moderate/` on the site and enter it to check photos.

After a parent ticks "We've been here" (or rates a playground), the page asks if they took a photo and takes them to the form.

### Photos found on Geograph and Wikimedia Commons

Every Monday, and whenever playgrounds change on main, the **Find playground photos** workflow (`.github/workflows/photos.yml`, `scripts/find-photos.mjs`) looks for openly licensed photos taken within 200 m of each playground that has no photo yet, on Geograph (CC BY-SA 2.0) and Wikimedia Commons (CC BY, CC BY-SA, CC0 or public domain). It only suggests photos whose title or description mentions play equipment, at most three waiting per playground, and up to 150 playgrounds a run (Geograph asks for on-demand use, not bulk downloads). Suggestions land in `/moderate/` with the title, photographer, licence, distance from the pin and a link to the source, and **nothing shows on the site until a moderator approves it**. Rejected suggestions are never suggested again. Approved photos carry their credit, linked to the source, on the playground page and a short credit on result cards.

It needs two repository secrets (Settings > Secrets and variables > Actions): `MOD_TOKEN`, the same moderator key as the Worker, and `GEOGRAPH_KEY`, a free key from geograph.org.uk/get-api-key.php. Without `GEOGRAPH_KEY` it searches Wikimedia Commons only. Run it any time from the Actions tab (Find playground photos > Run workflow). On other branches it only does a dry run.

The extra columns it uses are in `db/photos-sources.sql`.

Uploads are limited to 5 an hour and 20 a day per connection. Photos are stored in D1 while R2 isn't enabled on the account; the free plan holds roughly 1,000 to 1,500 photos per database. Move them to R2 if uploads grow.

## What parents say a playground has

Every playground page has a "What's here" form where parents tick the equipment they saw, from the same list used across the site (most common first), and say whether there's a playground anyone can use. It opens by itself on Unverified playgrounds and ones with no equipment listed, and folds away elsewhere. After "We've been here", the page offers it alongside the photo prompt.

**One parent's answers are never shown on their own.** An item appears on the page, as "Parents confirm it also has", only once two different parents (different browsers and different connections) have ticked it. "There's a playground here" or "it's gone or private" needs two parents agreeing and more saying so than not. Toilets and baby change can't be ticked: they only come from official sources and the Toilet Map. Answers are stored in the photos database (table: `db/equipment.sql`), with a random browser id and a one-way hash of the connection, never a name. One connection can answer for up to 40 playgrounds a day.

Under the tick boxes, **"Something else?"** lets parents type in things that aren't listed, such as a rocking horse (up to three, separated by commas). Anything that matches a tick box counts as that tick box. The rest is stored privately (table `equipment_other` in `db/equipment.sql`), never shown on playground pages, and listed for moderators at `/moderate/`. Clearing a playground's answers clears these too.

Every Sunday the **Tick-box review** workflow (`.github/workflows/tick-box-review.yml`, `scripts/other-equipment.mjs`) counts what parents typed in, and how often common equipment is mentioned in playground descriptions, and posts the result to the "Weekly tick-box review" issue. Things seen at 3+ playgrounds by 3+ households, or mentioned in 25+ descriptions, are marked ⭐ as worth a new tick box. A new tick box needs a code and name in `src/data/labels.json`, an icon in `ICON` in `src/lib/parks.ts` and an option in `public/admin/config.yml`; the picker sorts itself by how often each item is used.

Moderators see every playground with parent answers at `/moderate/`, can clear a playground's answers, and can copy confirmed items into the playground's file to make them part of the listing (and the search filters).

## Checking coverage

The **Check coverage** workflow (`.github/workflows/coverage.yml`, `scripts/find-gaps.mjs`) compares the playgrounds mapped on OpenStreetMap with the ones we list, county by county, biggest population first: London, Scotland, Wales, the West Midlands, Greater Manchester and so on down to Rutland. A playground counts as covered if we list one within 150 m. A council's own record is the exception: a differently named place 40 to 150 m from a listing, on a different mapped play area, is added as a separate site, such as an adventure playground beside a park's playground (`scripts/same-place.mjs`). Ones tagged private or indoor, and ones at schools, pubs, hotels and holiday parks, are left out. It works out which council each missing playground is in.

**Council sources come first.** `src/data/council-sources.json` lists the councils whose own play area lists have been checked (by working through `docs/finding-playgrounds.md`). The workflow:

1. reads any council list it can read itself (a council with a `feed`) and adds playgrounds on it that we don't have, as verified, with the council as the source;
2. fills the remaining gaps from OpenStreetMap, as Unverified, **only in councils listed in that file**;
3. lists every other council with gaps under "Check these councils' own lists first", biggest counties first, with a search link. Work through the guide for each one, import its list, then add it to `council-sources.json`. Next time, its remaining gaps can be filled from OpenStreetMap.

It runs on the 8th of each month (monthly, to stay within GitHub's free 2,000 Actions minutes), adds up to 150 playgrounds in that order (change the number with a repository variable called `COVERAGE_WEEKLY_ADD`, which keeps its old name; `0` makes it report only), and opens one pull request. It scans counties for up to 35 minutes and the next month carries on from where it stopped. When Overpass (the live OpenStreetMap service) can't be reached, it uses the saved monthly snapshot instead, sorting its playgrounds into counties with postcodes.io and the same council-to-county rules as the home page (`scripts/counties.mjs`). It skips the adding for the month if an earlier `coverage/…` pull request is still open, so merge or close that one first. Councils whose own lists haven't been checked are never filled automatically: the pull request lists the next ones to research by hand. It writes the report to the run's summary page, plus a downloadable `coverage-report` with every missing playground by council. To add a different amount or just one county, run it from the Actions tab (Check coverage > Run workflow) with "Add up to this many" set, say, to 200, and optionally one county. Tick "Also fill gaps from OpenStreetMap in councils whose own lists haven't been checked yet" only if you want to skip the council-first step. It refreshes the nearest toilets and opens a pull request for you to review. If GitHub doesn't let Actions open pull requests (Settings > Actions > General), it pushes a `coverage/…` branch instead. A workflow's own commits don't start other workflows, so the coverage, pin and junction workflows start the build and accessibility checks themselves once they push their branch. When the toilets workflow commits to a pull request branch it starts them too, and that run replaces the one for the commit before, so each pull request is checked once on its latest commit.

## Checking pin positions

Early playgrounds were pinned by hand, from a postcode or from a street name, before positions came from OpenStreetMap, and some of those pins are well off (one in Chesterfield was 400 m outside its park). The **Check pin positions** workflow (`.github/workflows/positions.yml`, `scripts/check-positions.mjs`) finds them. A playground's `notConfirmed` text says where its position came from: "taken from OpenStreetMap" and "from the council's map" are trusted; "mapped from the postcode", "approximate" or nothing at all are checked. For each checked pin it looks for public playgrounds mapped on OpenStreetMap nearby, matches them one to one, and reports:

- **confirmed**: a mapped playground is within 60 m, so the pin is right.
- **move**: one clear match, within 250 m (or 500 m if the names share a word). The pin is probably wrong.
- **ambiguous**: several mapped playgrounds could be the one, or the only one is far away and its name says nothing. Choose by hand.
- **unmatched**: the mapped playgrounds nearby are used by other pins, so this one may be stacked on another.
- **far**: nothing mapped within 500 m. Either the pin is badly out or the playground isn't on OpenStreetMap yet.

Run it from the Actions tab (Check pin positions > Run workflow), with a region such as `derbyshire` to start small. Leave "Move the clear ones" unticked to just read the report; tick it to move the "move" pins, refresh the nearest toilets and open a pull request. Look at a few moved pins on the map before merging. Pins with several possible matches are never moved automatically. Moved pins say "taken from OpenStreetMap" afterwards, so each is only checked once. `tests/positions.mjs` tests the script on made-up data, and runs with `npm test`.

## Quarterly check for changes

Four times a year (the 10th of January, April, July and October) the **Quarterly playground check** workflow (`.github/workflows/quarterly-check.yml`, `scripts/quarterly-check.mjs`) looks for changes to playgrounds we already list, without needing Claude. It changes no files. It opens a "Quarterly playground check" issue listing:

- playgrounds a council with a machine-readable list (a `feed` in `src/data/council-sources.json`) no longer lists, ones that may have been renamed, and new ones on the council's list;
- playgrounds sourced from OpenStreetMap whose mapped playground has been deleted, retagged or marked private;
- official source links that now return "not found" (404 or 410), which often means a listing has changed or gone;
- playgrounds with an official source that haven't been checked for over a year.

Each list is capped in the issue; the full lists are in the run's `quarterly-check` artifact. Check each item against its official source before editing or removing a playground. Run it any time from the Actions tab (Quarterly playground check > Run workflow), optionally leaving out parts such as `links`. The council-list reader is shared with Check coverage (`scripts/council-feeds.mjs`).

## OpenStreetMap snapshot and saving Actions minutes

**Budget.** The repository runs on GitHub's free 2,000 Actions minutes a month. Aim for about 600 on the regular jobs, about 1,000 on adding new areas and about 400 spare. Before adding an area, test readers and parsers on pages saved with **Fetch pages** (run locally, free) rather than with repeated workflow runs, and never add temporary workflows to an area's branch.

**Snapshot.** Once a month (the 2nd) the **OpenStreetMap snapshot** workflow (`.github/workflows/osm-snapshot.yml`, `scripts/osm-snapshot.mjs`) downloads Geofabrik's daily extracts of Great Britain and of Ireland and Northern Ireland, keeps only playgrounds, parks, gardens, commons, recreation grounds and nature reserves, and saves two small files to the `osm-data` branch (one commit, replaced each month). Jobs that need mapped playgrounds use the shared step `.github/actions/osm-snapshot` to fetch it, and read it instead of asking the busy Overpass servers, as long as it's under five weeks old; otherwise they ask Overpass as before. The pin check and the junction job use it now. The junction job still checks the playgrounds it picks against OpenStreetMap live, in one small query, before adding them. The coverage check stays fully live, because it decides what to add. Run the snapshot from the Actions tab whenever you want a fresh one.

**Fewer chained runs.** Jobs that already refresh the nearest toilets in their own commit (coverage, junctions, pin moves) put `[skip toilets]` in the commit message, and **Update nearest toilets** doesn't run for those pushes. A person can do the same when pushing new playgrounds whose pins aren't placed yet. **Find playground photos** runs once a week (Mondays) rather than after every merge. **Build and accessibility checks** skip merges and bot commits on main (the pull request was already checked), cancel a pull request's older run when a newer push arrives, and keep the test browser between runs. **Check coverage** runs monthly with a 60-minute limit.

**Fetching pages.** Council websites often refuse requests from a Claude session. The **Fetch pages** workflow (`.github/workflows/fetch-pages.yml`) takes a label and a list of names and addresses, fetches them with curl and keeps them on the `fetched-pages` branch under that label, so they can be read with git. Use it when researching a new area, instead of adding a temporary workflow to the area's branch.

## Coming next

- Shared parent reports and ratings (Supabase free tier), with reports shown once another parent has confirmed them.
- Postcode positions for the 96 council playgrounds that aren't mapped yet.
- More counties, following the UK-wide data plan in the project brief.
- When each playground is busiest. Google's "Popular times" can't be used: there's no API for it, and Google Maps data isn't allowed here (see the content rules). Possible routes: a quick "How busy was it?" question for parents on playground pages (time of day and day of week, shown once enough answers agree, like the equipment checks), plus general patterns such as school holidays and after-school hours.
