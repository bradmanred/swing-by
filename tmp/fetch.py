import os, re, json, hashlib, subprocess, urllib.request
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
os.makedirs("tmp/fetched", exist_ok=True)
idx = []
for line in open("tmp/urls.txt"):
    u = line.strip()
    if not u or u.startswith("#"): continue
    h = hashlib.md5(u.encode()).hexdigest()[:10]
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r:
            b = r.read(); ct = r.headers.get("Content-Type", ""); st = r.status
    except Exception as e:
        idx.append({"url": u, "err": str(e)[:200]}); continue
    if b[:4] == b"%PDF":
        open(f"/tmp/{h}.pdf", "wb").write(b)
        try:
            subprocess.run(["pdftotext", "-layout", f"/tmp/{h}.pdf", f"tmp/fetched/{h}.txt"], check=True)
        except Exception:
            from pdfminer.high_level import extract_text
            open(f"tmp/fetched/{h}.txt", "w").write(extract_text(f"/tmp/{h}.pdf"))
        f = f"{h}.txt"
    else:
        f = f"{h}.html"; open(f"tmp/fetched/{f}", "wb").write(b)
    idx.append({"url": u, "file": f, "ct": ct, "status": st, "bytes": len(b)})
json.dump(idx, open("tmp/fetched/index.json", "w"), indent=1)
print(json.dumps(idx, indent=1))
