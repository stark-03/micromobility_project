import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // MapLibre ships its renderer as a separate worker entry
    // (maplibre-gl-worker.mjs). Vite's dependency pre-bundler rewrites the
    // main module but does not emit the worker alongside it, so the map fails
    // at runtime with "file does not exist in the optimize deps directory" and
    // the canvas stays empty. Excluding it leaves MapLibre to be served as-is,
    // worker and all.
    exclude: ['maplibre-gl'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      // ws:true so the Socket.IO upgrade handshake survives the proxy.
      '/socket.io': { target: 'http://localhost:4000', changeOrigin: true, ws: true },
    },
  },
  build: { sourcemap: true },
});
