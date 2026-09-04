import './styles.css';
import { createTrackCard } from './components/trackCard.js';
import { processAudioTrack, getFFmpeg } from './components/audioProcessor.js';
import { exportToZip } from './components/zipExporter.js';

// Application State
const trackControllers = [];
let isProcessingBatch = false;

// DOM Elements
const dropzone = document.getElementById('dropzone');
const audioFileInput = document.getElementById('audio-file-input');
const trackListContainer = document.getElementById('track-list-container');
const emptyPlaceholder = document.getElementById('empty-placeholder');
const listToolbar = document.getElementById('list-toolbar');
const totalTracksCountEl = document.getElementById('total-tracks-count');
const stickyBottomBar = document.getElementById('sticky-bottom-bar');
const barTrackCountEl = document.getElementById('bar-track-count');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnClearAll = document.getElementById('btn-clear-all');
const globalProgressContainer = document.getElementById('global-progress-container');
const globalProgressFill = document.getElementById('global-progress-fill');
const globalProgressText = document.getElementById('global-progress-text');
const toastContainer = document.getElementById('toast-container');

/**
 * Displays a toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} durationMs
 */
export function showToast(message, type = 'info', durationMs = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon =
    type === 'success' ? '✓' :
    type === 'warning' ? '⚠' :
    type === 'error' ? '✕' : 'ℹ';

  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, durationMs);
}

/**
 * Updates UI toolbar and sticky bar visibility and count metrics.
 */
function updateListStats() {
  const count = trackControllers.length;

  if (count === 0) {
    emptyPlaceholder.classList.remove('hidden');
    listToolbar.classList.add('hidden');
    stickyBottomBar.classList.add('hidden');
  } else {
    emptyPlaceholder.classList.add('hidden');
    listToolbar.classList.remove('hidden');
    stickyBottomBar.classList.remove('hidden');

    totalTracksCountEl.textContent = `${count} ${count === 1 ? 'música carregada' : 'músicas carregadas'}`;
    barTrackCountEl.textContent = `${count} ${count === 1 ? 'música pronta para exportação' : 'músicas prontas para exportação'}`;
  }
}

/**
 * Appends audio files to the editor list.
 * @param {FileList|File[]} files
 */
async function addFiles(files) {
  if (!files || files.length === 0) return;

  const validAudioFiles = Array.from(files).filter((file) => {
    const isAudioType = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg|aac|wma|opus)$/i.test(file.name);
    return isAudioType;
  });

  if (validAudioFiles.length === 0) {
    showToast('Nenhum arquivo de áudio compatível selecionado (.mp3, .wav, .m4a, .flac).', 'warning');
    return;
  }

  showToast(`Adicionando ${validAudioFiles.length} ${validAudioFiles.length === 1 ? 'faixa' : 'faixas'}...`, 'info');

  for (const file of validAudioFiles) {
    const currentIndex = trackControllers.length;

    const controller = await createTrackCard({
      file,
      index: currentIndex,
      onRemove: (removedIndex) => {
        const idx = trackControllers.indexOf(controller);
        if (idx !== -1) {
          trackControllers.splice(idx, 1);
          updateListStats();
        }
      },
      onStateChange: () => {
        // State update hook
      }
    });

    trackControllers.push(controller);
    trackListContainer.appendChild(controller.element);
    updateListStats();
  }
}

// Drag & Drop Event Listeners
['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('drag-over');
  });
});

dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length > 0) {
    addFiles(dt.files);
  }
});

// Dropzone click opens file input
dropzone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
    audioFileInput.click();
  }
});

audioFileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    addFiles(e.target.files);
    audioFileInput.value = ''; // Reset for re-selection
  }
});

// Clear all tracks
btnClearAll.addEventListener('click', () => {
  if (isProcessingBatch) return;

  if (trackControllers.length > 0) {
    if (confirm(`Deseja remover todas as ${trackControllers.length} músicas da lista?`)) {
      while (trackControllers.length > 0) {
        const ctrl = trackControllers.pop();
        ctrl.destroy();
      }
      updateListStats();
      showToast('Lista de músicas limpa.', 'info');
    }
  }
});

// Download All (Batch Processing & ZIP generation)
btnDownloadAll.addEventListener('click', async () => {
  if (isProcessingBatch) return;
  if (trackControllers.length === 0) {
    showToast('Nenhuma música para processar.', 'warning');
    return;
  }

  isProcessingBatch = true;
  btnDownloadAll.disabled = true;
  btnClearAll.disabled = true;
  globalProgressContainer.classList.remove('hidden');

  const total = trackControllers.length;
  const processedResults = [];
  let successCount = 0;

  try {
    // 1. Ensure FFmpeg is warmed up
    globalProgressText.textContent = 'Carregando motor FFmpeg WebAssembly...';
    globalProgressFill.style.width = '5%';
    await getFFmpeg((status) => {
      globalProgressText.textContent = status;
    });

    // 2. Process each track sequentially
    for (let i = 0; i < total; i++) {
      const controller = trackControllers[i];
      const state = controller.state;
      const trackNum = i + 1;

      globalProgressText.textContent = `Processando música ${trackNum} de ${total}: "${state.title}"...`;
      controller.setProcessingState(true, 0, 'Iniciando corte e metadados...');

      try {
        const result = await processAudioTrack({
          file: state.file,
          originalName: state.originalName,
          cutStart: state.cutStart,
          cutEnd: state.cutEnd,
          duration: state.duration,
          title: state.title,
          artist: state.artist,
          album: state.album,
          year: state.year,
          coverBlob: state.coverBlob,
          onProgress: (ratio) => {
            controller.setProcessingState(true, ratio);
            const overallRatio = (i + ratio) / total;
            globalProgressFill.style.width = `${Math.round(overallRatio * 85)}%`;
          }
        });

        controller.setReadyState(result.blob, result.filename);
        processedResults.push(result);
        successCount++;
      } catch (trackError) {
        console.error(`Erro ao processar faixa #${trackNum}:`, trackError);
        controller.setErrorState(trackError.message || 'Falha no processamento');
      }
    }

    if (processedResults.length === 0) {
      throw new Error('Nenhuma faixa pôde ser processada com sucesso.');
    }

    // 3. Package all into ZIP
    globalProgressText.textContent = 'Compactando arquivos em arquivo .ZIP...';
    globalProgressFill.style.width = '90%';

    await exportToZip(processedResults, 'musicas_editadas.zip', (zipPercent) => {
      const finalProgress = 85 + (zipPercent * 0.15);
      globalProgressFill.style.width = `${Math.round(finalProgress)}%`;
      globalProgressText.textContent = `Compactando ZIP: ${Math.round(zipPercent)}%...`;
    });

    globalProgressFill.style.width = '100%';
    globalProgressText.textContent = `Concluído! ${successCount} de ${total} faixas exportadas com sucesso.`;
    showToast(`ZIP gerado com sucesso! (${successCount} músicas)`, 'success', 5000);

  } catch (error) {
    console.error('Erro na exportação em lote:', error);
    showToast(`Falha na exportação: ${error.message || 'Erro inesperado'}`, 'error', 5000);
    globalProgressText.textContent = `Erro: ${error.message}`;
  } finally {
    isProcessingBatch = false;
    btnDownloadAll.disabled = false;
    btnClearAll.disabled = false;
    setTimeout(() => {
      if (!isProcessingBatch) {
        globalProgressContainer.classList.add('hidden');
      }
    }, 4000);
  }
});

// Initialize UI
updateListStats();
