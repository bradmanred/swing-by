import json, time, urllib.request, urllib.parse, sys
sys.path.insert(0, "tmp")
from q3 import q3
UA = {"User-Agent": "swing-by-playground-audit/1.0 (https://github.com/bradmanred/swing-by)"}
VIEW = "-2.05,53.55,-1.15,52.68"
out = {}
for key, qs in q3.items():
    out[key] = []
    for q, chk in qs:
        time.sleep(1.2)
        try:
            with urllib.request.urlopen(urllib.request.Request("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 5, "countrycodes": "gb", "viewbox": VIEW, "bounded": 1}), headers=UA), timeout=40) as r:
                res = json.load(r)
        except Exception as e:
            res = []
        out[key] += [dict(q=q, lat=float(x["lat"]), lng=float(x["lon"]), t=x.get("category", "") + "/" + x.get("type", ""), dn=x["display_name"][:110]) for x in res if chk.lower() in x["display_name"].lower()]
json.dump(out, open("tmp/pins3.json", "w"), indent=1)
