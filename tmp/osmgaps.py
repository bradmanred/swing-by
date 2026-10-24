# For each gap junction, find up to 3 nearest public OSM playgrounds within 4.8 km and reverse-geocode them.
# Writes tmp/osm-rest.txt lines: id|lat|lng|name|operator|road|sub|town|district|regioncode|gaps
import json, math, time, urllib.request, urllib.parse, sys, re
UA = {'User-Agent': 'SwingBy/1.0 (https://swing-by.co.uk; playground finder)'}
EPS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
def post(url, data, ctype='application/x-www-form-urlencoded', timeout=180):
    req = urllib.request.Request(url, data=data, headers={**UA, 'Content-Type': ctype})
    with urllib.request.urlopen(req, timeout=timeout) as r: return json.load(r)
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return json.load(r)
def km(a, b):
    r = math.pi/180; h = math.sin((b[0]-a[0])*r/2)**2 + math.cos(a[0]*r)*math.cos(b[0]*r)*math.sin((b[1]-a[1])*r/2)**2
    return 12742*math.asin(math.sqrt(h))
gaps = json.load(open('tmp/gaps-rest.json'))
pl = {}
for i in range(0, len(gaps), 12):
    ch = gaps[i:i+12]
    q = '[out:json][timeout:170];(' + ''.join(f'nwr[leisure=playground](around:4800,{g[2]},{g[3]});' for g in ch) + ');out center tags;'
    for t in range(6):
        try:
            o = post(EPS[t % 3], urllib.parse.urlencode({'data': q}).encode())
            for e in o['elements']:
                c = (e.get('lat') or e['center']['lat'], e.get('lon') or e['center']['lon'])
                pl[e['type'][0] + str(e['id'])] = (c, e.get('tags', {}))
            break
        except Exception as ex:
            print('retry', i, t, str(ex)[:80], flush=True); time.sleep(20)
    else: print('FAILED chunk', i, flush=True)
    print('chunk', i, len(pl), flush=True); time.sleep(3)
BAD = re.compile(r'(?i)school|nursery|academy|primary|college|pub\b|hotel|caravan|holiday park|soft play|ikea|mcdonald')
cands = [(k, c, t) for k, (c, t) in pl.items() if t.get('access') not in ('private', 'no', 'customers') and not BAD.search(t.get('name', '') + ' ' + t.get('operator', '')) and t.get('indoor') != 'yes']
sel = {}
for g in gaps:
    p = (g[2], g[3]); near = sorted(((km(p, c), k, c, t) for k, c, t in cands if abs(c[0]-p[0]) < 0.05 and abs(c[1]-p[1]) < 0.08), key=lambda x: x[0])
    picked = []
    for d, k, c, t in near:
        if d > 4.8: break
        if any(km(c, q) < 0.15 for q in picked): continue
        picked.append(c); sel.setdefault(k, [c, t, []])[2].append(f'{g[0]} {g[1]}')
        if len(picked) >= 3: break
print('selected', len(sel), flush=True)
keys = list(sel)
pcs = {}
for i in range(0, len(keys), 100):
    ch = keys[i:i+100]
    try:
        r = post('https://api.postcodes.io/postcodes', json.dumps({'geolocations': [{'latitude': sel[k][0][0], 'longitude': sel[k][0][1], 'radius': 1000, 'limit': 1} for k in ch]}).encode(), 'application/json')
        for k, x in zip(ch, r['result']):
            pcs[k] = (x['result'] or [None])[0]
    except Exception as ex: print('pc fail', ex)
REG = {'North East': 'NE', 'North West': 'NW', 'Yorkshire and The Humber': 'Y', 'East Midlands': 'EM', 'West Midlands': 'WM', 'East of England': 'E', 'London': 'L', 'South East': 'SE', 'South West': 'SW'}
CTY = {'Hertfordshire': 'H', 'Essex': 'X', 'Derbyshire': 'D', 'Devon': 'V'}; DIST = {'Derby': 'D', 'Plymouth': 'V', 'Torbay': 'V', 'Southend-on-Sea': 'X', 'Thurrock': 'X'}
out = open('tmp/osm-rest.txt', 'w')
for n, k in enumerate(keys):
    c, t, gs = sel[k]; p = pcs.get(k) or {}
    reg = ('W' if p.get('country') == 'Wales' else 'S' if p.get('country') == 'Scotland' else 'N' if p.get('country') == 'Northern Ireland' else CTY.get(p.get('admin_county') or '') or DIST.get(p.get('admin_district')) or REG.get(p.get('region'), '?')) if p else '?'
    a = {}
    try:
        a = get(f'https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&addressdetails=1&lat={c[0]}&lon={c[1]}').get('address', {})
    except Exception as ex: print('nom fail', k, flush=True)
    time.sleep(1.1)
    road = a.get('road') or a.get('pedestrian') or a.get('footway') or ''
    sub = a.get('suburb') or a.get('village') or a.get('neighbourhood') or a.get('hamlet') or ''
    town = a.get('town') or a.get('city') or a.get('village') or ''
    f = lambda s: str(s or '').replace('|', '/').replace('\n', ' ')
    out.write('|'.join(map(f, [k, round(c[0], 5), round(c[1], 5), t.get('name'), t.get('operator'), road, sub, town, p.get('admin_district'), reg, ';'.join(gs)])) + '\n'); out.flush()
    if n % 100 == 0: print('rev', n, flush=True)
print('done')
