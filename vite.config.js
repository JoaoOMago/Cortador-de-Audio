import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
    target: 'esnext'
  },
  optimizeDeps: {
    include: [
      'wavesurfer.js',
      'wavesurfer.js/plugins/regions',
      'jszip',
      'music-metadata-browser',
      '@ffmpeg/ffmpeg',
      '@ffmpeg/util'
    ]
  }
});
