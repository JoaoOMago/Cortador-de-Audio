import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    target: 'esnext'
  },
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      jsmediatags: path.resolve(__dirname, 'node_modules/jsmediatags/dist/jsmediatags.min.js')
    }
  }
});
