import json, csv, time, urllib.request, urllib.parse
DISTRICTS = [("Derby", "6|8"), ("Amber Valley", "8"), ("Bolsover", "8"), ("Chesterfield", "8"), ("Derbyshire Dales", "8"),
             ("Erewash", "8"), ("High Peak", "8"), ("North East Derbyshire", "8"), ("South Derbyshire", "8")]
HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
def run(q):
    for h in HOSTS:
        for attempt in range(2):
            try:
                data = urllib.parse.urlencode({"data": q}).encode()
                with urllib.request.urlopen(urllib.request.Request(h, data=data, headers={"User-Agent": "swing-by-playground-audit"}), timeout=180) as r:
                    return json.load(r), h
            except Exception as e:
                print("fail", h, e); time.sleep(5)
    return None, None
w = csv.writer(open("derbyshire-osm.csv", "w", newline=""))
w.writerow(["osm", "district", "lat", "lng", "name", "operator", "access", "playground", "min_age", "max_age", "landuse_name"])
log = []
for name, lvl in DISTRICTS:
    q = f'[out:json][timeout:170];area["boundary"="administrative"]["name"="{name}"]["admin_level"~"^({lvl})$"]->.a;nwr["leisure"="playground"](area.a);out center tags;'
    j, h = run(q)
    if not j:
        log.append(f"{name}: FAILED"); continue
    n = 0
    for e in j["elements"]:
        c = e.get("center", e); t = e.get("tags", {})
        w.writerow([e["type"][0] + str(e["id"]), name, round(c["lat"], 6), round(c["lon"], 6), t.get("name", ""), t.get("operator", ""), t.get("access", ""), t.get("playground", ""), t.get("min_age", ""), t.get("max_age", ""), ""])
        n += 1
    log.append(f"{name}: {n} via {h}")
    time.sleep(3)
open("osm-log.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))
