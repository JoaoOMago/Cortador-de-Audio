import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import { readAudioMetadata } from './metadataReader.js';
import { downloadSingleFile } from './zipExporter.js';

/**
 * Formats seconds into MM:SS.cs (minutes:seconds.hundredths)
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTime(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00.00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  const centis = Math.floor((totalSeconds % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

/**
 * Creates a track card controller and DOM node.
 * @param {Object} options
 * @param {File} options.file
 * @param {number} options.index
 * @param {Function} options.onRemove
 * @param {Function} options.onStateChange
 * @returns {Promise<Object>} Track controller object
 */
export async function createTrackCard({ file, index, onRemove, onStateChange = () => {} }) {
  const cardElement = document.createElement('div');
  cardElement.className = 'track-card';
  cardElement.id = `track-card-${index}`;

  const audioUrl = URL.createObjectURL(file);

  // Initial state
  const state = {
    file,
    originalName: file.name,
    duration: 0,
    cursorPosition: 0,
    cutStart: 0,
    cutEnd: 0,
    playbackRate: 1.0,
    status: 'loading', // 'loading' | 'clean' | 'trimmed' | 'modified' | 'processing' | 'ready' | 'error'
    statusText: 'Carregando metadados...',
    title: file.name.replace(/\.[^/.]+$/, ''),
    artist: '',
    album: '',
    year: '',
    coverBlob: null,
    coverUrl: null,
    coverChanged: false,
    processedBlob: null,
    processedFilename: '',
    isDestroyed: false,
    isPreviewingTrim: false
  };

  // Card Skeleton HTML
  cardElement.innerHTML = `
    <div class="card-header">
      <div class="card-title-group">
        <span class="track-number">#${index + 1}</span>
        <h3 class="track-filename" title="${file.name}">${file.name}</h3>
        <span class="badge badge-format">${(file.name.split('.').pop() || 'AUDIO').toUpperCase()}</span>
      </div>
      <div class="card-header-actions">
        <span class="badge badge-status" data-status="${state.status}">${state.statusText}</span>
        <button type="button" class="btn-icon btn-remove" title="Remover faixa da lista">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- Waveform & Playback Area -->
    <div class="waveform-section">
      <div class="waveform-wrapper">
        <div class="waveform-loading-overlay">
          <div class="spinner"></div>
          <span>Gerando forma de onda...</span>
        </div>
        <div class="waveform-container"></div>
      </div>

      <!-- Player Controls Bar -->
      <div class="player-controls">
        <div class="playback-main-group">
          <button type="button" class="btn btn-primary btn-play" disabled>
            <span class="play-icon">▶</span>
            <span class="play-label">Tocar</span>
          </button>
          <button type="button" class="btn btn-secondary btn-preview-trim" title="Tocar apenas o trecho que será mantido" disabled>
            <span>⏵|⏴ Tocar trecho</span>
          </button>
          <div class="time-display">
            <span class="current-time">00:00.00</span>
            <span class="time-separator">/</span>
            <span class="total-duration">--:--.--</span>
          </div>
        </div>

        <!-- Fine seek & Speed -->
        <div class="playback-secondary-group">
          <div class="fine-tuning-group" title="Ajuste fino da posição do cursor">
            <span class="control-label">Ajuste fino:</span>
            <button type="button" class="btn btn-tiny btn-step-back" disabled>-0.1s</button>
            <button type="button" class="btn btn-tiny btn-step-forward" disabled>+0.1s</button>
          </div>

          <div class="speed-selector-group">
            <span class="control-label">Velocidade:</span>
            <div class="btn-group">
              <button type="button" class="btn btn-speed active" data-speed="1">1x</button>
              <button type="button" class="btn btn-speed" data-speed="0.5">0.5x</button>
              <button type="button" class="btn btn-speed" data-speed="0.25">0.25x</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Cut Action Bar -->
      <div class="cut-controls-bar">
        <div class="cursor-info-badge">
          <span class="cursor-icon">📍</span>
          <span>Cursor: </span>
          <strong class="cursor-time-val">00:00.00</strong>
        </div>

        <div class="cut-buttons-group">
          <button type="button" class="btn btn-cut btn-cut-start" title="Remove todo o áudio antes do cursor (vinheta de início)" disabled>
            ✂️ Cortar início até aqui
          </button>
          <button type="button" class="btn btn-cut btn-cut-end" title="Remove todo o áudio depois do cursor (vinheta de encerramento)" disabled>
            Cortar daqui até o fim ✂️
          </button>
          <button type="button" class="btn btn-undo-cut" title="Restaura o áudio integral original" disabled>
            ↺ Desfazer corte
          </button>
        </div>

        <div class="cut-summary-badge">
          <span class="cut-summary-text">Sem corte (faixa completa)</span>
        </div>
      </div>
    </div>

    <!-- Metadata & Cover Art Section -->
    <div class="meta-section">
      <div class="cover-wrapper">
        <div class="cover-preview-container">
          <div class="cover-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            <span>Sem Capa</span>
          </div>
          <img class="cover-img hidden" alt="Capa do álbum" />
        </div>
        <div class="cover-actions">
          <label class="btn btn-secondary btn-upload-cover">
            🖼️ Trocar capa
            <input type="file" class="cover-file-input" accept="image/*" style="display: none;" />
          </label>
          <button type="button" class="btn btn-danger-soft btn-remove-cover hidden">
            Remover capa
          </button>
        </div>
      </div>

      <div class="metadata-form">
        <div class="form-row">
          <div class="form-group flex-2">
            <label>Título da Música</label>
            <input type="text" class="input-title" placeholder="Ex: Nome da Música" />
          </div>
          <div class="form-group flex-2">
            <label>Artista / Banda</label>
            <input type="text" class="input-artist" placeholder="Ex: Nome do Artista" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group flex-2">
            <label>Álbum</label>
            <input type="text" class="input-album" placeholder="Ex: Nome do Álbum" />
          </div>
          <div class="form-group flex-1">
            <label>Ano</label>
            <input type="text" class="input-year" placeholder="Ex: 2024" maxlength="4" />
          </div>
        </div>
      </div>
    </div>

    <!-- Processing & Export Footer -->
    <div class="card-footer">
      <div class="progress-bar-wrapper hidden">
        <div class="progress-bar-fill" style="width: 0%;"></div>
      </div>
      <div class="card-footer-actions">
        <span class="process-msg"></span>
        <button type="button" class="btn btn-success btn-download-track hidden">
          ⬇ Baixar esta faixa (.mp3)
        </button>
      </div>
    </div>
  `;

  // Select key elements
  const elStatus = cardElement.querySelector('.badge-status');
  const elBtnRemove = cardElement.querySelector('.btn-remove');
  const elWaveformLoading = cardElement.querySelector('.waveform-loading-overlay');
  const elWaveformContainer = cardElement.querySelector('.waveform-container');
  const elBtnPlay = cardElement.querySelector('.btn-play');
  const elPlayIcon = cardElement.querySelector('.play-icon');
  const elPlayLabel = cardElement.querySelector('.play-label');
  const elBtnPreviewTrim = cardElement.querySelector('.btn-preview-trim');
  const elCurrentTime = cardElement.querySelector('.current-time');
  const elTotalDuration = cardElement.querySelector('.total-duration');
  const elBtnStepBack = cardElement.querySelector('.btn-step-back');
  const elBtnStepForward = cardElement.querySelector('.btn-step-forward');
  const elSpeedButtons = cardElement.querySelectorAll('.btn-speed');
  const elCursorTimeVal = cardElement.querySelector('.cursor-time-val');
  const elBtnCutStart = cardElement.querySelector('.btn-cut-start');
  const elBtnCutEnd = cardElement.querySelector('.btn-cut-end');
  const elBtnUndoCut = cardElement.querySelector('.btn-undo-cut');
  const elCutSummaryText = cardElement.querySelector('.cut-summary-text');
  const elCoverImg = cardElement.querySelector('.cover-img');
  const elCoverPlaceholder = cardElement.querySelector('.cover-placeholder');
  const elCoverFileInput = cardElement.querySelector('.cover-file-input');
  const elBtnRemoveCover = cardElement.querySelector('.btn-remove-cover');
  const elInputTitle = cardElement.querySelector('.input-title');
  const elInputArtist = cardElement.querySelector('.input-artist');
  const elInputAlbum = cardElement.querySelector('.input-album');
  const elInputYear = cardElement.querySelector('.input-year');
  const elProgressBarWrapper = cardElement.querySelector('.progress-bar-wrapper');
  const elProgressBarFill = cardElement.querySelector('.progress-bar-fill');
  const elProcessMsg = cardElement.querySelector('.process-msg');
  const elBtnDownloadTrack = cardElement.querySelector('.btn-download-track');

  // Update Status helper
  function setStatus(status, text) {
    state.status = status;
    state.statusText = text;
    elStatus.setAttribute('data-status', status);
    elStatus.textContent = text;
    onStateChange();
  }

  // Update Cut Regions on WaveSurfer
  let wsRegions = null;
  let regionStartCut = null;
  let regionEndCut = null;
  let regionKept = null;

  function updateCutDisplay() {
    const hasStartCut = state.cutStart > 0.02;
    const hasEndCut = state.duration > 0 && state.cutEnd < state.duration - 0.02;

    if (hasStartCut || hasEndCut) {
      const keptDuration = Math.max(0, state.cutEnd - state.cutStart);
      elCutSummaryText.innerHTML = `
        <span class="cut-highlight">✂️ Início: ${formatTime(state.cutStart)}</span> | 
        <span class="cut-highlight">Fim: ${formatTime(state.cutEnd)}</span> | 
        <span>Duração final: <strong>${formatTime(keptDuration)}</strong></span>
      `;
      elBtnUndoCut.disabled = false;
      if (state.status === 'clean' || state.status === 'loading') {
        setStatus('trimmed', 'Cortado');
      }
    } else {
      elCutSummaryText.textContent = 'Sem corte (faixa completa)';
      elBtnUndoCut.disabled = true;
      if (state.status === 'trimmed') {
        setStatus('clean', 'Não editado');
      }
    }

    if (!wsRegions) return;

    // Clear previous regions
    wsRegions.clearRegions();

    // Visual region for discarded start
    if (hasStartCut) {
      wsRegions.addRegion({
        start: 0,
        end: state.cutStart,
        color: 'rgba(239, 68, 68, 0.35)',
        drag: false,
        resize: false,
        content: document.createTextNode('✂️ Vinheta Início (Descarte)')
      });
    }

    // Visual region for kept audio
    wsRegions.addRegion({
      start: state.cutStart,
      end: state.cutEnd,
      color: 'rgba(16, 185, 129, 0.18)',
      drag: false,
      resize: false
    });

    // Visual region for discarded end
    if (hasEndCut) {
      wsRegions.addRegion({
        start: state.cutEnd,
        end: state.duration,
        color: 'rgba(239, 68, 68, 0.35)',
        drag: false,
        resize: false,
        content: document.createTextNode('✂️ Vinheta Fim (Descarte)')
      });
    }
  }

  // Cover image UI helper
  function updateCoverUI(blob, url) {
    if (blob && url) {
      elCoverImg.src = url;
      elCoverImg.classList.remove('hidden');
      elCoverPlaceholder.classList.add('hidden');
      elBtnRemoveCover.classList.remove('hidden');
    } else {
      elCoverImg.src = '';
      elCoverImg.classList.add('hidden');
      elCoverPlaceholder.classList.remove('hidden');
      elBtnRemoveCover.classList.add('hidden');
    }
  }

  // Initialize WaveSurfer
  const ws = WaveSurfer.create({
    container: elWaveformContainer,
    waveColor: '#6366f1',
    progressColor: '#a855f7',
    cursorColor: '#f43f5e',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    height: 90,
    url: audioUrl
  });

  wsRegions = ws.registerPlugin(RegionsPlugin.create());

  // WaveSurfer ready event
  ws.on('ready', () => {
    if (state.isDestroyed) return;
    elWaveformLoading.classList.add('hidden');
    state.duration = ws.getDuration();
    state.cutEnd = state.duration;
    state.cutStart = 0;

    elTotalDuration.textContent = formatTime(state.duration);
    elBtnPlay.disabled = false;
    elBtnPreviewTrim.disabled = false;
    elBtnStepBack.disabled = false;
    elBtnStepForward.disabled = false;
    elBtnCutStart.disabled = false;
    elBtnCutEnd.disabled = false;

    updateCutDisplay();
    if (state.status === 'loading') {
      setStatus('clean', 'Não editado');
    }
  });

  // Clicking on the waveform only repositions cursor (never cuts!)
  ws.on('interaction', (newTime) => {
    state.cursorPosition = Math.max(0, Math.min(newTime, state.duration));
    elCursorTimeVal.textContent = formatTime(state.cursorPosition);
    elCurrentTime.textContent = formatTime(state.cursorPosition);
  });

  // Time update during playback
  ws.on('timeupdate', (currentTime) => {
    elCurrentTime.textContent = formatTime(currentTime);
    state.cursorPosition = currentTime;
    elCursorTimeVal.textContent = formatTime(currentTime);

    // If previewing the trim, stop automatically at cutEnd
    if (state.isPreviewingTrim && currentTime >= state.cutEnd) {
      ws.pause();
      state.isPreviewingTrim = false;
      elBtnPreviewTrim.classList.remove('active');
    }
  });

  ws.on('play', () => {
    elPlayIcon.textContent = '⏸';
    elPlayLabel.textContent = 'Pausar';
    elBtnPlay.classList.add('btn-playing');
  });

  ws.on('pause', () => {
    elPlayIcon.textContent = '▶';
    elPlayLabel.textContent = 'Tocar';
    elBtnPlay.classList.remove('btn-playing');
    state.isPreviewingTrim = false;
    elBtnPreviewTrim.classList.remove('active');
  });

  // Play / Pause Click
  elBtnPlay.addEventListener('click', () => {
    state.isPreviewingTrim = false;
    ws.playPause();
  });

  // Preview Trim Section Click
  elBtnPreviewTrim.addEventListener('click', () => {
    if (state.duration <= 0) return;
    state.isPreviewingTrim = true;
    elBtnPreviewTrim.classList.add('active');
    ws.setTime(state.cutStart);
    ws.play();
  });

  // Fine-tuning buttons
  elBtnStepBack.addEventListener('click', () => {
    const newPos = Math.max(0, state.cursorPosition - 0.1);
    ws.setTime(newPos);
    state.cursorPosition = newPos;
    elCursorTimeVal.textContent = formatTime(newPos);
  });

  elBtnStepForward.addEventListener('click', () => {
    const newPos = Math.min(state.duration, state.cursorPosition + 0.1);
    ws.setTime(newPos);
    state.cursorPosition = newPos;
    elCursorTimeVal.textContent = formatTime(newPos);
  });

  // Playback Speed Buttons
  elSpeedButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const rate = parseFloat(btn.getAttribute('data-speed'));
      state.playbackRate = rate;
      ws.setPlaybackRate(rate);
      elSpeedButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // CUT INÍCIO ATÉ AQUI
  elBtnCutStart.addEventListener('click', () => {
    if (state.cursorPosition >= state.cutEnd - 0.05) {
      alert('O corte de início deve ser anterior ao ponto de corte de fim.');
      return;
    }
    state.cutStart = state.cursorPosition;
    updateCutDisplay();
  });

  // CORTAR DAQUI ATÉ O FIM
  elBtnCutEnd.addEventListener('click', () => {
    if (state.cursorPosition <= state.cutStart + 0.05) {
      alert('O corte de fim deve ser posterior ao ponto de corte de início.');
      return;
    }
    state.cutEnd = state.cursorPosition;
    updateCutDisplay();
  });

  // DESFAZER CORTE
  elBtnUndoCut.addEventListener('click', () => {
    state.cutStart = 0;
    state.cutEnd = state.duration;
    updateCutDisplay();
  });

  // Cover image selection
  elCoverFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (state.coverUrl && state.coverChanged) {
      URL.revokeObjectURL(state.coverUrl);
    }

    state.coverBlob = file;
    state.coverUrl = URL.createObjectURL(file);
    state.coverChanged = true;
    updateCoverUI(state.coverBlob, state.coverUrl);
    if (state.status === 'clean') setStatus('modified', 'Metadados alterados');
  });

  // Remove Cover
  elBtnRemoveCover.addEventListener('click', () => {
    if (state.coverUrl && state.coverChanged) {
      URL.revokeObjectURL(state.coverUrl);
    }
    state.coverBlob = null;
    state.coverUrl = null;
    state.coverChanged = true;
    updateCoverUI(null, null);
    if (state.status === 'clean') setStatus('modified', 'Metadados alterados');
  });

  // Metadata input handlers
  function onMetaInput() {
    state.title = elInputTitle.value;
    state.artist = elInputArtist.value;
    state.album = elInputAlbum.value;
    state.year = elInputYear.value;
    if (state.status === 'clean') {
      setStatus('modified', 'Metadados alterados');
    }
  }

  elInputTitle.addEventListener('input', onMetaInput);
  elInputArtist.addEventListener('input', onMetaInput);
  elInputAlbum.addEventListener('input', onMetaInput);
  elInputYear.addEventListener('input', onMetaInput);

  // Download single track handler
  elBtnDownloadTrack.addEventListener('click', () => {
    if (state.processedBlob && state.processedFilename) {
      downloadSingleFile(state.processedBlob, state.processedFilename);
    }
  });

  // Remove Card handler
  elBtnRemove.addEventListener('click', () => {
    destroy();
    onRemove(index);
  });

  // Destroy / Cleanup helper
  function destroy() {
    state.isDestroyed = true;
    try {
      ws.destroy();
    } catch (_) {}
    URL.revokeObjectURL(audioUrl);
    if (state.coverUrl) {
      URL.revokeObjectURL(state.coverUrl);
    }
    if (cardElement.parentNode) {
      cardElement.parentNode.removeChild(cardElement);
    }
  }

  // Asynchronously extract original metadata and cover image
  readAudioMetadata(file).then((meta) => {
    if (state.isDestroyed) return;

    state.title = meta.title || file.name.replace(/\.[^/.]+$/, '');
    state.artist = meta.artist || '';
    state.album = meta.album || '';
    state.year = meta.year || '';
    state.coverBlob = meta.coverBlob;
    state.coverUrl = meta.coverUrl;

    elInputTitle.value = state.title;
    elInputArtist.value = state.artist;
    elInputAlbum.value = state.album;
    elInputYear.value = state.year;

    updateCoverUI(state.coverBlob, state.coverUrl);
  });

  // Public Controller interface
  return {
    element: cardElement,
    state,
    destroy,

    setProcessingState(isProcessing, progressRatio = 0, message = '') {
      if (isProcessing) {
        setStatus('processing', 'Processando...');
        elProgressBarWrapper.classList.remove('hidden');
        elProgressBarFill.style.width = `${Math.round(progressRatio * 100)}%`;
        elProcessMsg.textContent = message || `Convertendo áudio... ${Math.round(progressRatio * 100)}%`;
        elBtnDownloadTrack.classList.add('hidden');
      } else {
        elProgressBarWrapper.classList.add('hidden');
      }
    },

    setReadyState(blob, filename) {
      state.processedBlob = blob;
      state.processedFilename = filename;
      setStatus('ready', 'Pronto ✓');
      elProgressBarWrapper.classList.add('hidden');
      elProcessMsg.textContent = `Salvo como: ${filename}`;
      elBtnDownloadTrack.classList.remove('hidden');
    },

    setErrorState(errMsg) {
      setStatus('error', 'Erro');
      elProgressBarWrapper.classList.add('hidden');
      elProcessMsg.textContent = `Erro: ${errMsg}`;
    }
  };
}
