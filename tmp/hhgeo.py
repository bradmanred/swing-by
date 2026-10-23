import json, time, math, urllib.request, urllib.parse
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
def get(u, data=None, t=60):
    with urllib.request.urlopen(urllib.request.Request(u, data=data, headers=UA), timeout=t) as r:
        return json.load(r)
sites = json.load(open("tmp/hh_sites.json"))
for s in sites:
    try:
        if s["pc"]:
            r = get("https://api.postcodes.io/postcodes/" + urllib.parse.quote(s["pc"]))["result"]
            s["lat"], s["lng"], s["how"] = r["latitude"], r["longitude"], "postcode"
    except Exception as e:
        s["err"] = str(e)[:80]
    if "lat" not in s:
        time.sleep(1.2)
        try:
            r = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": f'{s["name"]}, {s["town"]}', "format": "jsonv2", "limit": 1, "countrycodes": "gb,gg"}))
            if r: s["lat"], s["lng"], s["how"], s["dn"] = float(r[0]["lat"]), float(r[0]["lon"]), "name", r[0]["display_name"][:90]
        except Exception as e:
            s["err2"] = str(e)[:80]
    # the house itself, by name, for a better centre than the postcode
    time.sleep(1.2)
    try:
        r = get("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": f'{s["name"]}', "format": "jsonv2", "limit": 3, "countrycodes": "gb,gg"}))
        near = [x for x in r if "lat" in s and abs(float(x["lat"]) - s["lat"]) < 0.05 and abs(float(x["lon"]) - s["lng"]) < 0.08]
        if near: s["hlat"], s["hlng"], s["hdn"] = float(near[0]["lat"]), float(near[0]["lon"]), near[0]["display_name"][:90]
    except Exception:
        pass
HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
def km(a, b, c, d):
    r = math.pi / 180; h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
ok = [s for s in sites if "lat" in s]
for i in range(0, len(ok), 15):
    chunk = ok[i:i + 15]
    q = "[out:json][timeout:170];(" + "".join(f'nwr["leisure"="playground"](around:2000,{s.get("hlat", s["lat"])},{s.get("hlng", s["lng"])});' for s in chunk) + ");out center tags;"
    j = None
    for h in HOSTS:
        try:
            j = get(h, urllib.parse.urlencode({"data": q}).encode(), 180); break
        except Exception as e:
            print("fail", e); time.sleep(5)
    for s in chunk:
        c0 = (s.get("hlat", s["lat"]), s.get("hlng", s["lng"]))
        c = []
        for e in (j or {}).get("elements", []):
            cc = e.get("center", e); t = e.get("tags", {})
            d = km(c0[0], c0[1], cc["lat"], cc["lon"])
            if d <= 2: c.append(dict(osm=e["type"][0] + str(e["id"]), m=round(d * 1000), lat=cc["lat"], lng=cc["lon"], name=t.get("name", ""), access=t.get("access", "")))
        s["osm"] = sorted(c, key=lambda x: x["m"])[:6]
    time.sleep(3)
json.dump(sites, open("tmp/hh_geo.json", "w"), indent=1)
print(sum(1 for s in sites if "lat" in s), "of", len(sites))
