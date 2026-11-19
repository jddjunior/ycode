// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  security: { checkOrigin: true },
  server: { host: true },
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['@electric-sql/pglite'] },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  },
});
