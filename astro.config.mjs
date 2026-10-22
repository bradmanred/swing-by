import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://swing-by.co.uk',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
