import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 47322);

export default defineConfig({
  server: {
    port: 47321,
    strictPort: true,
    host: true,
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
    },
  },
  preview: { port: 47321, host: true },
});
