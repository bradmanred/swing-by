# Swing By

Find a playground worth the trip. Swing By lists playgrounds with who runs them, where the details came from and when they were last checked. Hertfordshire is the launch region.

## What's here

- `src/content/playgrounds/`: one JSON file per playground. This is the content people edit.
- `src/data/`: counties and towns, motorway junctions, and the labels for equipment and facilities.
- `src/pages/`: the pages (finder with map, playground pages, road trips, memberships, my parks).
- `public/admin/`: the content editor (Decap CMS).
- `functions/api/`: GitHub sign-in for the content editor, run by Cloudflare Pages.
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

## Free hosting on Cloudflare Pages

1. Sign up at https://dash.cloudflare.com (free).
2. Go to Workers & Pages, create a Pages project and connect this GitHub repository.
3. Set the build command to `npm run build`, the output folder to `dist`, and add an environment variable `NODE_VERSION` = `22`.
4. Deploy. Your link will be `https://<project-name>.pages.dev`. If it isn't `swing-by.pages.dev`, change `site` in `astro.config.mjs` and `base_url` and `site_url` in `public/admin/config.yml` to match.

Every pull request also gets its own preview link.

## Turn on the content editor online

1. On GitHub, go to Settings > Developer settings > OAuth Apps > New OAuth App.
2. Set the homepage URL to your Pages link and the callback URL to `https://<your-pages-link>/api/callback`.
3. Copy the client ID, and generate a client secret.
4. In the Cloudflare Pages project, under Settings > Environment variables, add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (mark the secret as encrypted). Redeploy.
5. Open `https://<your-pages-link>/admin/` and sign in with GitHub. Edits are saved as pull requests for review before they go live.

## Coming next

- Shared parent reports and ratings (Supabase free tier), with reports shown once another parent has confirmed them.
- Postcode positions for the 96 council playgrounds that aren't mapped yet.
- More counties, following the UK-wide data plan in the project brief.
