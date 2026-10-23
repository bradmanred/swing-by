import json, re, os, sys
OUT = sys.argv[1]
D = "2026-10-23"
REG = {
 'essex': ['Essex'],
 'east': ['Cambridgeshire', 'Norfolk', 'Suffolk', 'Bedfordshire'],
 'south-east': ['Kent', 'Surrey', 'East Sussex', 'West Sussex', 'Hampshire', 'Isle of Wight', 'Buckinghamshire', 'Oxfordshire', 'Berkshire'],
 'south-west': ['Cornwall', 'Dorset', 'Somerset', 'North Somerset', 'Wiltshire', 'Gloucestershire', 'South Gloucestershire', 'Bath and NE Somerset'],
 'devon': ['Devon'],
 'west-midlands': ['Shropshire', 'Staffordshire', 'Herefordshire', 'Worcestershire', 'West Midlands'],
 'east-midlands': ['Lincolnshire', 'Nottinghamshire', 'Leicestershire'],
 'derbyshire': ['Derbyshire'],
 'yorkshire': ['North Yorkshire', 'West Yorkshire', 'South Yorkshire', 'East Yorkshire'],
 'north-west': ['Cumbria', 'Lancashire', 'Cheshire', 'Greater Manchester', 'Merseyside'],
 'north-east': ['Northumberland', 'County Durham', 'Tyne & Wear'],
 'wales': ['Wrexham', 'Conwy', 'Gwynedd', 'Anglesey', 'Vale of Glamorgan'],
 'scotland': ['Fife', 'Ayrshire', 'Clackmannanshire', 'Berwickshire', 'Perthshire', 'Scottish Borders', 'Moray', 'Dumfriesshire'],
 'northern-ireland': ['County Fermanagh', 'County Armagh', 'County Down', 'County Antrim'],
 'london': ['London'],
 'channel-islands': ['Channel Islands'],
}
C2R = {c: r for r, cs in REG.items() for c in cs}
EH_COUNTY = {'1066-battle-of-hastings-abbey-and-battlefield': ('East Sussex', 'Battle'), 'boscobel-house-and-the-royal-oak': ('Shropshire', 'Bishops Wood'),
 'audley-end-house-and-gardens': ('Essex', 'Saffron Walden'), 'witley-court-and-gardens': ('Worcestershire', 'Great Witley'), 'osborne': ('Isle of Wight', 'East Cowes'),
 'walmer-castle-and-gardens': ('Kent', 'Deal'), 'brodsworth-hall-and-gardens': ('South Yorkshire', 'Doncaster'), 'marble-hill': ('London', 'Twickenham'),
 'stokesay-castle': ('Shropshire', 'Craven Arms'), 'chiswick-house': ('London', 'Chiswick'), 'denny-abbey-and-the-farmland-museum': ('Cambridgeshire', 'Waterbeach'),
 'dover-castle': ('Kent', 'Dover'), 'belsay-hall-castle-and-gardens': ('Northumberland', 'Belsay')}
EH_DESC = {
 '1066-battle-of-hastings-abbey-and-battlefield': 'A bespoke natural play area at the site of the Battle of Hastings, with plenty of space on the battlefield to run around.',
 'boscobel-house-and-the-royal-oak': 'Play area at Boscobel House, where Charles II hid in the Royal Oak.',
 'audley-end-house-and-gardens': 'New play area at the Cart Yard, next to the Cart Yard café, inspired by Audley End\'s history.',
 'witley-court-and-gardens': 'The Wilderness play area, near the Wilderness Walk at Witley Court.',
 'osborne': 'Children\'s play area near the visitor car park at Osborne, Queen Victoria\'s seaside home.',
 'walmer-castle-and-gardens': 'Natural play trail with hollow tree trunks, climbing frames, a swing and a wobbly bridge.',
 'brodsworth-hall-and-gardens': 'Designated play area close to the gardens at Brodsworth Hall.',
 'marble-hill': 'Play area with a mini trampoline, climbing area and willow tunnel in the park at Marble Hill.',
 'stokesay-castle': 'Brand-new inclusive playground inspired by the castle\'s towers and gatehouse, near the tearoom.',
 'chiswick-house': 'Children\'s adventure playground for under-7s near the Chiswick House café.',
 'denny-abbey-and-the-farmland-museum': 'Children\'s play area at the Farmland Museum, popular with younger visitors.',
 'dover-castle': 'Playground inspired by Dover Castle\'s history.',
 'belsay-hall-castle-and-gardens': 'The Wild Man play area at Belsay.'}
EH_FREE = {'marble-hill', 'chiswick-house'}  # parks that are free to enter
GENERIC = set("play area areas playground playgrounds park the and of at natural adventure outdoor woodland wild trail den children's childrens house hall castle garden gardens estate".split())
def words(s): return {w for w in re.findall(r"[a-z']+", s.lower()) if w not in GENERIC and len(w) > 2}
def slug(s): return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", ""))).strip("-")

