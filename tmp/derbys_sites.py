# Derbyshire play areas from official lists (checked 22 Oct 2026). Used to build the playground files.
# Each row: (district, name, locality, postcode_or_None, extra) where extra holds size/ages/notes overrides.
HP = "https://www.highpeak.gov.uk/article/1479/Play-areas"
HPB = "https://www.highpeak.gov.uk/article/1590/Buxton-play-areas"
HPG = "https://www.highpeak.gov.uk/article/1591/Gamesley-Glossop-and-Simmondley-play-areas"
HPH = "https://www.highpeak.gov.uk/article/1592/Hadfield-Padfield-and-Tintwistle-play-areas"
HPC = "https://www.highpeak.gov.uk/article/1593/Chapel-en-le-Frith-Furness-Vale-New-Mills-and-Whaley-Bridge-play-areas"
CH = "https://www.chesterfield.gov.uk/explore-chesterfield/parks-and-green-spaces/parks/parks-and-play-areas"
ER = "https://www.erewash.gov.uk/your-borough/play-areas"
BO = "https://committees.bolsover.gov.uk/documents/s33174/Appendix+1+Play+area+refurbishment.pdf"
OB = "https://www.oldbolsovertowncouncil.gov.uk/playgrounds"
DD = "https://derbyshiredales.gov.uk/leisure/parks-and-open-spaces/our-smaller-parks-and-gardens"
SD = "https://southdarleyparishcouncil.gov.uk/leisure"

sites = []
def add(district, name, locality, postcode=None, src=None, srclabel=None, op=None, **extra):
    sites.append(dict(district=district, name=name, locality=locality, postcode=postcode, src=src, srclabel=srclabel, op=op, **extra))

# ---- High Peak: "We look after the following play areas ... range of equipment suitable for children aged 0 to 12"
for n, loc, src in [
    ("Ashwood Park", "Buxton", HPB), ("Bench Road", "Buxton", HPB), ("Brown Edge Road", "Buxton", HPB),
    ("Cote Heath Park", "Buxton", HPB), ("Granby Road", "Buxton", HPB), ("Green Lane", "Buxton", HPB), ("Harpur Hill", "Buxton", HPB),
    ("Hogshaw", "Buxton", HPB), ("Trent Avenue", "Harpur Hill, Buxton", HPB),
    ("Centurion", "Gamesley", HPG), ("Cottage Lane", "Gamesley", HPG), ("Edale Close", "Gamesley", HPG), ("Howard Park", "Glossop", HPG),
    ("Manor Park", "Glossop", HPG), ("Harehills Park", "Glossop", HPG), ("Pyegrove", "Glossop", HPG), ("Shirebrook", "Glossop", HPG),
    ("Pennine Road", "Simmondley", HPG), ("Whitfield Rec", "Glossop", HPG),
    ("Brosscroft", "Hadfield", HPH), ("Bankswood Park", "Hadfield", HPH), ("Chapel Lane", "Hadfield", HPH), ("Conduit Street", "Tintwistle", HPH),
    ("Newshaw Lane", "Hadfield", HPH), ("Temple Street", "Padfield", HPH),
    ("Bridgemont", "Whaley Bridge", HPC), ("Derby Road", "New Mills", HPC), ("Elnor Lane", "Whaley Bridge", HPC), ("Furness Vale", "Furness Vale", HPC),
    ("Jodrell Road", "Whaley Bridge", HPC), ("Mevril Road", "Whaley Bridge", HPC), ("Memorial Park", "Whaley Bridge", HPC),
]:
    add("High Peak", n, loc, None, src, None, "High Peak Borough Council", ages=["under-3", "3-6", "7-12"])
add("High Peak", "Ashwood Close", "Buxton", None, HPB, None, "High Peak Borough Council", ages=["under-3", "3-6"], note="The council says it suits children aged 0 to 6 only.")

