import { defineConfig } from 'vite';
import { resolve } from 'path';

function localSupabaseCspPlugin() {
  const localHttpSources = 'http://127.0.0.1:* http://localhost:*';

  return {
    name: 'local-supabase-csp',
    enforce: 'pre',
    transformIndexHtml(html) {
      return html
        .replace("connect-src 'self'", `connect-src 'self' ${localHttpSources}`)
        .replace("img-src 'self'", `img-src 'self' ${localHttpSources}`)
        .replace("media-src 'self'", `media-src 'self' ${localHttpSources}`);
    },
  };
}

export default defineConfig(({ command }) => ({
  // GitHub Pages project site for https://one-day-in.github.io/Quiz-Game/
  base: '/Quiz-Game/',
  publicDir: 'public',
  clearScreen: false,
  plugins: command === 'serve' ? [localSupabaseCspPlugin()] : [],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        leaderboard: resolve(__dirname, 'leaderboard.html'),
        player: resolve(__dirname, 'player.html'),
        hostController: resolve(__dirname, 'host-controller.html'),
      },
    },
  },
}));
