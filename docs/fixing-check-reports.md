# Fixing automated check reports

Some GitHub workflows check the site without changing anything. As soon as a check finishes, the same run hands its
report to Claude (`.github/workflows/fix-check-report.yml`, using the Claude Code GitHub Action), which fixes what it
can from official sources and opens a pull request for the owner to review. Nothing is merged automatically.

If Claude isn't set up for the repository, fails, or doesn't finish, the run opens an issue labelled
**`check-report`** instead, with the whole report or just what's left. A daily scheduled Claude task ("Fix check
reports") reads every open `check-report` issue and carries on from there. This page is the playbook for both.

To turn on fixing in the same run, add one repository secret (Settings > Secrets and variables > Actions):
`CLAUDE_CODE_OAUTH_TOKEN` (run `claude setup-token` with a Claude subscription) or `ANTHROPIC_API_KEY` (billed per
use). Pull requests opened from Actions need "Allow GitHub Actions to create and approve pull requests" (Settings >
Actions > General). Without it, the fixes are left on a pushed `claude/fix-…` branch and the issue says so.

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
  carry on from it (push more commits) rather than starting again. If the issue says the same-run fix already opened
  a pull request (branch `claude/fix-<check>-<run id>`), carry on in that one instead.
- In the same-run fix (Actions), there's no 150 limit: work through the whole report, then write what's left, if
  anything, to `check-report/remaining.md` so the workflow can open an issue for it. Pull requests opened from
  Actions don't start other workflows, so run `node scripts/nearest-toilets.mjs` yourself.
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

### Adding a new check

A new workflow that reports problems for fixing should upload its report (a `.md` and the full `.json`) as an
artifact, then call `fix-check-report.yml` as its last job (see `quarterly-check.yml`), with `secrets: inherit`.
That fixes the findings in the same run and opens the `check-report` issue only when something is left. Give it a
section here describing each kind of finding and how to fix it. Reports that already have their own scheduled task (the weekly
tick-box review) don't use the label.
