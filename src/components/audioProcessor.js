import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

let ffmpegInstance = null;
let isFFmpegLoading = false;
let loadPromise = null;

const CDN_SOURCES = [
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
];

/**
 * Initializes and loads the singleton FFmpeg.wasm instance.
 * @param {Function} [onStatusUpdate] - Status callback
 * @returns {Promise<FFmpeg>}
 */
export async function getFFmpeg(onStatusUpdate = () => {}) {
  if (ffmpegInstance && ffmpegInstance.loaded) {
    return ffmpegInstance;
  }

  if (isFFmpegLoading && loadPromise) {
    return loadPromise;
  }

  isFFmpegLoading = true;
  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();

    ffmpeg.on('log', ({ message }) => {
      // Keep internal debug logs clean
      if (message.includes('Error') || message.includes('error')) {
        console.warn('[FFmpeg log]', message);
      }
    });

    let loaded = false;
    let lastError = null;

    for (const baseURL of CDN_SOURCES) {
      try {
        onStatusUpdate(`Carregando motor FFmpeg (${baseURL.includes('unpkg') ? 'unpkg' : 'jsdelivr'})...`);
        
        const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

        await ffmpeg.load({
          coreURL,
          wasmURL
        });

        loaded = true;
        ffmpegInstance = ffmpeg;
        break;
      } catch (err) {
        console.warn(`[audioProcessor] Falha ao carregar de ${baseURL}:`, err);
        lastError = err;
      }
    }

    isFFmpegLoading = false;

    if (!loaded) {
      throw new Error(`Não foi possível carregar o motor WebAssembly do FFmpeg: ${lastError?.message || 'Erro desconhecido'}`);
    }

    return ffmpegInstance;
  })();

  return loadPromise;
}

/**
 * Sanitizes a string to be safely used as a filename.
 * @param {string} str
 * @returns {string}
 */
export function sanitizeFilename(str) {
  if (!str) return 'audio';
  return str
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Processes a single audio track with trimming, metadata update, and cover embedding.
 *
 * @param {Object} options
 * @param {File|Blob} options.file - Original audio file
 * @param {string} options.originalName - Name of original file
 * @param {number} options.cutStart - Cut start in seconds (default: 0)
 * @param {number} options.cutEnd - Cut end in seconds
 * @param {number} options.duration - Total duration in seconds
 * @param {string} options.title - ID3 title
 * @param {string} options.artist - ID3 artist
 * @param {string} options.album - ID3 album
 * @param {string} options.year - ID3 year
 * @param {Blob|null} options.coverBlob - Cover image blob
 * @param {Function} [options.onProgress] - Progress callback (ratio: 0-1)
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function processAudioTrack({
  file,
  originalName,
  cutStart = 0,
  cutEnd = 0,
  duration = 0,
  title = '',
  artist = '',
  album = '',
  year = '',
  coverBlob = null,
  onProgress = () => {}
}) {
  const ffmpeg = await getFFmpeg();

  const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const extMatch = originalName.match(/\.([0-9a-z]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';

  const inputFilename = `in_${fileId}.${ext}`;
  const coverFilename = `cover_${fileId}.jpg`;
  const outputFilename = `out_${fileId}.mp3`;

  const filesToCleanup = [inputFilename, outputFilename];

  // Set up progress handler for this task
  const progressHandler = ({ progress, time }) => {
    if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
      onProgress(progress);
    }
  };

  ffmpeg.on('progress', progressHandler);

  try {
    onProgress(0.05);

    // 1. Write audio file into FFmpeg virtual filesystem
    const inputData = await fetchFile(file);
    await ffmpeg.writeFile(inputFilename, inputData);
    onProgress(0.15);

    // 2. Build FFmpeg command arguments
    const args = [];

    const hasStartCut = cutStart > 0.05;
    const hasEndCut = duration > 0 && cutEnd > 0 && cutEnd < (duration - 0.05);

    if (hasStartCut) {
      args.push('-ss', cutStart.toFixed(3));
    }
    if (hasEndCut) {
      args.push('-to', cutEnd.toFixed(3));
    }

    // Input audio
    args.push('-i', inputFilename);

    let hasCover = Boolean(coverBlob);
    if (hasCover) {
      try {
        const coverData = await fetchFile(coverBlob);
        await ffmpeg.writeFile(coverFilename, coverData);
        filesToCleanup.push(coverFilename);
        args.push('-i', coverFilename);
        args.push('-map', '0:a');
        args.push('-map', '1:0');
        args.push('-c:v', 'mjpeg');
        args.push('-id3v2_version', '3');
        args.push('-metadata:s:v', 'title=Album cover');
        args.push('-metadata:s:v', 'comment=Cover (front)');
      } catch (err) {
        console.warn('[audioProcessor] Falha ao preparar imagem da capa, prosseguindo sem capa:', err);
        hasCover = false;
        args.push('-map', '0:a');
      }
    } else {
      args.push('-map', '0:a');
    }

    // ID3 Metadata
    if (title && title.trim()) {
      args.push('-metadata', `title=${title.trim()}`);
    }
    if (artist && artist.trim()) {
      args.push('-metadata', `artist=${artist.trim()}`);
    }
    if (album && album.trim()) {
      args.push('-metadata', `album=${album.trim()}`);
    }
    if (year && year.trim()) {
      args.push('-metadata', `date=${year.trim()}`);
    }

    // High quality MP3 encoding for precise cuts & universal compatibility
    args.push('-c:a', 'libmp3lame', '-q:a', '2');
    args.push(outputFilename);

    onProgress(0.3);

    // 3. Execute FFmpeg
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg finalizou com código de erro ${exitCode}`);
    }

    onProgress(0.9);

    // 4. Read output file
    const outputData = await ffmpeg.readFile(outputFilename);
    const outputBlob = new Blob([outputData.buffer || outputData], { type: 'audio/mp3' });

    // 5. Generate formatted filename: {Artist} - {Title}.mp3
    const finalArtist = (artist || '').trim();
    const finalTitle = (title || originalName.replace(/\.[^/.]+$/, '')).trim();

    let outputBase = '';
    if (finalArtist && finalTitle) {
      outputBase = `${finalArtist} - ${finalTitle}`;
    } else if (finalTitle) {
      outputBase = finalTitle;
    } else {
      outputBase = originalName.replace(/\.[^/.]+$/, '');
    }

    const outputName = `${sanitizeFilename(outputBase)}.mp3`;
    onProgress(1.0);

    return {
      blob: outputBlob,
      filename: outputName
    };
  } finally {
    // Detach progress listener
    ffmpeg.off('progress', progressHandler);

    // Cleanup virtual memory
    for (const virtualFile of filesToCleanup) {
      try {
        await ffmpeg.deleteFile(virtualFile);
      } catch (_) {}
    }
  }
}
