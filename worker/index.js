// Cloudflare Worker: GitHub sign-in for Decap CMS at /api/auth and /api/callback, home page suggestions at /api/feedback,
// parent photos at /api/photos, parents' equipment reports at /api/equipment, parents' pin corrections at /api/pins; everything else is the static site. Also redirects www to the bare domain.
// Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set as variables and secrets on the Worker, the PHOTOS_DB
// D1 binding, and a MOD_TOKEN secret for approving photos.
import { onRequest as auth } from '../functions/api/auth.js';
import { onRequest as callback } from '../functions/api/callback.js';
import { feedback } from './feedback.js';
import { photos } from './photos.js';
import { equipment } from './equipment.js';
import { pins } from './pins.js';

// Old playground address → the listing it was merged into. Add a line whenever two listings are merged.
const MERGED = {
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
    const res = await env.ASSETS.fetch(request);
    // Playgrounds merged into another listing: send old links to the one we kept.
    const gone = /^\/playgrounds\/([a-z0-9-]+)\/?$/.exec(pathname);
    if (res.status === 404 && gone && MERGED[gone[1]]) {
      url.pathname = `/playgrounds/${MERGED[gone[1]]}/`;
      return Response.redirect(url.toString(), 301);
    }
    // Playground addresses used to start with "c-" (/playgrounds/c-garston-park-watford/). Send old links, bookmarks
    // and search results to the same playground's page now.
    const old = /^\/playgrounds\/c-([a-z0-9-]+)(\/.*)?$/.exec(pathname);
    if (res.status === 404 && old) {
      url.pathname = `/playgrounds/${old[1]}${old[2] ?? '/'}`;
      const now = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
      if (now.ok) return Response.redirect(url.toString(), 301);
    }
    return res;
  },
};
