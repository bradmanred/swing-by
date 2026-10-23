import json, re, html, urllib.request, concurrent.futures as cf
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", "Accept-Language": "en-GB"}
def get(u, t=60):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r:
        return r.read().decode("utf-8", "ignore")
B = "https://www.nationaltrust.org.uk"
api = B + "/api/search/places?query=&placeSort=alphabetical&lat=54&lon=-2.5&milesRadius=1000&pageStartIndex=0&pageSize=1000&lang=en&publicationChannel=NATIONAL_TRUST_ORG_UK&maxPlaceResults=1000&maxLocationPageResults=0"
places = json.loads(get(api))["pagedMultiMatch"]["results"]
def vis(h):
    h = re.sub(r"(?s)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", h)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))
def one(p):
    path = p["websiteUrlPath"]; out = dict(path=path, title=p["title"], town=p.get("town"), county=p.get("county"), loc=p.get("location"))
    try:
        h = get(B + path)
    except Exception as e:
        out["err"] = str(e)[:100]; return out
    j = {}
    for s in re.findall(r'(?s)<script[^>]*application/ld\+json[^>]*>(.*?)</script>', h):
        try:
            x = json.loads(s)
        except Exception:
            continue
        if isinstance(x, dict) and x.get("amenityFeature") is not None or (isinstance(x, dict) and "openingHoursSpecification" in x):
            j = x; break
    amen = [a.get("name") for a in j.get("amenityFeature") or []]
    ohs = sorted({o.get("name") for o in j.get("openingHoursSpecification") or [] if o.get("name")})
    tf = re.findall(r'data-testid="highlights-top-features".*?</section>', h, re.S)
    tfn = re.findall(r"<h4[^>]*>([^<]+)</h4>", tf[0]) if tf else []
    t = vis(h)
    sent = [m.strip() for m in re.findall(r"[^.!?]{0,160}\b(?:play area|playground|natural play|play trail|adventure play|play park|playpark)[^.!?]{0,160}[.!?]", t, re.I)][:4]
    out.update(amen=amen, ohs=ohs, tf=[html.unescape(x).strip() for x in tfn], sent=sent, free=j.get("isAccessibleForFree"),
               pc=(j.get("address") or {}).get("postalCode"), geo=j.get("geo"), offers=[(o.get("name"), o.get("price"), o.get("category")) for o in (j.get("offers") or [])[:8]], url=j.get("url"))
    return out
with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(one, places))
json.dump(res, open("tmp/nt.json", "w"), indent=0)
print(len(res), sum(1 for r in res if r.get("err")))