# ---- Chesterfield: local areas for play (small) and locally equipped areas for play (medium)
LAP = ["Bradgate Croft, Hasland", "Coupland Close, New Whittington", "Cropston Close, off Storforth Lane", "Foxbrook Court, Walton", "Foxbrook Drive, Walton",
       "Knighton Close, off Storforth Lane, Hasland", "Mallory Close, off Sheffield Road", "Kirby Close, Hasland", "Oadby Drive (No. 12), Hasland", "Oadby Drive (No. 9), Hasland",
       "Parkside View, Upper Newbold", "Silverwell, Middlecroft", "Staunton Close, off Derby Road", "Wain Avenue, off Piccadilly Road", "Westwood, off Bamford Road"]
LEAP = ["Badgers Recreation Ground, off Brockwell Lane", "Barnes Road, Hady Lane", "Belmont Road, Staveley", "Brushfield Recreation Ground, Holme Hall",
        "Canal Wharf Play Area, Hazelhurst Lane, Stonegravels", "Carsington Way, Holme Hall", "Chester Street", "Circular Road, Middlecroft", "Damon Drive, Peterdale, Brimington",
        "Devonshire Avenue, New Whittington", "Duckmanton Adventure Play Area, Poolsbrook Road", "Durley Chine, Hasland", "Eastwood Park Junior Area, Hasland",
        "Eastwood Park Toddler Area, Hasland", "Edinburgh Road", "Hady Hill, Spital", "Harcourt Close, off Storforth Lane, Hasland", "Harehill Road, Grangewood",
        "Hartington Road, Staveley", "Hassop Road, Staveley", "Hazel Drive, Walton", "Heathervale Road, Hasland", "Heywood Street, Brimington", "Highfield Play Area",
        "Hilltop Play Area, Old Whittington", "Holland Road, Whittington Hill", "Holmebrook Valley Park 1", "Holmebrook Valley Park 2", "Holmebrook Valley Park, Linacre Road",
        "Holmebrook Valley Park, Pavilion", "Inkersall Green", "King George Play Area, Staveley", "Kirkstone Road, Dunston", "Langer Lane, Birdholme",
        "Langtree Avenue, Old Whittington", "Larks Rise, Brimington", "Lockoford Lane, Tapton", "Manor Road, Brimington", "Pearsons Recreation Ground, Old Hall Road, Brampton",
        "Poolsbrook 1, Cottage Close", "Poolsbrook 2, Cottage Close", "Poolsbrook Country Park", "Priestfield Gardens, Upper Newbold", "Princess Street, Brimington",
        "Private Drive, Hollingwood", "Ringwood Park", "Sheldon Road, Holme Hall", "Somersall Park, Somersall Lane",
        "Spital Lane", "St Davids Rise, Walton", "Stanford Way, Walton", "Station Road, Barrow Hill", "Station Road, Brimington", "Tapton Park",
        "Thirlmere Road, Upper Newbold", "Wasp Nest Play Area, Rockingham Drive, Ashgate Road", "West Crescent, Duckmanton", "Wickins Play Area, Mastin"]
for s in LAP:
    add("Chesterfield", s, "Chesterfield", None, CH, None, "Chesterfield Borough Council", size="small", kind="LAP")
for s in LEAP:
    add("Chesterfield", s, "Chesterfield", None, CH, None, "Chesterfield Borough Council", size="medium", kind="LEAP")

