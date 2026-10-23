import json, csv, math, time, urllib.request, urllib.parse, sys
sys.path.insert(0, "tmp")
from sites2 import sites, retry
from derbys_sites import sites as old
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return json.load(r)
def km(a, b, c, d):
    r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
osm = [dict(r, lat=float(r["lat"]), lng=float(r["lng"])) for r in csv.DictReader(open("tmp/derbyshire-osm.csv")) if r["access"] not in ("private", "no", "customers")]
VIEW = "-2.05,53.55,-1.15,52.68"
jobs = [dict(key=s["n"] + "|" + s["a"], pc=s.get("pc"), q=s.get("q"), chk=s.get("chk")) for s in sites]
for s in old:
    k = (s["name"], s["district"])
    if k in retry: jobs.append(dict(key="OLD|" + s["name"] + "|" + s["district"], pc=None, q=retry[k][0], chk=retry[k][1]))
out = []
for j in jobs:
    lat = lng = None; method = None
    if j["pc"]:
        try:
            r = get("https://api.postcodes.io/postcodes/" + urllib.parse.quote(j["pc"]))["result"]
            lat, lng, method = r["latitude"], r["longitude"], "postcode"
        except Exception as e:
            j["err"] = str(e)
    if lat is None and j["q"]:
        try:
            time.sleep(1.1)
            res = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": j["q"] + ", Derbyshire", "format": "jsonv2", "limit": 5, "countrycodes": "gb", "viewbox": VIEW, "bounded": 1}))
            res = [x for x in res if j["chk"].lower() in x.get("display_name", "").lower()] or []
            if not res:
                time.sleep(1.1)
                res = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": j["q"], "format": "jsonv2", "limit": 5, "countrycodes": "gb", "viewbox": VIEW, "bounded": 1}))
                res = [x for x in res if j["chk"].lower() in x.get("display_name", "").lower()]
            if res:
                x = res[0]; lat, lng = float(x["lat"]), float(x["lon"]); method = "name:" + x.get("category", "") + "/" + x.get("type", "") + ":" + x["display_name"][:90]
        except Exception as e:
            j["err"] = str(e)
    j.update(lat=lat, lng=lng, method=method)
    if lat is not None:
        cand = sorted(((km(lat, lng, o["lat"], o["lng"]) * 1000, o) for o in osm), key=lambda x: x[0])[:3]
        j["nearest"] = [dict(osm=o["osm"], m=round(d), lat=o["lat"], lng=o["lng"], name=o["name"]) for d, o in cand]
    out.append(j)
json.dump(out, open("tmp/pins2.json", "w"), indent=1)
print(len(out), "jobs;", sum(1 for r in out if r.get("lat") is None), "not located")
