# All OpenStreetMap playgrounds in Essex, Southend and Thurrock, for placing pins (not for adding playgrounds).
import json, csv, time, urllib.request, urllib.parse
HOSTS = ["https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
def run(q):
    for a in range(3):
        for h in HOSTS:
            try:
                with urllib.request.urlopen(urllib.request.Request(h, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "swing-by-playground-audit"}), timeout=300) as r:
                    return json.load(r), h
            except Exception as e:
                print("fail", h, e); time.sleep(10)
    return None, None
w = csv.writer(open("tmp/essex-osm.csv", "w", newline=""))
w.writerow(["osm", "lat", "lng", "name", "operator", "access"])
for name in ["Essex", "Southend-on-Sea", "Thurrock"]:
    q = f'[out:json][timeout:280];area["boundary"="administrative"]["name"="{name}"]["admin_level"="6"]->.a;nwr["leisure"="playground"](area.a);out center tags;'
    j, h = run(q)
    print(name, h, len((j or {}).get("elements", [])))
    for e in (j or {}).get("elements", []):
        c = e.get("center", e); t = e.get("tags", {})
        w.writerow([e["type"][0] + str(e["id"]), round(c["lat"], 6), round(c["lon"], 6), t.get("name", ""), t.get("operator", ""), t.get("access", "")])
