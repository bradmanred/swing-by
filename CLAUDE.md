# Notes for working on Swing By

- Before adding playgrounds, or checking an area for missing ones, read `docs/finding-playgrounds.md` and work through every source type in it for each district. One council list is never complete: playing fields run by leisure operators and town or parish council play areas are easy to miss.
- Follow the content rules in `README.md`: an official source for every playground, no Google Maps or Places data, and openly licensed photos only.
- Run `npm run build` and `npm test` before opening a pull request.
- House line: "See-saw you there!" Use it sparingly, as a friendly sign-off. It currently appears once, under the directions button on playground pages. Don't add it anywhere else without a good reason.
- Parent photos are moderated: never show an upload until a moderator approves it at /moderate/, and keep the "no people in photos" guidelines next to the upload form.
- Toilets: playgrounds with toilets get a baby change flag (`babyChange`, from official sources only). Every playground also shows its nearest public toilets from `src/data/toilets.json`, which the "Update nearest toilets" workflow regenerates. When adding an area, make sure that workflow has run on the branch (see `docs/finding-playgrounds.md`).