# ---- Erewash (borough council) with postcodes
ERW = [("Barling Drive Play Area", "Ilkeston", "DE7 9JA"), ("Chaucer Old Park", "Ilkeston", "DE7 5JJ"), ("Cotmanhay Playing Fields", "Ilkeston", "DE7 8UQ"),
       ("Dallimore Road Play Area", "Ilkeston", "DE7 4GZ"), ("Erewash Museum", "Ilkeston", "DE7 5JA"), ("Erewash Square", "Ilkeston", "DE7 5SP"), ("Gallows Inn", "Ilkeston", "DE7 5EN"),
       ("Gordon Street Play Area", "Ilkeston", "DE7 5LQ"), ("Granby Park", "Ilkeston", "DE7 8LH"), ("Inglefield Road Play Area", "Ilkeston", "DE7 5AP"), ("Larklands Play Area", "Ilkeston", "DE7 5ED"),
       ("Noskwith Play Area", "Ilkeston", "DE7 4BX"), ("Oak Apple Crescent", "Ilkeston", "DE7 4NJ"), ("Shaw Street Play Area", "Ilkeston", "DE7 5AU"), ("Victoria Park", "Ilkeston", "DE7 5HA"),
       ("Walker Close", "Ilkeston", "DE7 4DG"), ("Wash Meadows", "Ilkeston", "DE7 8DU"),
       ("Bosworth Way Play Area", "Long Eaton", "NG10 1EA"), ("Cobden Street Play Area", "Long Eaton", "NG10 1BL"), ("Curzon Street / Moorlands Play Area", "Long Eaton", "NG10 4FL"),
       ("Ferndene Drive", "Long Eaton", "NG10 3RR"), ("Grange Park", "Long Eaton", "NG10 2EF"), ("Harrington Play Area", "Long Eaton", "NG10 3PL"), ("Hayworth Road Park", "Long Eaton", "NG10 5LL"),
       ("Norfolk Road Play Area", "Long Eaton", "NG10 7AW"), ("Peveril Meadows", "Long Eaton", "NG10 3BA"), ("Russell Street Play Area", "Long Eaton", "NG10 4LU"),
       ("Sawley New Park", "Long Eaton", "NG10 3DQ"), ("Sawley Park Play Area", "Long Eaton", None), ("Speedway Close", "Long Eaton", "NG10 2DU"), ("Trent Meadows", "Long Eaton", "NG10 2FE"),
       ("Godfrey Drive Play Area", "Kirk Hallam", "DE7 4HR"), ("Nuthall Circle Play Area", "Kirk Hallam", "DE7 4GU"), ("Windsor Crescent Play Area", "Kirk Hallam", "DE7 4HD"),
       ("Wirksworth Road Play Area", "Kirk Hallam", "DE7 4GN"), ("Wyndale Road Play Area", "Kirk Hallam", "DE7 4JH"),
       ("St Giles Park", "Sandiacre", "NG10 5EE"), ("Haddon Way", "Sawley", "NG10 3EE"), ("Deans Drive Play Area", "Borrowash", "DE72 3HQ"), ("Bare Lane", "Ockbrook", "DE72 3RG")]
for n, loc, pc in ERW:
    add("Erewash", n, loc, pc, ER, None, "Erewash Borough Council")
add("Erewash", "West Park Play Areas and Splash Pad", "Long Eaton", "NG10 4AA", ER, None, "Erewash Borough Council", eq=["wp"],
    desc="West Park has a junior play area, a toddler play area and a splash pad, plus a skate park, a multi-use games area, outdoor gym equipment and a trials bike area.", ages=["under-3", "3-6", "7-12"])
for n, loc, op in [("Longmoor Lane", "Breaston", "Breaston Parish Council"), ("Breadsall Memorial Hall", "Breadsall", "Breadsall Parish Council"),
                   ("Parish Field", "Dale Abbey", "Dale Abbey Parish Council"), ("Draycott Park", "Draycott", "Draycott Parish Council"),
                   ("St Peters Park", "Little Eaton", "Little Eaton Parish Council"), ("First Avenue Play Area", "Risley", "Risley Parish Council"),
                   ("Springfield Park", "Sandiacre", "Sandiacre Parish Council"), ("Doncaster Road Rec", "Sandiacre", "Sandiacre Parish Council"),
                   ("Recreation Ground, Coronation Road", "Stanley", "Stanley and Stanley Common Parish Council"),
                   ("Recreation Ground, Belper Road", "Stanley", "Stanley and Stanley Common Parish Council")]:
    add("Erewash", n, loc, None, ER, "Erewash Borough Council: play areas (parish council sites)", op)

