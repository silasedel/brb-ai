import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two builds from one source tree:
 *  - default          -> web/dist, served by the local Express app
 *  - VITE_STANDALONE=1 -> docs/, a static site for GitHub Pages with no backend
 */
const standalone = process.env.VITE_STANDALONE === '1';

export default defineConfig({
  root: 'web',
  base: standalone ? '/brb-ai/' : '/',
  plugins: [react()],
  build: {
    outDir: standalone ? '../docs' : 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5317,
    proxy: { '/api': 'http://localhost:4317' },
    fs: { allow: ['..'] },
  },
});