def choose(cands, name, feat, exclude=()):
    cands = [c for c in cands if c["access"] not in ("private", "no") and c["osm"] not in exclude]
    cust = [c for c in cands if c["access"] == "customers" and c["m"] <= 1300]
    if cust: return cust[0]
    my = words(name) | words(feat)
    named = [c for c in cands if c["name"] and (words(c["name"]) & my) and c["m"] <= 1500]
    if named: return named[0]
    for c in cands:
        if c["m"] <= 500 and (not c["name"] or c["m"] <= 150): return c
    return None

def write(d, fid):
    path = f"{OUT}/{fid}.json"
    if os.path.exists(path): fid += "-2"; path = f"{OUT}/{fid}.json"
    open(path, "w").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    return fid

def entry(name, region, area, lat, lng, pos, desc, op, mem, fee, src, wc, bc, extra_nc=""):
    nc = [pos, "age ranges", "play equipment", "opening hours"]
    if not wc: nc.append("toilets")
    nc.append("parking")
    d = {"name": name, "region": region, "area": area, "lat": round(lat, 5), "lng": round(lng, 5), "ages": [], "equipment": [], "access": [],
         "facilities": ["wc"] if wc else [], "opens": "", "description": desc, "nearby": [], "operator": op}
    if mem: d["membership"] = mem
    if fee: d["fee"] = fee
    if bc: d["babyChange"] = True
    d.update({"sources": src, "checked": D, "notConfirmed": ", ".join(nc[:-1]) + " and " + nc[-1] + "." + extra_nc, "photo": None})
    return d

written, skipped = [], []
existing_names = {json.load(open(f"{OUT}/{f}"))["name"].lower() for f in os.listdir(OUT)}
NT_BEST = {"label": "National Trust: best natural play areas", "url": "https://www.nationaltrust.org.uk/visit/family-friendly/best-natural-play-areas-for-kids"}
NT_FREE_PARK = {"bath-skyline", "box-hill", "derrymore-house", "fell-foot", "heddon-valley", "lorna-doone-valley", "rainham-hall", "ilam-park-dovedale-and-the-white-peak", "woodchester-park", "dudmaston-estate-comer-woods", "murlough-national-nature-reserve", "hatchlands-park"}
NT_PRICE_EXTRA = {"attingham-park": "13.75/", "clumber-park": "7.20/", "croft-castle-and-parkland": "18.75/"}
nt_osm = json.load(open("tmp/memosm.json"))
for l in open("tmp/nt_rows.txt").read().strip().split("\n"):
    title, county, ll, pc, flags, feat, path, price = l.split("|")
    title = title.replace("&", " and ")
    key = path.split("/")[-1]
    if key in ("morden-hall-park",): skipped.append((title, "already listed")); continue
    region = C2R[county]
    lat, lng = map(float, ll.split(","))
    feats = [f for f in feat.split("/") if f and not re.search(r"(?i)indoor|café|cafe|maze|display", f)]
    fname = feats[0] if feats else "Play area"
    fname = re.sub(r"(?i)^home farm & play area.*", "Play area", fname)
    disp = f"{title} {fname[0].lower() + fname[1:] if fname.lower().startswith(('play', 'natural', 'woodland', 'wild', 'adventure', 'outdoor')) else fname}"
    disp = disp.replace(" play areas", " Play Areas").replace(" play area", " Play Area")
    if fname.lower().startswith(("play", "natural", "woodland", "wild", "adventure", "outdoor")):
        disp = title + " " + " ".join(w.capitalize() if w not in ("and", "of") else w for w in fname.split())
    else:
        disp = f"{fname}, {title}"
    if disp.lower() in existing_names: skipped.append((title, "already listed")); continue
    c = choose(nt_osm.get(path, []), title, fname)
    if c: plat, plng, pos = c["lat"], c["lng"], "Exact position (taken from OpenStreetMap)"
    else: plat, plng, pos = lat, lng, "Exact position of the play area (the pin shows the property)"
    free = "f" in flags or key in NT_FREE_PARK
    pr = price if price != "/" else NT_PRICE_EXTRA.get(key, "/")
    a, ch = pr.split("/")
    fee = None
    if not free:
        bits = []
        if a: bits.append(f"£{a} adult")
        if ch: bits.append(f"£{ch} child (5–17)")
        fee = "Non-members pay to visit" + (f": {', '.join(bits)}, under-5s free" if bits else "") + ". National Trust members get in free."
    feats_txt = " and ".join(feats[:2]) if feats else "a natural play area"
    desc = f"{feats_txt[0].upper() + feats_txt[1:]} at {title}, as the National Trust lists it." if feats else f"Natural play area at {title}, one of the National Trust's picks of its best natural play areas."
    if free: desc += " The place is free to visit; parking may be charged."
    src = [{"label": f"National Trust: {title}", "url": "https://www.nationaltrust.org.uk/visit/" + path}]
    if not feats or key in ("anglesey-abbey-gardens-and-lode-mill",): src.append(NT_BEST)
    town = county
    fid = write(entry(disp, region, title if region not in ("london",) else title, plat, plng, pos, desc, "National Trust", "nt", fee, src, "w" in flags, False), "c-" + slug(disp)[:60])
    written.append((fid, region, pos[:30]))

