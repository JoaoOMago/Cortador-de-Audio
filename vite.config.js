import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    rollupOptions: {
      external: ['react-native-fs'],
    },
    rolldownOptions: {
      external: ['react-native-fs'],
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
