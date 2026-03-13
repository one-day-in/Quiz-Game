import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // GitHub Pages project site for https://one-day-in.github.io/Quiz-Game/
  base: '/Quiz-Game/',
  publicDir: 'public',
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        leaderboard: resolve(__dirname, 'leaderboard.html'),
        player: resolve(__dirname, 'player.html'),
      },
    },
  },
});
