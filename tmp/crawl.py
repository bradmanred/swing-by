import os, re, json, time, hashlib, urllib.request, urllib.parse
SEEDS = [
 ("derby", ["https://www.inderby.org.uk/parks/derbys-parks-and-open-spaces/", "https://www.inderby.org.uk/parks/derbys-parks-and-open-spaces/other-parks/", "https://www.inderby.org.uk/parks/things-to-do-on-our-parks/playgrounds-and-play-areas/", "https://www.inderby.org.uk/parks/things-to-do-on-our-parks/paddling-pool-and-water-play/"], r"/parks/derbys-parks-and-open-spaces/[^/?#]+/?$"),
 ("ambervalley", ["https://www.ambervalley.gov.uk/environment/play-in-amber-valley/playgrounds/", "https://www.ambervalley.gov.uk/environment/play-in-amber-valley", "https://www.ambervalley.gov.uk/environment/parks-and-gardens/playgrounds"], r"ambervalley\.gov\.uk/(environment/(play-in-amber-valley|parks-and-gardens)/[^?#]+)"),
 ("chesterfield", ["https://www.chesterfield.gov.uk/explore-chesterfield/parks-and-green-spaces/parks/parks-and-play-areas", "https://www.chesterfield.gov.uk/explore-chesterfield/parks-and-green-spaces/parks"], r"chesterfield\.gov\.uk/explore-chesterfield/parks-and-green-spaces/[^?#]+"),
 ("erewash", ["https://www.erewash.gov.uk/your-borough/play-areas", "https://www.erewash.gov.uk/your-borough/directory-parks"], r"erewash\.gov\.uk/(your-borough/(play-areas|directory-parks|parks)[^?#]*|directory-record/[^?#]+|[^?#]*play[^?#]*)"),
 ("bolsover", ["https://committees.bolsover.gov.uk/documents/s33174/Appendix+1+Play+area+refurbishment.pdf", "https://www.bolsover.gov.uk/services/l/leisure-and-culture/parks-and-play-areas", "https://www.oldbolsovertowncouncil.gov.uk/playgrounds"], r"bolsover\.gov\.uk/[^?#]*(park|play)[^?#]*"),
 ("southderbyshire", ["https://www.southderbyshire.gov.uk/our-services/things-to-do-and-places-to-visit/parks-and-open-spaces/play-areas-skate-parks-and-recreation-grounds", "https://www.southderbyshire.gov.uk/our-services/things-to-do-and-places-to-visit/parks-and-open-spaces"], r"southderbyshire\.gov\.uk/our-services/things-to-do-and-places-to-visit/parks-and-open-spaces/[^?#]+"),
 ("highpeak", ["https://www.highpeak.gov.uk/article/1479/Play-areas", "https://www.highpeak.gov.uk/article/1590/Buxton-play-areas", "https://www.highpeak.gov.uk/article/1591/Gamesley-Glossop-and-Simmondley-play-areas", "https://www.highpeak.gov.uk/article/1592/Hadfield-Padfield-and-Tintwistle-play-areas", "https://www.highpeak.gov.uk/article/1593/Chapel-en-le-Frith-Furness-Vale-New-Mills-and-Whaley-Bridge-play-areas"], r"highpeak\.gov\.uk/article/\d+/[^?#]*(play|Play|park|Park)[^?#]*"),
 ("nederbyshire", ["https://www.ne-derbyshire.gov.uk/parks-and-open-spaces", "https://www.ne-derbyshire.gov.uk/leisure-and-culture/parks-and-open-spaces", "https://www.claycross.gov.uk/playgrounds"], r"(ne-derbyshire\.gov\.uk/[^?#]*(park|play)[^?#]*|claycross\.gov\.uk/[^?#]*play[^?#]*)"),
 ("dales", ["https://www.derbyshiredales.gov.uk/leisure/parks-and-open-spaces", "https://derbyshiredales.gov.uk/leisure/parks-and-open-spaces/our-smaller-parks-and-gardens", "https://discoverashbourne.com/listing/playgrounds", "https://southdarleyparishcouncil.gov.uk/leisure"], r"derbyshiredales\.gov\.uk/(leisure/parks-and-open-spaces/[^?#]+|[a-z]+park[^?#]*)"),
 ("parishes", ["https://www.denbyparishcouncil.gov.uk/playgrounds"], r"$^"),
]
UA = {"User-Agent": "Mozilla/5.0 (compatible; swing-by-playground-audit; +https://github.com/bradmanred/swing-by)"}
os.makedirs("tmp/pages", exist_ok=True)
index = []
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r:
            return r.read(), r.headers.get("Content-Type", ""), r.geturl()
    except Exception as e:
        return None, str(e), u
for name, seeds, pat in SEEDS:
    seen, queue = set(), list(seeds)
    while queue and len(seen) < 160:
        u = queue.pop(0)
        if u in seen: continue
        seen.add(u)
        body, ctype, final = get(u)
        h = hashlib.md5(u.encode()).hexdigest()[:10]
        ext = ".pdf" if (body and body[:4] == b"%PDF") else ".html"
        if body:
            open(f"tmp/pages/{name}-{h}{ext}", "wb").write(body)
        index.append({"set": name, "url": u, "final": final, "file": f"{name}-{h}{ext}" if body else None, "err": None if body else ctype})
        if body and ext == ".html" and u in seeds or (body and ext == ".html" and re.search(pat, u)):
            for href in re.findall(r'href="([^"#]+)"', body.decode("utf-8", "ignore")):
                full = urllib.parse.urljoin(final, href.replace("&amp;", "&"))
                if re.search(pat, full) and full not in seen and not re.search(r"\.(jpg|png|gif|svg|css|js)$", full, re.I):
                    queue.append(full)
        time.sleep(0.5)
json.dump(index, open("tmp/pages/index.json", "w"), indent=1)
from collections import Counter
print(Counter((i["set"], bool(i["file"])) for i in index))
