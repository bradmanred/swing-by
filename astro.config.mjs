import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://swing-by.bradman1981.workers.dev',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
