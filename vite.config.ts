import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Pure static build: `vite build` emits dist/ (index.html + hashed assets + public/brands.json).
// Cloudflare Pages: build command `npm run build`, output directory `dist`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
