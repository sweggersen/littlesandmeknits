// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://littlesandmeknits.com',
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },

  security: { checkOrigin: false },
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
  }),

  i18n: {
    locales: ['nb', 'en'],
    defaultLocale: 'nb',
    routing: {
      prefixDefaultLocale: false,
    },
  },

  integrations: [react(), mdx()],

  vite: {
    plugins: [tailwindcss()],
  },
});
