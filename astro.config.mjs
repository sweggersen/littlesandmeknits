// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://littlesandmeknits.com',

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
