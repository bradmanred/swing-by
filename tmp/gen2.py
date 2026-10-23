import json, csv, math, re, os, sys
sys.path.insert(0, "tmp")
from sites2 import sites, retry
from derbys_sites import sites as old
D = "2026-10-23"
OUTDIR = sys.argv[1]
P2 = {j["key"]: j for j in json.load(open("tmp/pins2.json"))}
P3 = json.load(open("tmp/pins3.json")) if os.path.exists("tmp/pins3.json") else {}
osm = [dict(r, lat=float(r["lat"]), lng=float(r["lng"])) for r in csv.DictReader(open("tmp/derbyshire-osm.csv")) if r["access"] not in ("private", "no", "customers")]
def km(a, b, c, d):
    r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
GEN = set("play area areas playground playgrounds park parks recreation ground grounds rec playing field fields the and of road toddlers toddler children's childrens junior swings new old village".split())
def words(s): return {w for w in re.findall(r"[a-z]+", s.lower().replace("'", "")) if w not in GEN and len(w) > 2}
def slug(s): return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", ""))).strip("-")
used = {}
def place(key, name, area, pc_pos, cands, radius=250):
    """Returns (lat, lng, label) or None. cands: list of (lat, lng, type) from place lookups."""
    my = words(name) | words(area)
    # 1. a named OSM playground matching a distinctive word, within 1.5 km of any lookup
    pts = ([pc_pos] if pc_pos else []) + [(c[0], c[1]) for c in cands]
    for p in pts:
        named = sorted(((km(p[0], p[1], o["lat"], o["lng"]), o) for o in osm if o["name"] and words(o["name"]) & words(name)), key=lambda x: x[0])
        if named and named[0][0] < 1.5 and named[0][1]["osm"] not in used:
            o = named[0][1]; used[o["osm"]] = key
            return o["lat"], o["lng"], "Exact position (taken from OpenStreetMap)"
    # 2. nearest OSM playground close to the lookup, if its name doesn't contradict ours
    for p, lim in ([(pc_pos, 200)] if pc_pos else []) + [((c[0], c[1]), radius) for c in cands]:
        near = sorted(((km(p[0], p[1], o["lat"], o["lng"]) * 1000, o) for o in osm), key=lambda x: x[0])
        for d, o in near[:2]:
            if d > lim: break
            if o["osm"] in used: continue
            if o["name"] and not (words(o["name"]) & my) and words(o["name"]): continue
            used[o["osm"]] = key
            return o["lat"], o["lng"], "Exact position (taken from OpenStreetMap)"
    if pc_pos: return pc_pos[0], pc_pos[1], "Exact position (mapped from the postcode)"
    for c in cands:
        if re.match(r"(highway|leisure|landuse)/", c[2]) and not c[2].endswith(("trunk", "primary")):
            return c[0], c[1], "Exact position (approximate, from the street or place name)"
    return None

def cands_for(key):
    j = P2.get(key, {}); out = []
    if j.get("lat") is not None and j.get("method", "").startswith("name:"):
        out.append((j["lat"], j["lng"], j["method"].split(":")[1]))
    out += [(x["lat"], x["lng"], x["t"]) for x in P3.get(key, [])]
    return out

existing = set(os.listdir(OUTDIR))
written, left = [], []
def write(d, fid):
    if fid + ".json" in existing: fid = fid[:56] + "-2"
    existing.add(fid + ".json")
    open(f"{OUTDIR}/{fid}.json", "w").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    written.append(fid)
def nc(pos, s, has_desc_eq=False):
    bits = [pos, "age ranges"]
    if not has_desc_eq: bits.append("play equipment")
    bits.append("opening hours")
    if not s.get("wc"): bits.append("toilets")
    bits.append("parking")
    out = ", ".join(bits[:-1]) + " and " + bits[-1] + "."
    if s.get("note"): out += f" {s['note']}, so check it's still there."
    return out
