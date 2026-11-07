# Finding every playground in an area

Use this checklist whenever you add a new county or district, or check an existing one for gaps.

**Why it exists.** Welwyn Hatfield was first imported from the borough council's "play areas" directory alone. That list only covers small neighbourhood play areas run directly by the council. It left out:

- playgrounds inside playing fields run for the council by a leisure operator (King George V Playing Fields, Moneyhole Lane Playing Fields and Digswell Playing Fields, all run by Better)
- play areas run by town and parish councils (Welwyn, Northaw and Cuffley, North Mymms)

One council list is never the whole picture. Work through every source type below for each district before calling an area done.

## 1. List who runs playgrounds in the area

For each district, borough or unitary authority, write down every organisation that may run a play area:

| Who | Where to look | Herts examples |
| --- | --- | --- |
| District or borough council: play areas | The council's play area directory or "parks and play areas" pages. Check every category and the A to Z, not just one page. | welhat.gov.uk play area finder |
| District or borough council: parks and leisure sites | The council's "parks and leisure facilities" page. Large parks and playing fields are often listed here, not in the play area directory. | one.welhat.gov.uk council parks and leisure facilities |
| Leisure operators running council sites | The operator's site, for each venue it runs in the district. Look for "children's playground" or "play area" in the facilities. | Better (GLL), Everyone Active, Places Leisure, Fusion, Finesse Leisure |
| County-wide park portals | Search the portal for every town in the district. Note each park that mentions a play area or toddler area. | ParksHerts (parksherts.co.uk) |
| Town councils | The town council's parks, open spaces or play area pages. | Hatfield, Hertford, Bishop's Stortford, Harpenden, Berkhamsted, Tring, Royston |
| Parish councils | "Our services", "recreation grounds", "play areas" pages, the asset register and the playground inspection reports. Every parish in the district, not only the big ones. | Welwyn, Northaw and Cuffley, North Mymms, Woolmer Green |
| Trusts and foundations | Their own park pages. | Letchworth Garden City Heritage Foundation |
| County council | Country parks and countryside sites. | Hertfordshire County Council countryside sites |
| Unitary authority (also metropolitan and London boroughs) | One council does both the district's and the county's jobs, so check all of its play area and parks pages above, then two places a district list won't prompt for: its own country parks and countryside sites, which are usually on separate pages from the play area list, and play areas on its housing estates, which are listed under housing rather than parks (try "estate play areas", "housing open spaces" or the housing team's pages). | Brighton & Hove City Council: Stanmer Park (country park) and housing-estate play areas; Luton, Bedford and Central Bedfordshire |
| Charities and membership bodies | Their property pages. | National Trust, English Heritage, Historic Houses |
| Private attractions and estates | Their own websites (check opening and fees). | Knebworth, Aldenham Country Park |

### Councils on the two common website systems: add a feed, not files

Many councils' park directories run on **Jadu** (addresses like `/directory/26/…` with `/directory-record/123/` park pages) or **LocalGov Drupal** (a list page with `?page=1`, `?page=2`… and one page per park under it). For these, don't write playground files by hand: add a `feed` to the council's entry in `src/data/council-sources.json` and the coverage check imports its playgrounds, verified, with each pin moved onto the play area mapped on OpenStreetMap, and replacing any OpenStreetMap-only listing of the same place. For example:

```json
"feed": { "type": "jadu", "directory": "https://www.hounslow.gov.uk/directory/1010/parks-and-open-spaces-in-hounslow", "category": 86, "approximate": true }
"feed": { "type": "localgov", "directory": "https://haringey.gov.uk/leisure-parks-culture/parks-greenspaces/parks-facilities-haringey", "approximate": true }
```

Two more feed types cover most other councils:

- **`pages`**, for any other site whose park list links to one page per park (Richmond's A to Z, Kensington and Chelsea, Islington, Merton, Barking and Dagenham's parks site, The Royal Parks): `"feed": { "type": "pages", "index": "https://…/your-local-park", "follow": "/your-local-park/[a-z0-9-]+$" }`. `index` can be a list of pages, and `pages` lists park pages to read directly.
- **`list`**, for a council whose playgrounds are all on one page (Bexley's table, Westminster's and Hammersmith and Fulham's playground pages) or a site that refuses automated downloads: copy the rows into a CSV in `src/data/council-lists/` with `name`, `postcode`, `url` and, optionally, `text` (a short description in our own words, which becomes the playground's description and from which equipment and facilities are picked out) `park` (the park's name as mapped on OpenStreetMap, for rows without a postcode), `where` (a street and town, such as "Mercel Avenue, Armthorpe, Doncaster", looked up on OpenStreetMap's geocoder when nothing else places the row; give the feed a `near` so lookups stay in the right area) and `lat`/`lng` (the park's own point, for parks that share a name). Then add `"feed": { "type": "list", "file": "src/data/council-lists/bexley.csv", "page": "<the council page>" }`.

Parks with no map point or postcode on their page are found by name in the monthly OpenStreetMap snapshot, near the council's other parks or near `"near": { "lat", "lng", "km" }`. Add `"nameFrom": "title"` when every park page has the same heading, `"nameFirst": true` when a site's postcodes can't be trusted, and `"rename"` for a park whose page gives no usable name.

Only parks whose page mentions a playground or play area are kept; add `"allPlay": true` when the category is the council's own playgrounds list. The other options are described at the top of `scripts/council-readers.mjs`. Before adding a feed, check it with the **Try a council list** workflow (Actions tab, paste the feed line), which lists what it finds without changing anything. Then run **Check coverage** for the county with "Add up to this many" set, rather than waiting for the monthly run. Each council costs about 10 minutes of Actions time this way; councils on other systems still need pages saved with **Fetch pages** and the playgrounds added by hand.

### Town and parish councils: register them too

A district council's list never covers the play areas its town and parish councils run, and in many rural districts (most of Norfolk, Suffolk and Cambridgeshire, North Yorkshire) that's nearly all of them. Each town or parish council you check gets its own entry in `src/data/council-sources.json`, with its district and its `parish` exactly as postcodes.io names it (the parish shown for any postcode in it, such as "Knaresborough" or "Northaw and Cuffley"):

```json
{ "district": "North Yorkshire", "parish": "Knaresborough", "council": "Knaresborough Town Council", "sources": ["https://…/play-areas"], "note": "…", "feed": { "type": "list", "file": "src/data/council-lists/knaresborough.csv", "page": "https://…/play-areas" } }
```

Give it a `feed` (usually a small `list`) when it names its play areas; with no list, register it anyway with a `note` saying what you found, so it drops off the to-do table. Its feed is read whenever its district is checked, and its records replace any OpenStreetMap-only copies of the same play areas. Until a town or parish council is checked, its district's gaps there are still filled from OpenStreetMap as Unverified, and the coverage report lists it under "Then their town and parish councils".

## 2. Cross-check for gaps

After importing, look for playgrounds you may still have missed:

- **OpenStreetMap.** Compare against places tagged `leisure=playground` in the district (for example with overpass-turbo.eu). OpenStreetMap is a strong source: a playground mapped there can go in even when no council lists it. Use the OpenStreetMap page for the playground (for example `https://www.openstreetmap.org/way/123`) as its source, leave `checked` blank so the site labels it "Unverified" until an official source or a parent confirms it, and keep the OpenStreetMap credit. Check the council's own sources (section 1) first, and only fill the remaining gaps from OpenStreetMap: a council list usually gives a name, more detail and a verified listing. Once a district's council sources have been worked through, add it to `src/data/council-sources.json` so the monthly coverage check knows it can fill that district's remaining gaps from OpenStreetMap. Then do the same for its town and parish councils: the coverage report's "Then their town and parish councils" table lists those with the most playgrounds still missing, biggest first.
- **Playing fields and recreation grounds.** Search the council and ParksHerts for "playing field" and "recreation ground" in each town. Many have a play area that isn't listed separately.
- **Local knowledge.** Reports from parents (the Suggest form, or comments like "why isn't X listed?") often point straight at a missing source type. Add that source type here.

Don't use Google Maps or Google Places to find or place playgrounds. Their terms don't allow storing the data.

## 3. Adding each playground

- One JSON file per play area in `src/content/playgrounds/`. Name files `<name>-<town>.json` (no `c-` prefix: older files had one, and it was dropped in October 2026).
- `operator` says who runs it, for example "Welwyn Hatfield Borough Council (run by Better)" or "Welwyn Parish Council".
- `sources` links to the official page or pages you used: the council, operator, parish or ParksHerts page.
- `checked` is today's date only once an official source confirms the playground exists. Otherwise, including for playgrounds found only on OpenStreetMap, leave it blank, and the site labels it "Unverified".
- Position: use the site's own postcode, or the car park's postcode, via postcodes.io. If you only have a street, say "approximate" in `notConfirmed`. If you can't place it reasonably, leave it out and list it in the pull request.
- Moving a pin by hand: add its id to `src/data/pins-checked.json`, so the "Check pin positions" workflow never moves it back.
- `size` only when the council grades it: their own small/large categories, or the Fields in Trust grades, where LAP (Local Area for Play) = small, LEAP (Locally Equipped Area for Play) = medium and NEAP (Neighbourhood Equipped Area for Play) = large. Many councils publish these in their play strategy or play area list. Leave it out otherwise.
- `notConfirmed` lists anything the sources don't say: equipment, ages, toilets, parking, exact position.
- Don't guess equipment or ages. Leave them empty if the source doesn't say.
- `fee`: fill it in whenever it costs money to get into the playground, or into the place it's in (a National Trust garden, an estate, an attraction). Say who pays and how much, from the operator's own page, for example "Included with house, garden or farmyard tickets" or "Paid entry for non-members". Any playground with a `fee` gets the £ Paid entry badge and is hidden by the "Free entry only" filter. Leave it out when entry is free; paid parking alone doesn't count (put that under `nearby`).

## 4. Toilets and baby change

- If an official source lists toilets, add `wc` to `facilities`. Then look for baby change on the same pages: set `"babyChange": "yes"` if they say there is baby change, `"no"` only if they say there isn't, and leave it out if they don't say.
- Nearest toilets for every playground come from the Toilet Map's open data (CC BY 4.0) and live in `src/data/toilets.json`. Don't edit that file by hand. The "Update nearest toilets" workflow reruns `scripts/nearest-toilets.mjs` whenever playground files change on any branch, and commits the result to that branch, so a pull request for a new area picks up its toilets automatically. Check the workflow ran before merging. To run it yourself: `node scripts/nearest-toilets.mjs` (or `--csv <file>` with a CSV downloaded from toiletmap.org.uk/dataset).

## 5. In the pull request

Say which source types you checked for each district and which you couldn't check, so the next person knows where the gaps might be. The pull request template has a checklist for this.
