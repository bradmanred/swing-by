// Cloudflare Worker: GitHub sign-in for Decap CMS at /api/auth and /api/callback, home page suggestions at /api/feedback,
// parent photos at /api/photos, parents' equipment reports at /api/equipment, parents' pin corrections at /api/pins;
// playground pages from their pack files (worker/packs.js); everything else is the static site. Also redirects www to
// the bare domain.
// Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set as variables and secrets on the Worker, the PHOTOS_DB
// D1 binding, and a MOD_TOKEN secret for approving photos.
import { onRequest as auth } from '../functions/api/auth.js';
import { onRequest as callback } from '../functions/api/callback.js';
import { feedback } from './feedback.js';
import { photos } from './photos.js';
import { equipment } from './equipment.js';
import { pins } from './pins.js';
import { servePacked } from './packs.js';
import { AREA_MOVES } from './area-moves.js';

// Old playground address → the listing it was merged into. Add a line whenever two listings are merged.
const MERGED = {
  'hutton-playground-hutton-mount-brentwood': 'hutton-recreation-ground-play-area-hutton',
  'playground-off-rayleigh-road-hutton-mount-brentwood': 'ingrave-johnstone-playing-fields-play-area-hutton',
  'playground-off-nursery-close-rayleigh': 'bedford-close-play-area-rayleigh',
  'playground-off-spitfire-close-langley-slough': 'horsemoor-green-langley',
  'playground-off-mercian-way-cippenham-slough': 'mercian-recreation-ground-cippenham-slough',
  'playground-off-moor-furlong-cippenham-slough': 'moor-furlong-play-area-cippenham-slough',
  'playground-off-two-mile-drive-cippenham-slough': 'two-mile-drive-play-area-cippenham-eton',
  'playground-off-green-road-thorpe-green-thorpe': 'thorpe-green-thorpe-green',
  'windlesham-playground-windlesham': 'whitmoor-road-bagshot',
  'playground-off-orchard-way-camberley': 'orchard-way-frimley',
  'playground-off-clearsprings-lightwater': 'lightwater-country-park-windlesham-lightwater',
  'playground-off-green-street-kempton-park-sunbury-on-thames': 'cedars-recreation-ground-sunbury-on-thames',
  'playground-off-escot-road-upper-halliford-sunbury-on-thames': 'spelthorne-grove-play-area-sunbury-common-sunbury-on-thames',
  'playground-off-markville-gardens-caterham-valley': 'valley-sports-ground-play-area-caterham-valley',
  'playground-off-dumville-drive-to-clayton-mead-godstone': 'catlin-gardens-playground-godstone',
  'penn-avenue-play-area-lenton-city-of-nottingham': 'abbey-bridge-road-playground-lenton-nottingham',
  'sutton-passeys-crescent-play-area-wollaton-park-city-of-nott': 'sutton-passeys-playground-wollaton-park-nottingham',
  'playground-off-briber-road-blyth-bassetlaw': 'sherwood-crescent-play-area-blyth',
  'playground-off-blue-albion-street-ordsall-retford': 'the-oval-play-area-ordsall',
  'playground-off-ashvale-road-tuxford': 'linden-avenue-play-area-tuxford',
  'playground-off-wootton-drive-castletown-stafford': 'creswell-manor-farm-play-area-holmcroft-stafford',
  'holmcroft-play-area-holmcroft-stafford': 'holmcroft-road-play-area-holmcroft-stafford',
  'playground-off-the-garthlands-acton-gate-stafford': 'the-garthlands-play-area-stafford',
  'playground-off-ribblesdale-stonydelph-tamworth': 'rainscar-play-area-stonydelph-fazeley',
  'playground-off-sandling-road-saltwood-folkestone-and-hythe': 'brockhill-country-park-play-area-saltwood',
  'playground-off-artillery-park-nungate-haddington': 'artillary-park-nungate-haddington',
  'playground-off-brierbush-road-macmerry': 'brierbush-road-macmerry',
  'playground-off-gateside-avenue-west-letham-haddington-2': 'gateside-haddington',
  'playground-off-gateside-avenue-west-letham-haddington': 'gateside-toddler-haddington',
  'gladsmuir-playground-gladsmuir': 'gladsmuir-gladsmuir',
  'playground-off-mucklets-crescent-stoneybank-musselburgh': 'mayfield-park-stoneybank-musselburgh',
  'playground-off-riverside-drive-nungate-haddington-2': 'riverside-drive-1-nungate-haddington',
  'playground-off-riverside-drive-nungate-haddington': 'riverside-drive-2-nungate-haddington',
  'playground-off-goldfinch-drive-fairfield-bury': 'goldfinch-drive-playground-fairfield-bury',
  'playground-off-leah-gardens-boyatt-wood-eastleigh': 'causton-gardens-play-area-newtown-eastleigh-2',
  'playground-off-macmillan-way-great-plumstead': 'macmillan-way-play-area-great-and-little-plumstead-great-plu',
  'playground-off-loganberry-road-ravenswood-ipswich': 'bilberry-road-play-area-ipswich-ravenswood-ipswich',
  'playground-off-havergate-road-ravenswood-ipswich-2': 'breydon-way-play-area-ipswich-ravenswood-ipswich',
  'playground-off-havergate-road-ravenswood-ipswich': 'havergate-road-play-area-ipswich-ravenswood-ipswich',
  'playground-off-saturn-road-westbourne-ipswich': 'saturn-road-play-area-ipswich-westbourne-ipswich',
  'playground-off-downside-close-stoke-park-ipswich': 'whitland-close-play-area-ipswich-thorington-park-ipswich',
  'playground-off-longlands-road-berwick-hills-middlesbrough': 'henry-street-recreation-ground-playground-north-ormesby-midd',
  'trimdon-avenue-play-area-acklam-middlesbrough': 'kader-avenue-playground-acklam-middlesbrough',
  'playground-off-lytton-street-north-ormesby-middlesbrough': 'saltwells-road-playground-north-ormesby-middlesbrough',
  'playground-off-hafod-y-m-r-abergele': 'maes-canol-play-area-pensarn',
  'playground-off-rhodfa-cilmael-abergele': 'pentre-mawr-park-play-area-pensarn-abergele',
  'playground-off-the-dingle-colwyn-bay': 'eirias-park-play-area-colwyn-bay',
  'playground-off-north-wales-expressway-colwyn-bay': 'porth-eirias-play-area-colwyn-bay',
  'penmaenmawr-playground-penmaenmawr-dwygyfylchi': 'maes-y-llan-play-area-dwygyfylchi',
  'playground-off-cae-derw-esgyryn-llandudno-junction': 'cae-derw-play-area-esgyryn-llandudno-junction',
  'playground-off-ferndale-road-llandudno-junction': 'victoria-park-play-area-llandudno-junction',
  'playground-off-valley-road-llanfairfechan': 'nant-y-berllan-play-area-llanfairfechan',
  'playground-off-wharfedale-ellel-lancaster': 'galgate-wharfedale-play-area-galgate-lancaster',
  'playground-off-st-wilfrids-park-halton-with-aughton-lancaste': 'halton-st-wilfreds-park-play-area-halton-lancaster',
  'playground-off-thirlmere-road-bulk-lancaster': 'thiremere-road-play-space-bulk-lancaster',
  'playground-off-vernon-crescent-ellel-lancaster': 'ellel-village-hall-playground-galgate-lancaster',
  'playground-off-mill-lane-halton-with-aughton-lancaster': 'mill-lane-play-area-halton-lancaster',
  'playground-off-armitage-way-ellel-lancaster': 'armitage-way-play-area-galgate-lancaster',
  'playground-off-wrights-fold-turpin-green-leyland': 'bent-lane-rec-play-area-farington-leyland',
  'playground-off-albert-road-buckshaw-village-south-ribble': 'ryden-ave-play-area-farington-leyland',
  'playground-off-higher-walton-road-higher-walton-south-ribble': 'walton-le-dale-play-area-higher-walton',
  'playground-off-higher-walton-road-higher-walton-south-ribble-2-2': 'walton-le-dale-activity-area-play-area-higher-walton',
  'playground-off-white-moss-road-pennylands-skelmersdale': 'whitemoss-road-play-area-old-skelmersdale-pennylands-skelmer',
  'playground-off-exchange-street-edenfield-rossendale': 'edenfield-play-area-edenfield',
  'playground-off-chatterton-road-stubbins-rossendale': 'chatterton-recreation-ground-ramsbottom-stubbins',
  'playground-off-hygiene-oakenshaw-clayton-le-moors': 'mercer-park-playground-clayton-le-moors-oakenshaw-clayton-le',
  'playground-off-barrack-hill-crindau-newport': 'barrack-hill-play-area-crindau-newport',
  'playground-off-ebenezer-drive-pye-corner-newport': 'cefn-wood-play-area-pye-corner-newport',
  'playground-off-blaen-y-pant-crescent-crindau-newport': 'crindau-play-area-crindau-newport',
  'playground-off-vancouver-drive-ridgeway-newport': 'glasllwch-play-area-ridgeway-newport',
  'playground-off-bank-street-east-usk-newport': 'glebelands-play-area-east-usk-newport',
  'playground-off-redwood-close-caerleon-newport': 'home-farm-play-area-caerleon-newport',
  'playground-off-hogarth-close-maindee-newport': 'kelly-road-play-area-maindee-newport',
  'playground-off-maplewood-langstone-newport': 'centenary-field-play-area-langstone-langstone-llanwern',
  'playground-off-cambrian-way-marshfield': 'marshfield-play-area-marshfield',
  'brecon-park-play-area-summerhill-newport': 'radnor-road-play-area-summerhill-newport',
  'playground-off-firbank-avenue-maindee-newport': 'renoir-road-play-area-maindee-newport',
  'playground-off-kiln-square-coldra-newport': 'ringland-circle-play-area-coldra-newport',
  'playground-off-sorrel-drive-barrack-hill-newport': 'sorrel-drive-play-area-barrack-hill-newport',
  'playground-off-cardiff-road-maesglas-newport': 'tredegar-park-play-area-maesglas-newport',
  'playground-off-heol-mair-litchard-bridgend': 'glen-view-play-area-litchard-litchard-bridgend',
  'playground-off-cornelius-close-south-cornelly': 'cornelius-close-play-area-south-cornelly-cornelly-south-corn',
  'playground-off-heol-l-s-north-cornelly': 'heol-y-court-play-area-north-cornelly-cornelly-north-cornell',
  'playground-off-the-green-sarn': 'the-green-play-area-sarn-st-brides-minor-sarn',
  'playground-off-cross-street-velindre-port-talbot': 'cross-street-play-area-felindre-velindre-port-talbot',
  'playground-off-wern-road-skewen': 'crymlyn-park-play-area-skewen-coedffranc-skewen',
  'playground-off-hopkin-street-aberavon-port-talbot': 'hopkin-street-play-area-aberavon-aberavon-neath-port-talbot',
  'playground-off-parc-newydd-briton-ferry': 'james-field-play-area-briton-ferry-briton-ferry',
  'playground-off-jersey-terrace-briton-ferry': 'new-park-play-area-briton-ferry-briton-ferry',
  'playground-off-park-street-taibach-port-talbot': 'talbot-memorial-park-play-area-port-talbot-taibach-neath-por',
  'playground-off-margam-road-margam-port-talbot': 'tollgate-park-play-area-margam-margam-neath-port-talbot',
  'playground-off-sandown-road-sandfields-port-talbot': 'vivian-park-play-area-sandfields-sandfields-east-neath-port-',
  'playground-off-llysgwyn-llangyfelach-swansea': 'bryn-glas-playground-llangyfelach-swansea',
  'playground-off-rheidol-avenue-clase-swansea': 'clase-flats-playground-clase-swansea',
  'playground-off-heol-las-park-birchgrove-swansea': 'heol-las-park-playground-birchgrove-parc-bryn-heulog',
  'playground-off-glyncollen-crescent-ynysforgan-swansea': 'heol-tir-du-playground-ynysforgan-ynystawe',
  'playground-off-heol-fach-llangyfelach-swansea': 'llangyfelach-playground-llangyfelach-swansea',
  'playground-off-parc-penderi-penllergaer': 'parc-penderi-playground-penllergaer',
  'playground-off-parc-yr-helyg-birchgrove-swansea': 'parc-yr-helig-playground-birchgrove-parc-bryn-heulog',
  'playground-off-bethel-road-llansamlet-swansea': 'primrose-park-playground-llansamlet-tregof',
  'southhouse-square-southhouse-city-of-edinburgh': 'burdiehouse-burn-valley-park-southhouse-city-of-edinburgh',
  'baberton-playground-baberton-city-of-edinburgh': 'campbell-park-baberton-city-of-edinburgh',
  'playground-off-craigpark-avenue-ratho-city-of-edinburgh': 'craigpark-crescent-play-area-ratho-city-of-edinburgh',
  'playground-off-old-craighall-road-monktonhall-old-craighall': 'newcraighall-park-millerhill',
  'ratho-station-playground-ratho-station-city-of-edinburgh': 'ratho-station-park-ratho-station-city-of-edinburgh',
  'playground-off-lasswade-bank-southhouse-city-of-edinburgh': 'southhouse-square-southhouse-city-of-edinburgh-2',
  'playground-off-carlisle-road-abington': 'abington-play-area-abington',
  'playground-off-bellfield-road-coalburn': 'bellfield-road-play-area-coalburn',
  'playground-off-lochlea-blackwood': 'blackwood-park-blackwood',
  'playground-off-castle-wynd-kirkfield-bothwell': 'castle-wynd-play-area-kirkfield-bothwell',
  'playground-off-school-road-coalburn': 'coalburn-play-area-coalburn',
  'douglas-water-playground-douglas-water': 'douglas-water-play-area-douglas-water',
  'playground-off-green-street-kirkfield-bothwell': 'green-street-play-area-kirkfield-bothwell',
  'playground-off-linnhe-court-summerlee-larkhall': 'linnhe-court-play-area-summerlee-larkhall',
  'playground-off-scott-street-bent-kirkmuirhill': 'scott-street-play-area-lanark-bent-kirkmuirhill',
  'playground-off-fyne-crescent-summerlee-larkhall': 'scott-street-play-area-larkhall-summerlee-larkhall',
  'playground-off-vere-terrace-bent-kirkmuirhill': 'vere-terrace-play-area-bent-kirkmuirhill',
  'playground-off-ferry-toll-place-camdean-rosyth': 'ferry-toll-place-play-park-rosyth-camdean-rosyth',
  'playground-off-b981-north-queensferry': 'brock-street-play-park-north-queensferry-north-queensferry',
  'playground-off-south-knowe-crossgates-and-mossgreen-crossgat': 'windmill-knowe-play-park-crossgates-crossgates-and-mossgreen',
  'playground-off-manse-road-jamestown-inverkeithing': 'manse-road-play-park-inverkeithing-jamestown-inverkeithing',
  'playground-off-church-row-kelty': 'main-street-play-park-kelty-kelty',
  'playground-off-manse-road-crossgates-and-mossgreen-crossgate': 'lady-anne-court-play-park-crossgates-crossgates-and-mossgree',
  'playground-off-parley-road-kelty': 'bath-street-play-park-kelty-kelty',
  'playground-off-elmwood-terrace-kelty': 'elmwood-terrace-play-park-kelty-kelty',
  'playground-off-ringway-south-lychpit-basingstoke': 'black-dam-ponds-lychpit-basingstoke',
  'playground-off-crabtree-plantation-lychpit-basingstoke': 'crabtree-plantation-lychpit-basingstoke',
  'playground-off-heathlands-highclere-basingstoke-and-deane-2': 'heathlands-play-area-highclere-basingstoke-and-deane',
  'playground-off-munnings-close-black-dam-basingstoke': 'munnings-close-play-area-black-dam-basingstoke',
  'oceania-crescent-play-area-hounsome-fields-basingstoke': 'oceania-crescent-play-area-hounsome-fields-basingstoke-2',
  'witan-court-play-area-bere-hill-whitchurch': 'witan-court-skylark-rise-play-area-bere-hill-whitchurch',
  'playground-off-fairdown-close-winnall-winchester': 'fairdown-close-play-area-turnpike-down-winchester',
  'king-george-v-playground-highcliffe-winchester': 'gordon-avenue-play-area-highcliffe-winchester',
  'playground-off-fiona-close-winnall-winchester': 'imber-road-play-area-winnall-winchester',
  'playground-off-chilcomb-lane-bar-end-winchester': 'king-george-v-playing-field-bar-end-winchester',
  'playground-off-winnall-manor-road-winnall-winchester': 'winnall-manor-road-play-area-winnall-winchester',
  'playground-off-bluebell-close-picket-piece-andover': 'blueberry-gardens-burghclere-down-andover',
  'picket-piece-playground-picket-piece-andover': 'gallaghers-mead-burghclere-down-andover',
  'playground-off-nursling-street-nursling-and-rownhams-test-va': 'nursling-street-playground-nursling-and-rownhams-test-valley',
  'playground-off-pennine-way-chandlers-ford': 'pennine-way-recreation-ground-play-area-oakmount-chandlers-f',
  'playground-off-peverells-wood-avenue-chandlers-ford': 'peverells-wood-avenue-play-area-peverells-wood-chandlers-for',
  'playground-off-oakmount-road-chandlers-ford': 'fryern-recreation-ground-play-area-fryern-chandlers-ford',
  'playground-off-essex-green-chandlers-ford': 'suffolk-drive-play-area-oakmount-chandlers-ford',
  'playground-off-cox-row-chandlers-ford': 'cox-row-play-area-oakmount-chandlers-ford',
  'playground-off-upper-northam-road-wildern-hedge-end': 'greta-park-play-area-wildern-hedge-end',
  'playground-off-thistle-road-wildern-hedge-end': 'turnpike-way-play-area-wildern-hedge-end',
  'bath-park-playground-west-end-fareham': 'bath-lane-recreation-ground-play-area-west-end-fareham',
  'playground-off-west-street-west-end-fareham': 'west-street-play-area-west-end-fareham',
  'playground-off-prince-charles-crescent-hawley-lane-farnborou': 'prince-charles-crescent-play-area-hawley-lane-farnborough',
  'moor-road-play-ground-farnborough': 'moor-road-recreation-ground-playground-farnborough',
  'playground-off-pinewood-park-farnborough': 'pinewood-park-playground-farnborough',
  'playground-off-rands-lane-armthorpe-doncaster': 'mercel-avenue-playground-armthorpe-armthorpe-doncaster',
  'playground-off-wickett-hern-road-armthorpe-doncaster': 'wickett-hern-road-playground-armthorpe-armthorpe-doncaster',
  'playground-off-grange-lane-burghwallis-doncaster': 'grange-lane-playground-burghwallis-burghwallis-doncaster',
  'playground-off-springfield-avenue-dunscroft-hatfield': 'station-road-playground-hatfield-dunscroft-hatfield',
  'playground-off-wadworth-hall-lane-wadworth-doncaster': 'wadworth-hall-lane-playground-wadworth-doncaster',
  'playground-off-ratten-row-wadworth-doncaster': 'osberton-street-playground-wadworth-wadworth-doncaster',
  'playground-off-tenter-lane-warmsworth-doncaster': 'guest-lane-playground-warmsworth-warmsworth-doncaster',
  'playground-off-the-grange-woolley-wakefield': 'bluebell-road-playground-woolley-woolley-wakefield',
  'playground-off-liverpool-loop-line-knotty-ash-liverpool': 'springfield-park-playground-knotty-ash-liverpool',
  'playground-off-foxshaw-close-whiston-lane-ends-whiston': 'fox-shaw-close-play-area-whiston-lane-ends-whiston',
  'playground-off-winstanley-road-orrell-post-wigan': 'orrell-water-park-playground-higher-end-wigan',
  'playground-off-bankes-avenue-orrell-wigan': 'redwood-park-playground-orrell-wigan',
  'balderstone-park-buersil-rochdale': 'balderstone-park-playground-buersil-rochdale',
  'playground-off-lyndhurst-avenue-trub-rochdale': 'chesham-avenue-playground-trub-rochdale',
  'playground-off-rakewood-road-rakewood-littleborough': 'hollingworth-lake-playground-rakewood-littleborough',
  'playground-off-school-street-gigg-bury': 'openshaw-park-playground-gigg-bury',
  'playground-off-park-road-stockland-green-birmingham': 'brookvale-park-stockland-green-birmingham',
  'playground-off-blenheim-way-castle-vale-birmingham': 'cadbury-drive-public-open-space-castle-vale-birmingham',
  'playground-off-upper-highgate-street-digbeth-birmingham': 'conybere-street-public-open-space-digbeth-birmingham',
  'playground-off-eliot-street-aston-birmingham': 'eliot-street-public-open-space-aston-birmingham',
  'playground-off-spitfire-way-castle-vale-birmingham': 'spitfire-way-play-area-castle-vale-birmingham',
  'playground-off-jasper-close-eastern-green-coventry': 'bannerbrook-park-eastern-green-coventry',
  'playground-off-strathmore-avenue-lower-stoke-coventry': 'charterhouse-fields-lower-stoke-coventry',
  'juniper-drive-play-park-brownshill-green-coventry': 'park-hill-open-space-brownshill-green-coventry',
  'playground-off-starley-road-spon-end-coventry': 'spon-end-open-space-spon-end-coventry',
  'playground-off-athol-road-walsgrave-coventry': 'walsgrave-village-green-walsgrave-coventry',
  'playground-off-minton-road-potters-green-coventry': 'woodway-walk-potters-green-coventry',
  'playground-off-lodge-road-knowle-solihull': 'knowle-park-knowle-solihull',
  'playground-off-cornwallis-square-tufnell-park-greater-london': 'cornwallis-adventure-playground-holloway-greater-london',
  'playground-off-packington-square-islington-greater-london': 'waterside-adventure-playground-islington-greater-london',
  'crumbles-playground-barnsbury-greater-london': 'crumbles-castle-adventure-playground-barnsbury-greater-londo',
  'caledonian-park-barnsbury-greater-london': 'hayward-adventure-playground-barnsbury-greater-london',
  'playground-off-elton-place-highbury-greater-london': 'butterfield-green-playground-shacklewell-greater-london',
  'playground-off-parkview-avenue-brent-cross': 'claremont-park-playground-brent-cross-greater-london',
  'playground-off-prince-charles-drive-hendon-central': 'sturgess-park-playground-hendon-central-greater-london',
  'playground-off-hilltop-gardens-hendon': 'sunny-hill-park-playground-hendon-greater-london',
  'playground-off-rowley-avenue-blendon-greater-london': 'penhill-park-playground-blendon-greater-london',
  'riverside-walk-playground-albany-park-greater-london': 'riverside-walk-playground-albany-park-greater-london-2',
  'motspur-park-playground-motspur-park-greater-london': 'blagdon-road-open-space-motspur-park-greater-london',
  'playground-off-homestead-lane-the-ryde-welwyn-garden-city': 'king-george-v-playing-fields-welwyn-garden-city',
  'playground-off-kavan-gardens-cranford-hounslow': 'avenue-park-playground-hounslow',
  'playground-off-sinfield-close-bedwell-stevenage': 'fairlands',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    // One address for the site: send www.swing-by.co.uk to swing-by.co.uk, keeping the path.
    if (url.hostname === 'www.swing-by.co.uk') {
      url.hostname = 'swing-by.co.uk';
      return Response.redirect(url.toString(), 301);
    }
    if (pathname === '/api/auth') return auth({ request, env });
    if (pathname === '/api/callback') return callback({ request, env });
    if (pathname === '/api/feedback' || pathname === '/api/feedback/latest') return feedback({ request, env, pathname });
    if (pathname === '/api/photos' || pathname.startsWith('/api/photos/')) return photos({ request, env, pathname });
    if (pathname === '/api/equipment' || pathname.startsWith('/api/equipment/')) return equipment({ request, env, pathname });
    if (pathname === '/api/pins' || pathname.startsWith('/api/pins/')) return pins({ request, env, pathname });
    // The pack files are only for the Worker to read; don't serve them as pages.
    if (pathname.startsWith('/_pages/')) {
      const missing = await env.ASSETS.fetch(new Request(new URL('/404.html', url)));
      return new Response(missing.body, { status: 404, headers: missing.headers });
    }
    // Playground pages are packed into a few hundred files (worker/packs.js); serve them from there.
    const packed = await servePacked(request, env.ASSETS);
    if (packed) return packed;
    const res = await env.ASSETS.fetch(request);
    // Playgrounds merged into another listing: send old links to the one we kept.
    const gone = /^\/playgrounds\/([a-z0-9-]+)\/?$/.exec(pathname);
    if (res.status === 404 && gone && MERGED[gone[1]]) {
      url.pathname = `/playgrounds/${MERGED[gone[1]]}/`;
      return Response.redirect(url.toString(), 301);
    }
    // Browse-by-area pages whose area was renamed (worker/area-moves.js).
    const area = /^\/playgrounds\/in\/([a-z0-9-]+\/[a-z0-9-]+)\/?$/.exec(pathname);
    if (res.status === 404 && area && AREA_MOVES[area[1]]) {
      url.pathname = `/playgrounds/in/${AREA_MOVES[area[1]]}/`;
      return Response.redirect(url.toString(), 301);
    }
    // Playground addresses used to start with "c-" (/playgrounds/c-garston-park-watford/). Send old links, bookmarks
    // and search results to the same playground's page now.
    const old = /^\/playgrounds\/c-([a-z0-9-]+)(\/.*)?$/.exec(pathname);
    if (res.status === 404 && old) {
      url.pathname = `/playgrounds/${old[1]}${old[2] ?? '/'}`;
      const now = (await servePacked(new Request(url), env.ASSETS)) ?? (await env.ASSETS.fetch(new Request(url, { method: 'GET' })));
      if (now.ok || now.status === 307) return Response.redirect(url.toString(), 301);
    }
    return res;
  },
};
