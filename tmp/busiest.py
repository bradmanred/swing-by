# Ranks motorways and A roads by traffic, from DfT road traffic statistics (Open Government Licence).
import csv, io, json, zipfile, urllib.request, collections
URL = "https://storage.googleapis.com/dft-statistics/road-traffic/downloads/data-gov-uk/dft_traffic_counts_aadf.zip"
b = urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"}), timeout=600).read()
z = zipfile.ZipFile(io.BytesIO(b))
name = [n for n in z.namelist() if n.endswith(".csv")][0]
rows = csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))
latest = {}
for r in rows:
    if r.get("road_category") not in ("TM", "PM", "TA", "PA"): continue
    cp = r["count_point_id"]; y = int(r["year"])
    if cp not in latest or y > latest[cp][0]:
        latest[cp] = (y, r["road_name"], int(float(r["all_motor_vehicles"] or 0)), r["road_category"], r["latitude"], r["longitude"])
by = collections.defaultdict(list)
for y, road, v, cat, la, lo in latest.values():
    by[road].append(v)
out = sorted(({"road": k, "mean_aadf": round(sum(v) / len(v)), "points": len(v), "vehicle_km_proxy": sum(v)} for k, v in by.items()), key=lambda x: -x["mean_aadf"])
json.dump({"source": URL, "file": name, "roads": out[:200]}, open("tmp/busiest.json", "w"), indent=1)
print(name, len(latest), out[:15])
