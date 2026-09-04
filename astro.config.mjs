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

  // checkOrigin is OFF because form-encoded API/mobile clients POST without a
  // browser Origin header (Astro would 403 them). CSRF is instead covered by
  // SameSite=Lax on the auth cookie (see createServerSupabase setAll): a
  // cross-site POST can't carry the session, so it arrives unauthenticated.
  // Flipping this to true requires re-testing every form-POST + API client.
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
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
