# Named OpenStreetMap playgrounds near junctions with no playground listed (via Nominatim, 1 request a second), plus the council area.
import json, time, urllib.request, urllib.parse, math
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
todo = json.load(open("tmp/todo-junctions.json"))
def get(u, data=None, h=None):
    with urllib.request.urlopen(urllib.request.Request(u, data=data, headers={**UA, **(h or {})}), timeout=60) as r:
        return json.load(r)
def km(a, b, c, d):
    r = math.pi / 180; x = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))
out = []
for j in todo:
    dl, dg = 0.045, 0.072
    vb = f'{j["lng"]-dg},{j["lat"]+dl},{j["lng"]+dg},{j["lat"]-dl}'
    c = []
    for q in ["playground", "play area"]:
        time.sleep(1.1)
        try:
            res = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 40, "viewbox": vb, "bounded": 1, "countrycodes": "gb"}))
        except Exception as e:
            print("fail", e); res = []
        for x in res:
            if x.get("type") != "playground" and "play" not in x.get("name", "").lower(): continue
            d = km(j["lat"], j["lng"], float(x["lat"]), float(x["lon"]))
            if d <= 4.8 and not any(y["osm"] == x["osm_type"][0] + str(x["osm_id"]) for y in c):
                c.append(dict(osm=x["osm_type"][0] + str(x["osm_id"]), name=x.get("name", ""), dn=x["display_name"][:140], m=round(d * 1000), lat=float(x["lat"]), lng=float(x["lon"]), type=x.get("type")))
    c.sort(key=lambda y: y["m"])
    out.append(dict(j, cands=c[:10]))
pts = [c for o in out for c in o["cands"]]
for i in range(0, len(pts), 100):
    body = json.dumps({"geolocations": [{"longitude": c["lng"], "latitude": c["lat"], "radius": 2000, "limit": 1} for c in pts[i:i + 100]]}).encode()
    try:
        res = get("https://api.postcodes.io/postcodes", body, {"Content-Type": "application/json"})["result"]
        for c, rr in zip(pts[i:i + 100], res):
            x = (rr.get("result") or [{}])[0]
            c["pc"] = x.get("postcode"); c["district"] = x.get("admin_district"); c["parish"] = x.get("parish")
    except Exception as e:
        print("pc fail", e)
json.dump(out, open("tmp/cands.json", "w"), indent=1)
print(len(out), sum(1 for o in out if o["cands"]), len(pts))
