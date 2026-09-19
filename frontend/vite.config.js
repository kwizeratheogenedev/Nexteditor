import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: '0.0.0.0',
    // Serves the app on a single origin: browser requests to /api and
    // /socket.io hit this dev server, which forwards them to the backend over
    // plain localhost - no CORS and no cross-site cookie issues, since the
    // browser only ever sees one origin. That's what makes opening the app
    // from another device on the same network work without extra config.
    //
    // Note there is deliberately no `allowedHosts` entry: Vite's default
    // already accepts localhost and bare IP addresses (so LAN access works)
    // while rejecting requests whose Host is a DNS name it doesn't know,
    // which is what keeps a public tunnel from reaching this dev server.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
      // Finished renders (the LongMix preview player, Montage results) are
      // served from /clips - proxied too so they load from LAN devices,
      // where the app talks to its own origin instead of localhost:3000.
      '/clips': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
})