eh_osm = nt_osm
for path, (county, town) in EH_COUNTY.items():
    site = next(s for s in json.load(open("tmp/mem_sites.json")) if s["path"] == path)
    title = site["name"]
    region = C2R[county]
    c = choose(eh_osm.get(path, []), title, "play")
    if c: plat, plng, pos = c["lat"], c["lng"], "Exact position (taken from OpenStreetMap)"
    else: plat, plng, pos = site["lat"], site["lng"], "Exact position of the play area (the pin shows the property)"
    fee = None if path in EH_FREE else "Non-members pay to visit. English Heritage members get in free."
    desc = EH_DESC[path] + (" The grounds are free to visit." if path in EH_FREE else "")
    src = [{"label": f"English Heritage: {title} facilities", "url": f"https://www.english-heritage.org.uk/visit/places/{path}/plan-your-visit/facilities/"},
           {"label": "English Heritage: the best play areas at English Heritage sites", "url": "https://www.english-heritage.org.uk/visit/familydaysout/english-heritage-play-areas/"}]
    disp = f"{title} Play Area" if "playground" not in desc.lower() else f"{title} Playground"
    if path == "walmer-castle-and-gardens": disp = "Walmer Castle Play Trail"
    if path == "witley-court-and-gardens": disp = "Witley Court Wilderness Play Area"
    if path == "belsay-hall-castle-and-gardens": disp = "Belsay Wild Man Play Area"
    if path == "1066-battle-of-hastings-abbey-and-battlefield": disp = "1066 Battle Abbey Natural Play Area"
    if disp.lower() in existing_names: skipped.append((title, "already listed")); continue
    fid = write(entry(disp, region, town, plat, plng, pos, desc, "English Heritage" if path != "chiswick-house" else "Chiswick House and Gardens Trust, with English Heritage", "eh", fee, src, True, True), "c-" + slug(disp)[:60])
    written.append((fid, region, pos[:30]))

# Historic Houses
HH_DESC = json.load(open("tmp/hh_desc.json")) if os.path.exists("tmp/hh_desc.json") else {}
HH_PUBLIC = {"towneley-hall", "temple-newsam-house", "fulham-palace-trust", "tatton-park", "sandringham"}
if os.path.exists("tmp/hh_geo.json"):
    for s in json.load(open("tmp/hh_geo.json")):
        if not s["m"]: skipped.append((s["name"], "Historic Houses members don't get in free, and the entry charge isn't on its page")); continue
        if s.get("lat") is None: skipped.append((s["name"], "couldn't place it")); continue
        region = C2R.get(s["county"]) or {"Hertfordshire": "herts"}.get(s["county"])
        c = choose(s.get("osm", []), s["name"], HH_DESC.get(s["path"], ""))
        if c: plat, plng, pos = c["lat"], c["lng"], "Exact position (taken from OpenStreetMap)"
        else:
            plat, plng = s.get("hlat", s["lat"]), s.get("hlng", s["lng"])
            pos = "Exact position of the play area (the pin shows the property)"
        fee = None if s["path"] in HH_PUBLIC else "Non-members pay to visit. Historic Houses members get in free."
        desc = HH_DESC.get(s["path"], f"Play area at {s['name']}, as Historic Houses lists it.")
        extra = " Whether the play area is free to use." if s["path"] in HH_PUBLIC else ""
        disp = f"{s['name']} Play Area"
        if disp.lower() in existing_names: skipped.append((s["name"], "already listed")); continue
        src = [{"label": f"Historic Houses: {s['name']}", "url": f"https://www.historichouses.org/house/{s['path']}/"}]
        fid = write(entry(disp, region, s["town"], plat, plng, pos, desc, s["name"], "hh", fee, src, False, False, extra), "c-" + slug(disp)[:60])
        written.append((fid, region, pos[:30]))
import collections
print(len(written), "written", collections.Counter(w[1] for w in written), collections.Counter(w[2] for w in written))
for s in skipped: print("SKIP", s)
json.dump(skipped, open("tmp/mem_skipped.json", "w"))
