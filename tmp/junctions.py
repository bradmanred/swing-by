# All motorway junctions in Great Britain from OpenStreetMap, and trunk-road grade-separated junctions on the busiest A roads.
import json, time, urllib.request, urllib.parse
HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
def run(q):
    for h in HOSTS:
        for a in range(2):
            try:
                with urllib.request.urlopen(urllib.request.Request(h, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "swing-by-playground-audit"}), timeout=600) as r:
                    return json.load(r)
            except Exception as e:
                print("fail", h, e); time.sleep(10)
    return None
# Junction nodes plus the ref of the motorway/trunk ways they sit on.
q = """[out:json][timeout:500];
area["ISO3166-1"="GB"]->.gb;
way["highway"~"^(motorway|trunk)$"]["ref"](area.gb)->.roads;
node(w.roads)["highway"="motorway_junction"]->.j;
.j out tags center;
way(bn.j)["highway"~"^(motorway|trunk)$"];
out body;
node(w)->.wn;"""
j = run(q.replace("node(w)->.wn;", ""))
json.dump(j, open("tmp/junctions-raw.json", "w"))
print(len((j or {}).get("elements", [])))
