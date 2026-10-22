# Pins each Derbyshire site: postcode (postcodes.io) or place name (Nominatim, 1 request a second),
# then snaps to the nearest OpenStreetMap playground within range. Writes tmp/pins.json.
import json, csv, math, time, urllib.request, urllib.parse, sys
sys.path.insert(0, "tmp")
from derbys_sites import sites
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return json.load(r)
def km(a, b, c, d):
    r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
osm = [dict(r, lat=float(r["lat"]), lng=float(r["lng"])) for r in csv.DictReader(open("derbyshire-osm.csv")) if r["access"] not in ("private", "no", "customers")]
VIEW = "-2.05,53.55,-1.15,52.68"  # Derbyshire bounding box for Nominatim
out = []
for s in sites:
    res = dict(name=s["name"], district=s["district"], locality=s["locality"])
    lat = lng = None; method = None
    try:
        if s.get("postcode"):
            j = get("https://api.postcodes.io/postcodes/" + urllib.parse.quote(s["postcode"]))
            lat, lng, method = j["result"]["latitude"], j["result"]["longitude"], "postcode"
    except Exception as e:
        res["pc_err"] = str(e)
    if lat is None:
        base = s["name"].replace(" Play Area", "").replace(" Playground", "").replace(" Junior Area", "").replace(" Toddler Area", "")
        for q in [f'{base}, {s["locality"]}, Derbyshire', f'{base.split(",")[0]}, {s["locality"]}, Derbyshire', f'{base.split(",")[0]}, {s["district"]}']:
            try:
                time.sleep(1.1)
                j = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 3, "countrycodes": "gb", "viewbox": VIEW, "bounded": 1}))
                if j:
                    lat, lng, method = float(j[0]["lat"]), float(j[0]["lon"]), "name:" + j[0].get("type", "") + ":" + j[0].get("display_name", "")[:80]
                    break
            except Exception as e:
                res["nom_err"] = str(e)
    res.update(geo_lat=lat, geo_lng=lng, method=method)
    if lat is not None:
        cand = sorted(((km(lat, lng, o["lat"], o["lng"]) * 1000, o) for o in osm), key=lambda x: x[0])[:3]
        res["nearest"] = [dict(osm=o["osm"], m=round(d), lat=o["lat"], lng=o["lng"], name=o["name"]) for d, o in cand]
    out.append(res)
json.dump(out, open("tmp/pins.json", "w"), indent=1)
print(len(out), "sites;", sum(1 for r in out if r.get("geo_lat") is None), "not located")
