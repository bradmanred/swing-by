import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://swing-by.pages.dev',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
