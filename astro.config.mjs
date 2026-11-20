// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [preact()],
  security: {
    checkOrigin: true,
    // Behind Railway's TLS edge the app sees http://internal-host; trust the proxy's
    // X-Forwarded-Proto/Host so Astro.url (and the CSRF origin check) match the browser.
    // Any hostname: operators bring their own custom domains. HTTPS only (+ local dev).
    allowedDomains: [{ protocol: 'https', port: '443' }, { protocol: 'https' }, { protocol: 'http', hostname: 'localhost' }],
  },
  server: { host: true },
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['@electric-sql/pglite'] },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  },
});