# ---- Bolsover District Council (2026 play area list)
BOL = [("Manor Road", "Barlborough", "S43 4HW", None), ("Ruthyn Avenue", "Barlborough", "S43 4EX", None), ("Crich View", "Bolsover", "S44 6HY", None),
       ("Horsehead Lane", "Bolsover", "S44 6XH", "Bolsover District Council and Derbyshire County Council"), ("Houfton Road Recreation Ground", "Bolsover", "S44 6BW", None),
       ("Laburnum Close", "Bolsover", "S44 6EU", None), ("New Bolsover Model Village Green", "New Bolsover", "S44 6PZ", None), ("Clune Street Recreation Ground", "Clowne", "S43 4NJ", None),
       ("Heritage Drive", "Clowne", "S43 4ST", None), ("The Arc, High Street", "Clowne", "S43 4JY", None), ("The Edge", "Clowne", "S43 4FF", "Avant Homes (to be handed to Bolsover District Council)"),
       ("Chestnut Drive", "Creswell", "S80 4LB", None), ("East Street Recreation Ground", "Creswell", "S80 4DJ", "Elmton with Creswell Parish Council"),
       ("Model Village (Junior)", "Creswell", "S80 4BW", None), ("Model Village (Toddler)", "Creswell", "S80 4BW", None), ("King Street", "Hodthorpe", "S80 4UX", None),
       ("Bamford Street", "Newton", "DE55 5TG", "Blackwell Parish Council"), ("Hilltop Park, Hilltop Road", "Pinxton", "NG16 6QJ", "Pinxton Parish Council"),
       ("Bracken Ridge", "Shirebrook", "NG20 8FB", None), ("Olive Avenue", "Shirebrook", "NG20 8HN", "The Guinness Partnership (leased from Bolsover District Council)"),
       ("Rainbow Park, Swanwick Avenue", "Shirebrook", "NG20 8RW", None), ("Green Meadow (Broadmeadows), Lea Vale", "South Normanton", "DE55 3NA", None),
       ("Penryn Close", "South Normanton", "DE55 2FN", "David Wilson Homes"), ("Rangewood Road", "South Normanton", "DE55 3BS", None), ("Sough Road", "South Normanton", "DE55 2LE", None),
       ("Lincoln Street", "Tibshelf", "DE55 5QF", None), ("Poppy Gardens", "Tibshelf", "DE55 5LF", None), ("Staffa Drive", "Tibshelf", "DE55 5PJ", None),
       ("Derwent Drive", "Tibshelf", "DE55 5AY", None), ("Whitwell Common Recreation Ground, Worksop Road", "Whitwell", "S80 3EH", "Whitwell Parish Council")]
for n, loc, pc, op in BOL:
    add("Bolsover", n, loc, pc, BO, "Bolsover District Council: council-owned children's play areas (2026)", op or "Bolsover District Council")
for n in ["Bentinck Park", "Hornscroft Park", "King George V Park", "Vale Park", "Shuttlewood", "Stanfree", "Whaley Common"]:
    loc = {"Shuttlewood": "Shuttlewood", "Stanfree": "Stanfree", "Whaley Common": "Whaley"}.get(n, "Bolsover")
    add("Bolsover", n, loc, None, OB, "Old Bolsover Town Council: playgrounds", "Old Bolsover Town Council", opens="24h",
        note="The town council says its parks are open 24 hours a day, every day.")

# ---- Derbyshire Dales District Council (named play areas) and South Darley Parish Council
for n, loc in [("The Orchard Play Area, Hurst Farm", "Matlock"), ("Artist's Corner Play Area", "Matlock Dale"), ("The Dale Play Area", "Wirksworth"),
               ("Gorsey Bank Play Area", "Wirksworth"), ("Cromford Play Area", "Cromford"), ("Chatsworth Road Play Area", "Darley Dale"),
               ("Willow Way (Butts Road) Play Area", "Darley Dale")]:
    add("Derbyshire Dales", n, loc, None, DD, "Derbyshire Dales District Council: our smaller parks and gardens", "Derbyshire Dales District Council")
