# Fixing automated check reports

Some GitHub workflows check the site without changing anything and post what they find as an issue labelled
**`check-report`**. A daily scheduled Claude task ("Fix check reports") reads every open `check-report` issue, fixes
what it can from official sources, and opens a pull request for the owner to review. This page is its playbook.

## Rules for every fix

- Follow `CLAUDE.md`, `README.md` and `docs/finding-playgrounds.md`. Official sources only (council, operator or
  membership organisation), or OpenStreetMap for Unverified places. Never Google Maps or Places data.
- A report says where to look, not what's true. Confirm every finding on an official source before editing.
  If a finding turns out to be wrong, say so in the PR and leave the file alone.
- **Never delete a playground.** If an official source confirms it has closed or been removed, say so at the start of
  its description, set `checked` to today, and list it under "For the owner to decide" in the PR.
- Don't move pins (the pin jobs do that) unless the finding is about position and an official source gives one.
- Update `checked` only on playgrounds you actually re-checked against an official source.
- Use WebSearch, then WebFetch on result links. Constructed URLs are often refused. Council sites that block automated
  reading need the browser, so list them in the PR as "couldn't check" rather than guessing.
- If the checker itself is wrong (a false alarm caused by its code, such as a council site redesign), fix the checker
  in `scripts/` in the same PR and add a test in `tests/`.

## Progress and finishing

- Work on one branch per issue: `claude/fix-check-<issue number>`. If an open PR from that branch already exists,
  carry on from it (push more commits) rather than starting again.
- Do up to about 150 findings per run, in the order the report lists them. Then comment on the issue: the PR link,
  what was done, and the first section and item the next run should start from.
- When every finding is dealt with (fixed, confirmed fine, left for the owner, or couldn't be checked), comment with a
  summary and close the issue. The PR stays open for the owner to review.
- Before opening or updating the PR: if playgrounds changed, make sure the "Update nearest toilets" workflow has run
  on the branch; then run `npm run build` and `npm test`.

## Finding types

### Quarterly playground check (`scripts/quarterly-check.mjs`)

Full lists are in the `quarterly-check` artifact on the run linked at the bottom of the issue (the issue shows at most
40 per list).

- **No longer on the council's list:** find the playground on the council's site. If it's there under another
  address, update the source link. If the council says it has closed or been removed, follow the never-delete rule.
  If it's simply missing from the list with no news either way, leave it and note it in the PR.
- **Possibly renamed:** check the council's page. If the council's name really has changed (e.g. "Tarner Park" is
  now "Tarnerland"), update `name` and the description, and keep the old name in the description ("formerly …") so
  parents can still find it. Don't rename the file: links must keep working. If every rename for one council shows
  the same generic text, it's a checker bug, not a rename.
- **New on the council's list:** leave these to the weekly "Check coverage" job, unless the report shows the
  council's entries without proper names (a checker bug: fix it).
- **Deleted from OpenStreetMap / no longer tagged as a playground / now private:** look on OpenStreetMap for a
  replacement playground nearby (re-mapped under a new id) and update the source link if there is one. Then look for
  an official source. If neither exists and there's evidence it has gone, follow the never-delete rule; otherwise note
  it in the PR.
- **Broken official links:** find the page's new address on the same site (councils often move a whole directory at
  once, so fix one and look for the pattern) and update the link. If the page has gone and nothing replaces it, use
  another official source for the same playground, or remove that one link and leave the playground's other sources.
  A playground left with no official source becomes Unverified if it has an OpenStreetMap source; otherwise list it
  under "For the owner to decide".
- **Not checked for over a year:** re-check against the official source and update details and `checked`.

### Yearly full accessibility scan (`tests/a11y-full.mjs`)

Every page is checked at 1280px and 375px wide against WCAG 2.2 AA with axe. The issue groups each problem once, with
how many pages it affects and up to 10 examples; every finding is in the `a11y-full` artifact on the run linked at the
bottom of the issue.

- **Start with the most widespread problems.** A problem on hundreds of pages is almost always one template or style
  (`src/pages/`, `src/components/`, `src/layouts/`, `src/styles/`), so fix it there once, not page by page.
- **Problems on a few pages only** usually come from one playground's data (a very long name, a description with odd
  characters, a photo without a screen-reader description). Fix the playground file, or make the template cope with
  that kind of data so it can't happen again.
- **Reproduce before fixing:** build, then run axe on the example pages with `A11Y_ONLY="/playgrounds/x/" node
  tests/a11y.mjs`. After the fix, run it again, and add a page that had the problem to `PAGES` in `tests/a11y.mjs` when
  it shows a kind of page the pull request checks don't cover yet.
- **"Couldn't be checked"** means the page didn't load within 30 seconds in the scan: open it, and if it loads fine,
  note it in the PR rather than changing anything.
- Don't change colours, fonts or layout beyond what the fix needs, and say in the PR which pages you checked.

### Cloudflare file count (`scripts/count-assets.mjs`)

The build checks count the built site's files against Cloudflare's limit per deploy (20,000 on the free Workers plan;
every playground page is one file). From 19,000 they warn and open one issue, "Site nearing Cloudflare's 20,000-file
limit"; at 20,000 they fail, because Cloudflare would refuse the deploy.

**This isn't fixed by editing playgrounds.** Never delete or merge playgrounds to get under the limit. Instead,
comment on the issue with the current count and how many files are left, and list the owner's options:

1. Upgrade to Workers Paid ($5 a month): the limit becomes 100,000. Then set `ASSET_LIMIT: 100000` in
   `.github/workflows/ci.yml` and close the issue.
2. Render playground pages in the Worker from one template and the playground data, so they stop being files at all.

Leave the issue open until the owner has decided. New-area imports can carry on until the check fails.

### Adding a new check

A new workflow that reports problems for fixing should open its issue with the `check-report` label
(`-f "labels[]=check-report"`), say in the issue body that nothing has been changed, and get a section here
describing each kind of finding and how to fix it. Reports that already have their own scheduled task (the weekly
tick-box review) don't use the label.
