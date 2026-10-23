import json, urllib.request
S = json.load(open("tmp/essex-sites.json"))
pcs = sorted({s["pc"] for s in S if s.get("pc")})
out = {}
for i in range(0, len(pcs), 100):
    body = json.dumps({"postcodes": pcs[i:i + 100]}).encode()
    with urllib.request.urlopen(urllib.request.Request("https://api.postcodes.io/postcodes", data=body, headers={"Content-Type": "application/json", "User-Agent": "swing-by"}), timeout=60) as r:
        for x in json.load(r)["result"]:
            res = x["result"]
            if res: out[x["query"]] = [res["latitude"], res["longitude"], res.get("admin_district"), res.get("parish")]
            else:
                try:
                    with urllib.request.urlopen(urllib.request.Request("https://api.postcodes.io/terminated_postcodes/" + x["query"].replace(" ", ""), headers={"User-Agent": "swing-by"}), timeout=30) as rr:
                        t = json.load(rr)["result"]; out[x["query"]] = [t["latitude"], t["longitude"], None, None]
                except Exception:
                    out[x["query"]] = None
json.dump(out, open("tmp/essex-pc.json", "w"), indent=0)
print(len(pcs), sum(1 for v in out.values() if v))