add("Derbyshire Dales", "Ashbourne Park Play Area", "Ashbourne", "DE6 1EJ", "https://www.derbyshiredales.gov.uk/leisure/parks-and-open-spaces/ashbourne-park",
    "Derbyshire Dales District Council: Ashbourne Park", "Derbyshire Dales District Council", eq=["zw", "rb", "wp"], access=["inc"], fac=["wc"],
    desc="The town's main play area, with a zip wire (opened April 2025) and accessible equipment including a ground-level roundabout. The old splash pad has closed; the council says a new one is being built on the same site. Free toilets are in the pavilion on the recreation ground (Tuesday to Sunday from 10am), and there are paid toilets in Shawcroft car park.")
add("Derbyshire Dales", "Bakewell Recreation Ground Splash Pad", "Bakewell", "DE45 1AW", "https://www.derbyshiredales.gov.uk/leisure/parks-and-open-spaces/bakewell-recreation-ground",
    "Derbyshire Dales District Council: Bakewell Recreation Ground", "Derbyshire Dales District Council", eq=["wp"], fac=["wc"], season={"from": 4, "to": 9},
    desc="Children's splash pad on Bakewell Recreation Ground, open daily 10am to 5pm (closed 12.30 to 1.30pm) in the summer season, until late September. Toilets open April to October.")
add("Derbyshire Dales", "Whitworth Park Playground", "Darley Dale", None, SD, "South Darley Parish Council: leisure", None,
    desc="Children's playground in Whitworth Park, which also has ornamental ponds, bowling, croquet, football pitches and a skate bowl.")

# ---- Derby City Council (parks with a playground listed in their facilities)
DER = "https://www.inderby.org.uk/parks/derbys-parks-and-open-spaces/"
for slug, n, pc, eq, fac, desc in [
    ("alvaston-park", "Alvaston Park Playground", "DE24 8QQ", ["sp", "zw"], ["wc"], "Play area for all ages with a sandpit, zip wire, an adiZone outdoor gym and a BMX park, at Alvaston Park with its lake and science garden."),
    ("chaddesden-park", "Chaddesden Park Playground and Water Play", "DE21 6LA", ["wp"], ["wc", "cf"], "Children's playground and water play area at Chaddesden Park, with a café, a refurbished BMX track and a multi-use games area."),
    ("chellaston-park", "Chellaston Park Playground", "DE73 6PP", ["sw", "sl", "rb"], [], "Fenced playground for toddlers to teenagers, split into two age groups, with multi-play units, swings, a slide and roundabouts."),
    ("derby-arboretum", "Derby Arboretum Playground", "DE23 8FZ", ["wp", "cl"], ["wc", "cf"], "Large play area for all ages in England's first public park, with a big climbing boulder and a water play area."),
    ("king-george-v-park", "King George V Park Playground", "DE3 3ES", ["sw"], [], "Play area with a trim trail and a six-seater group swing at King George V Playing Fields, Littleover, which also has a wheeled sports area, sports courts and an outdoor gym."),
    ("normanton-park", "Normanton Park Playground", "DE23 8DA", [], ["cf"], "Children's playground in Normanton Park, with football pitches and chess tables."),
    ("osmaston-park", "Osmaston Park Playground", "DE24 9HY", [], ["wc", "cf"], "Children's playground in Osmaston Park."),
    ("racecourse-playing-fields", "Racecourse Playing Fields Play Area", "DE21 6AL", [], ["cf"], "Play area at the Racecourse Playing Fields, which also has a café, community rooms and artificial football pitches."),
    ("sinfin-moor-park", "Sinfin Moor Park Playground", "DE24 9HW", [], ["wc", "cf"], "Large play area with facilities for toddlers to teenagers, and a BMX park, at Sinfin Moor Park."),
    ("sunnydale-park", "Sunnydale Park Playground", "DE23 1WD", [], [], "Children's playground in Sunnydale Park."),
]:
    add("Derby", n, "Derby", pc, DER + slug + "/", "Derby City Council: " + n.replace(" Playground and Water Play", "").replace(" Playground", "").replace(" Play Area", ""), "Derby City Council", eq=eq, fac=fac, desc=desc)
