# For junctions with no playground listed nearby: OpenStreetMap playgrounds within 3 km, the park each sits in, and the council area.
import json, time, math, urllib.request, urllib.parse
todo = json.load(open("tmp/todo-junctions.json"))
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
def post(q):
    for h in HOSTS:
        try:
            with urllib.request.urlopen(urllib.request.Request(h, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA), timeout=200) as r:
                return json.load(r)
        except Exception as e:
            print("fail", h, e); time.sleep(5)
def km(a, b, c, d):
    r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
out = []
for i in range(0, len(todo), 10):
    chunk = todo[i:i + 10]
    q = "[out:json][timeout:180];(" + "".join(f'nwr["leisure"="playground"](around:3000,{j["lat"]},{j["lng"]});' for j in chunk) + ");out center tags;"
    pg = (post(q) or {}).get("elements", [])
    q2 = "[out:json][timeout:180];(" + "".join(f'way["leisure"~"^(park|recreation_ground)$"]["name"](around:3200,{j["lat"]},{j["lng"]});way["landuse"="recreation_ground"]["name"](around:3200,{j["lat"]},{j["lng"]});' for j in chunk) + ");out center tags bb;"
    parks = (post(q2) or {}).get("elements", [])
    for j in chunk:
        c = []
        for e in pg:
            cc = e.get("center", e); t = e.get("tags", {})
            if t.get("access") in ("private", "no", "customers"): continue
            d = km(j["lat"], j["lng"], cc["lat"], cc["lon"])
            if d > 3: continue
            inpark = ""
            for p in parks:
                b = p.get("bounds")
                if b and b["minlat"] <= cc["lat"] <= b["maxlat"] and b["minlon"] <= cc["lon"] <= b["maxlon"]:
                    inpark = p["tags"].get("name", ""); break
            c.append(dict(osm=e["type"][0] + str(e["id"]), m=round(d * 1000), lat=round(cc["lat"], 6), lng=round(cc["lon"], 6), name=t.get("name", ""), park=inpark, operator=t.get("operator", "")))
        c.sort(key=lambda x: x["m"])
        out.append(dict(j, cands=c[:12]))
    time.sleep(3)
# council area for each candidate (postcodes.io bulk reverse)
pts = [(o, c) for o in out for c in o["cands"]]
for i in range(0, len(pts), 100):
    body = json.dumps({"geolocations": [{"longitude": c["lng"], "latitude": c["lat"], "radius": 2000, "limit": 1} for _, c in pts[i:i + 100]]}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request("https://api.postcodes.io/postcodes", data=body, headers={**UA, "Content-Type": "application/json"}), timeout=60) as r:
            res = json.load(r)["result"]
        for (o, c), rr in zip(pts[i:i + 100], res):
            x = (rr.get("result") or [{}])[0]
            c["pc"] = x.get("postcode"); c["district"] = x.get("admin_district"); c["ward"] = x.get("admin_ward"); c["parish"] = x.get("parish")
    except Exception as e:
        print("pc fail", e)
json.dump(out, open("tmp/near.json", "w"), indent=1)
print(len(out), sum(len(o["cands"]) for o in out))
