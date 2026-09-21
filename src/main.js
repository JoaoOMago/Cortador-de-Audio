import './styles.css';
import { createTrackCard } from './components/trackCard.js';
import { processAudioTrack, getFFmpeg } from './components/audioProcessor.js';
import { exportToZip } from './components/zipExporter.js';
import { showToast } from './components/toast.js';
import { ALL_METADATA_FIELDS, getEnabledFieldKeys, saveEnabledFieldKeys } from './services/metadataConfigService.js';

// Re-export for backwards compatibility
export { showToast };

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

// Metadata Modal Elements
const btnOpenConfigHeader = document.getElementById('btn-open-metadata-config-header');
const btnOpenConfigToolbar = document.getElementById('btn-open-metadata-config-toolbar');
const modalMetadataConfig = document.getElementById('modal-metadata-config');
const btnCloseMetadataModal = document.getElementById('btn-close-metadata-modal');
const btnSaveMetadataConfig = document.getElementById('btn-save-metadata-config');
const checkboxToggleAll = document.getElementById('checkbox-toggle-all-metadata');
const metadataFieldsGrid = document.getElementById('metadata-fields-grid');

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

  // Retrieve configured timeout
  const timeoutInput = document.getElementById('input-timeout-limit');
  let timeoutSec = 120;
  if (timeoutInput && timeoutInput.value) {
    const mins = parseFloat(timeoutInput.value);
    if (!isNaN(mins) && mins > 0) {
      timeoutSec = Math.round(mins * 60);
    }
  }

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
          genre: state.genre,
          bpm: state.bpm,
          subtitle: state.subtitle,
          rating: state.rating,
          composer: state.composer,
          trackNumber: state.trackNumber,
          discNumber: state.discNumber,
          albumArtist: state.albumArtist,
          copyright: state.copyright,
          lyrics: state.lyrics,
          comment: state.comment,
          extraMetadata: state.extraMetadata,
          coverBlob: state.coverBlob,
          timeoutSeconds: timeoutSec,
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
        controller.setErrorState(trackError.message || 'Falha no processamento', trackError);
      }
    }

    if (processedResults.length === 0) {
      throw new Error('Nenhuma faixa pôde ser processada com sucesso. Verifique os logs de erro individuais nos cards.');
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
    const summaryMsg = successCount === total 
      ? `Concluído! Todas as ${total} faixas exportadas com sucesso.`
      : `Concluído com avisos! ${successCount} de ${total} faixas exportadas (${total - successCount} falharam).`;
    globalProgressText.textContent = summaryMsg;
    showToast(summaryMsg, successCount === total ? 'success' : 'warning', 6000);

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

// ==========================================
// Metadata Configuration Modal Controller
// ==========================================
function renderMetadataConfigModal() {
  if (!metadataFieldsGrid) return;
  const enabledKeys = getEnabledFieldKeys();

  metadataFieldsGrid.innerHTML = ALL_METADATA_FIELDS.map((f) => {
    const isChecked = enabledKeys.has(f.key);
    return `
      <div class="metadata-field-card ${isChecked ? 'active' : ''}">
        <label class="checkbox-label">
          <input type="checkbox" class="field-checkbox" data-key="${f.key}" ${isChecked ? 'checked' : ''} />
          <span class="checkbox-custom"></span>
          <div class="field-info">
            <span class="field-title">${f.label}</span>
            <span class="field-tag">ID3: ${f.id3Tag}</span>
          </div>
        </label>
      </div>
    `;
  }).join('');

  updateSelectAllCheckboxState();

  metadataFieldsGrid.querySelectorAll('.field-checkbox').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const card = e.target.closest('.metadata-field-card');
      if (card) {
        card.classList.toggle('active', e.target.checked);
      }
      updateSelectAllCheckboxState();
    });
  });
}

function updateSelectAllCheckboxState() {
  if (!checkboxToggleAll || !metadataFieldsGrid) return;
  const checkboxes = Array.from(metadataFieldsGrid.querySelectorAll('.field-checkbox'));
  const allChecked = checkboxes.length > 0 && checkboxes.every(c => c.checked);
  const someChecked = checkboxes.some(c => c.checked);
  checkboxToggleAll.checked = allChecked;
  checkboxToggleAll.indeterminate = someChecked && !allChecked;
}

function openMetadataModal() {
  renderMetadataConfigModal();
  modalMetadataConfig.classList.remove('hidden');
}

function closeMetadataModal() {
  modalMetadataConfig.classList.add('hidden');
}

function saveAndApplyMetadataConfig() {
  if (!metadataFieldsGrid) return;
  const checkboxes = Array.from(metadataFieldsGrid.querySelectorAll('.field-checkbox'));
  const selectedKeys = checkboxes.filter(c => c.checked).map(c => c.getAttribute('data-key'));
  saveEnabledFieldKeys(selectedKeys);
  closeMetadataModal();
  showToast('Campos de metadados atualizados para todas as músicas!', 'success', 3000);
}

if (btnOpenConfigHeader) btnOpenConfigHeader.addEventListener('click', openMetadataModal);
if (btnOpenConfigToolbar) btnOpenConfigToolbar.addEventListener('click', openMetadataModal);
if (btnCloseMetadataModal) btnCloseMetadataModal.addEventListener('click', closeMetadataModal);
if (btnSaveMetadataConfig) btnSaveMetadataConfig.addEventListener('click', saveAndApplyMetadataConfig);

if (modalMetadataConfig) {
  modalMetadataConfig.addEventListener('click', (e) => {
    if (e.target === modalMetadataConfig) {
      closeMetadataModal();
    }
  });
}

if (checkboxToggleAll) {
  checkboxToggleAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (metadataFieldsGrid) {
      metadataFieldsGrid.querySelectorAll('.field-checkbox').forEach((chk) => {
        chk.checked = isChecked;
        const card = chk.closest('.metadata-field-card');
        if (card) card.classList.toggle('active', isChecked);
      });
    }
  });
}

// Escape key to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalMetadataConfig && !modalMetadataConfig.classList.contains('hidden')) {
    closeMetadataModal();
  }
});

// Initialize UI
updateListStats();
