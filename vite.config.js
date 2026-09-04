import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  base: './',
  define: {
    'global': 'globalThis'
  },
  resolve: {
    alias: {
      'jsmediatags': path.resolve(__dirname, 'node_modules/jsmediatags/dist/jsmediatags.min.js')
    }
  },
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    target: 'esnext'
  },
  optimizeDeps: {
    include: [
      'buffer',
      'wavesurfer.js',
      'wavesurfer.js/plugins/regions',
      'jszip',
      'music-metadata-browser',
      'jsmediatags',
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util'
    ]
  }
});
