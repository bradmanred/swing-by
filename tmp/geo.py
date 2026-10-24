# Geocode council play area names with Nominatim (1 request a second) and postcodes with postcodes.io.
import json, time, urllib.request, urllib.parse
UA = {"User-Agent": "swing-by.co.uk playground finder (github.com/bradmanred/swing-by)"}
def get(u, data=None, headers={}):
    r = urllib.request.Request(u, data=data, headers={**UA, **headers})
    with urllib.request.urlopen(r, timeout=40) as f: return json.load(f)
q = json.load(open("tmp/geo-q.json")); out = {}
pcs = [x["pc"] for x in q if x.get("pc")]
try:
    res = get("https://api.postcodes.io/postcodes", json.dumps({"postcodes": pcs}).encode(), {"Content-Type": "application/json"})["result"]
    pc = {r["query"]: [r["result"]["latitude"], r["result"]["longitude"]] for r in res if r["result"]}
except Exception as e: pc = {}; print("pc", e)
for x in q:
    o = {}
    if x.get("pc") in pc: o["pc"] = pc[x["pc"]]
    vb = "&viewbox=-4.25,50.45,-3.95,50.30&bounded=1" if x["k"].startswith("p") else ""
    for qq in [x["q"], x["q"].replace(" playground", "").replace(" open space", "").replace(" Open Space", "")]:
        try:
            r = get("https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=gb&q=" + urllib.parse.quote(qq) + vb)
            if r: o["n"] = [[float(a["lat"]), float(a["lon"]), a["class"] + "/" + a["type"], a["display_name"][:70]] for a in r]; break
        except Exception as e: o["err"] = str(e)[:80]
        time.sleep(1.1)
    out[x["k"]] = o; time.sleep(1.1)
json.dump(out, open("tmp/geo-out.json", "w"), indent=0)
print(sum(1 for v in out.values() if "n" in v), "of", len(q))
