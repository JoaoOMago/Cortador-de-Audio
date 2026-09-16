import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util';

/**
 * Default timeout for processing a single audio file (in seconds).
 * 120 seconds = 2 minutes. Can be configured dynamically.
 */
export const DEFAULT_FILE_TIMEOUT_SECONDS = 120;

let ffmpegInstance = null;
let isFFmpegLoading = false;
let loadPromise = null;

// Ring buffer of global FFmpeg logs for debugging
const MAX_GLOBAL_LOGS = 100;
const globalFFmpegLogs = [];

const CDN_SOURCES = [
  'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm',
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
];

/**
 * Returns recent FFmpeg engine logs for debugging purposes.
 * @returns {string[]}
 */
export function getRecentFFmpegLogs() {
  return [...globalFFmpegLogs];
}

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
      const logLine = `[${new Date().toLocaleTimeString()}] ${message}`;
      globalFFmpegLogs.push(logLine);
      if (globalFFmpegLogs.length > MAX_GLOBAL_LOGS) {
        globalFFmpegLogs.shift();
      }

      if (message.includes('Error') || message.includes('error') || message.includes('failed')) {
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
 * Processes a single audio track with trimming, metadata update, and cover embedding,
 * with enforced timeout and execution log capture.
 *
 * @param {Object} options
 * @param {File|Blob} options.file - Original audio file
 * @param {string} options.originalName - Name of original file
 * @param {number} [options.cutStart=0] - Cut start in seconds
 * @param {number} [options.cutEnd=0] - Cut end in seconds
 * @param {number} [options.duration=0] - Total duration in seconds
 * @param {string} [options.title=''] - ID3 title
 * @param {string} [options.artist=''] - ID3 artist
 * @param {string} [options.album=''] - ID3 album
 * @param {string} [options.year=''] - ID3 year
 * @param {Blob|null} [options.coverBlob=null] - Cover image blob
 * @param {Function} [options.onProgress] - Progress callback (ratio: 0-1)
 * @param {number} [options.timeoutSeconds=DEFAULT_FILE_TIMEOUT_SECONDS] - Timeout limit in seconds
 * @returns {Promise<{blob: Blob, filename: string, logs: string[]}>}
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
  onProgress = () => {},
  timeoutSeconds = DEFAULT_FILE_TIMEOUT_SECONDS
}) {
  const ffmpeg = await getFFmpeg();

  const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const extMatch = originalName.match(/\.([0-9a-z]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';

  const inputFilename = `in_${fileId}.${ext}`;
  const coverFilename = `cover_${fileId}.jpg`;
  const outputFilename = `out_${fileId}.mp3`;

  const filesToCleanup = [inputFilename, outputFilename];
  const trackLogs = [];

  // Track-specific log listener
  const logHandler = ({ message }) => {
    trackLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  };
  ffmpeg.on('log', logHandler);

  // Track-specific progress listener
  const progressHandler = ({ progress }) => {
    if (typeof progress === 'number' && progress >= 0 && progress <= 1) {
      onProgress(progress);
    }
  };
  ffmpeg.on('progress', progressHandler);

  let timeoutTimer = null;
  const timeoutMs = Math.max(1000, Number(timeoutSeconds) * 1000 || DEFAULT_FILE_TIMEOUT_SECONDS * 1000);

  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      const formattedLimit = timeoutSeconds >= 60 
        ? `${(timeoutSeconds / 60).toFixed(1).replace('.0', '')} minuto(s)`
        : `${timeoutSeconds} segundos`;
      const timeoutErr = new Error(
        `Tempo limite de processamento excedido (${formattedLimit}). O arquivo demorou mais do que o limite configurado para ser processado.`
      );
      timeoutErr.isTimeout = true;
      timeoutErr.ffmpegLogs = [...trackLogs];
      reject(timeoutErr);
    }, timeoutMs);
  });

  const executionPromise = (async () => {
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
      const execErr = new Error(`FFmpeg finalizou com código de erro ${exitCode}`);
      execErr.ffmpegLogs = [...trackLogs];
      throw execErr;
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
      filename: outputName,
      logs: trackLogs
    };
  })();

  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);
    return result;
  } catch (err) {
    if (!err.ffmpegLogs) {
      err.ffmpegLogs = [...trackLogs];
    }
    throw err;
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }

    // Detach listeners
    ffmpeg.off('log', logHandler);
    ffmpeg.off('progress', progressHandler);

    // Cleanup virtual memory
    for (const virtualFile of filesToCleanup) {
      try {
        await ffmpeg.deleteFile(virtualFile);
      } catch (_) {}
    }
  }
}
