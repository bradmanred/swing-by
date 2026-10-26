import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Pages that shouldn't turn up in search results: the moderator page, a visitor's own favourites, and advanced search
// (which just shows results for whatever was typed). They also carry a noindex tag (see Base.astro).
const hidden = /\/(moderate|my-parks|search)\/$/;

export default defineConfig({
  site: 'https://swing-by.co.uk',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap({ filter: (page) => !hidden.test(page) })],
});
