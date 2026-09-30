import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 47322);

// Vite rejects unknown Host headers; IPs and localhost are always allowed, tunnels need listing.
const allowedHosts = [
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.app',
  '.ngrok.io',
  '.trycloudflare.com',
  ...(process.env.ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean) ?? []),
];

export default defineConfig({
  server: {
    port: 47321,
    strictPort: true,
    host: true,
    allowedHosts,
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true },
    },
  },
  preview: { port: 47321, host: true, allowedHosts },
});