# Sort so sites with postcodes claim OSM playgrounds first
order = sorted(sites, key=lambda s: 0 if s.get("pc") else 1)
for s in order:
    key = s["n"] + "|" + s["a"]
    j = P2.get(key, {})
    pc_pos = (j["lat"], j["lng"]) if j.get("method") == "postcode" else None
    r = place(key, s["n"], s["a"], pc_pos, cands_for(key), radius=800 if "Chatsworth" in s["n"] else 250)
    if not r:
        left.append((s["n"], s["a"], s["d"])); continue
    lat, lng, pos = r
    eq_in_desc = bool(re.search(r"(?i)slide|swing|zip|climb|roundabout|springer|seesaw|sand", s["desc"]))
    d = {"name": s["n"], "region": "derbyshire", "area": s["a"], "lat": round(lat, 5), "lng": round(lng, 5), "ages": [], "equipment": [], "access": [],
         "facilities": ["wc"] if s.get("wc") else [], "opens": "", "description": s["desc"] + (f" Postcode {s['pc']}." if s.get("pc") and pos.endswith("postcode)") else ""),
         "nearby": [{"type": t, "label": l} for t, l in s.get("nearby", [])], "operator": s.get("op"),
         "sources": [{"label": l, "url": u} for l, u in s["src"]], "checked": D, "notConfirmed": nc(pos, s, eq_in_desc), "photo": None}
    if s.get("bc"): d["babyChange"] = True
    if s.get("fee"): d["fee"] = s["fee"]
    if not d["operator"]: del d["operator"]
    write(d, "c-" + slug(s["n"] + "-" + s["a"])[:60])
# Part 1 leftovers
for s in old:
    k = (s["name"], s["district"])
    if k not in retry: continue
    key = "OLD|" + s["name"] + "|" + s["district"]
    r = place(key, s["name"], s["locality"], None, cands_for(key))
    if not r:
        left.append((s["name"], s["locality"], s["district"])); continue
    lat, lng, pos = r
    parts = [x.strip() for x in s["name"].split(",")]
    base = parts[0]
    if base.endswith(" Rec"): base = base[:-4] + " Recreation Ground"
    disp = base if re.search(r"(?i)play|park|recreation|field|ground", base) else base + " Play Area"
    if s["district"] == "Chesterfield" and len(parts) > 1:
        area = next((x for x in reversed(parts[1:]) if not re.match(r"(?i)off |.*(road|lane|drive)$", x)), "Chesterfield")
    else:
        area = s["locality"]
    op = s["op"]
    descs = {"High Peak": f"Play area looked after by High Peak Borough Council in {area}, with a range of equipment for children aged 0 to 12.",
             "Chesterfield": "Play area on Chesterfield Borough Council's list of parks and play areas.",
             "Erewash": f"Play area listed by Erewash Borough Council and run by {op}.",
             "Bolsover": f"Play area on one of Old Bolsover Town Council's recreation grounds.",
             "Derbyshire Dales": "Play area on Derbyshire Dales District Council's list of smaller parks and play areas."}
    labels = {"High Peak": "High Peak Borough Council: play areas", "Chesterfield": "Chesterfield Borough Council: parks and play areas",
              "Erewash": "Erewash Borough Council: play areas", "Bolsover": "Old Bolsover Town Council: playgrounds", "Derbyshire Dales": "Derbyshire Dales District Council: smaller parks and gardens"}
    ages = s.get("ages") or []
    bits = [pos] + ([] if ages else ["age ranges"]) + ["play equipment", "opening hours", "toilets", "parking"]
    d = {"name": disp, "region": "derbyshire", "area": area, "lat": round(lat, 5), "lng": round(lng, 5), "ages": ages, "equipment": [], "access": [], "facilities": [],
         "opens": "", "description": descs[s["district"]], "nearby": [], "operator": op, "sources": [{"label": s.get("srclabel") or labels[s["district"]], "url": s["src"]}],
         "checked": D, "notConfirmed": ", ".join(bits[:-1]) + " and " + bits[-1] + ".", "photo": None}
    write(d, "c-" + slug(disp + "-" + area)[:60])
print(len(written), "written;", len(left), "left out")
json.dump(left, open("tmp/left2.json", "w"), indent=1)
for l in left: print("  LEFT", l)
