import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import { readAudioMetadata } from './metadataReader.js';
import { downloadSingleFile } from './zipExporter.js';
import { processAudioTrack, getFFmpeg, DEFAULT_FILE_TIMEOUT_SECONDS } from './audioProcessor.js';
import { showToast } from './toast.js';
import { getSuggestionsForField } from '../services/metadataSearchService.js';
import { ALL_METADATA_FIELDS, getEnabledFieldKeys, subscribeToFieldChanges } from '../services/metadataConfigService.js';

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
 * Escapes HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Helper to get currently configured timeout in seconds from the UI input.
 * @returns {number} Timeout in seconds
 */
function getCurrentTimeoutSeconds() {
  const timeoutInput = document.getElementById('input-timeout-limit');
  if (timeoutInput && timeoutInput.value) {
    const mins = parseFloat(timeoutInput.value);
    if (!isNaN(mins) && mins > 0) {
      return Math.round(mins * 60);
    }
  }
  return DEFAULT_FILE_TIMEOUT_SECONDS;
}

/**
 * Accurately detects the true, exact PCM decoded duration of an audio file,
 * resolving inaccurate VBR/MP3 header estimates.
 * @param {File|Blob} file
 * @returns {Promise<number|null>}
 */
async function detectTrueAudioDuration(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (AudioCtxClass) {
      const audioCtx = new AudioCtxClass();
      try {
        const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
        if (decoded && decoded.duration > 0 && isFinite(decoded.duration)) {
          return decoded.duration;
        }
      } finally {
        if (audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[detectTrueAudioDuration] Fallback para duração padrão:', err);
  }
  return null;
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

  // Initial state with extended ID3 metadata
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
    genre: '',
    bpm: '',
    subtitle: '',
    rating: '',
    composer: '',
    trackNumber: '',
    discNumber: '',
    albumArtist: '',
    copyright: '',
    lyrics: '',
    comment: '',
    extraMetadata: {},
    coverBlob: null,
    coverUrl: null,
    coverChanged: false,
    processedBlob: null,
    processedFilename: '',
    isDestroyed: false,
    isPreviewingTrim: false,
    isProcessingSingle: false,
    errorLog: []
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

    <!-- Waveform & Trimmer Section -->
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

    <!-- Metadata & Cover Editor -->
    <div class="meta-section">
      <!-- Cover Image Preview & Uploader -->
      <div class="cover-wrapper">
        <div class="cover-preview-container">
          <div class="cover-placeholder">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
            <span>Sem capa</span>
          </div>
          <img class="cover-img hidden" alt="Capa do Álbum" />
        </div>
        <div class="cover-actions">
          <label class="btn btn-secondary btn-upload-cover">
            Trocar capa
            <input type="file" class="cover-file-input" accept="image/jpeg,image/png,image/webp" style="display: none;" />
          </label>
          <button type="button" class="btn btn-danger-soft btn-remove-cover hidden">Remover</button>
        </div>
      </div>

      <!-- ID3 Tags Inputs -->
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
            <div class="input-search-group" data-field="album">
              <input type="text" class="input-album" placeholder="Ex: Nome do Álbum" />
              <button type="button" class="btn-field-search" title="Buscar opções de Álbum na web">
                <span class="search-icon">🔍</span>
                <span class="search-spinner hidden">⏳</span>
              </button>
            </div>
          </div>
          <div class="form-group flex-1">
            <label>Ano</label>
            <div class="input-search-group" data-field="year">
              <input type="text" class="input-year" placeholder="Ex: 2024" maxlength="4" />
              <button type="button" class="btn-field-search" title="Buscar ano de lançamento na web">
                <span class="search-icon">🔍</span>
                <span class="search-spinner hidden">⏳</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Dynamic Extra Metadata Fields Grid -->
        <div class="extra-metadata-container"></div>
      </div>
    </div>

    <!-- Processing & Export Footer -->
    <div class="card-footer">
      <div class="progress-bar-wrapper hidden">
        <div class="progress-bar-fill" style="width: 0%;"></div>
      </div>
      <div class="card-footer-actions">
        <span class="process-msg"></span>
        <div class="card-footer-buttons">
          <button type="button" class="btn btn-primary btn-download-single" title="Processar e baixar esta música individualmente">
            ⬇ Baixar esta música (.mp3)
          </button>
          <button type="button" class="btn btn-success btn-download-track hidden" title="Baixar novamente o áudio já processado">
            ⬇ Baixar novamente (.mp3)
          </button>
          <button type="button" class="btn btn-danger-soft btn-view-log hidden" title="Ver detalhes e logs do erro">
            📋 Ver log de erro
          </button>
        </div>
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
  const elExtraContainer = cardElement.querySelector('.extra-metadata-container');
  const elProgressBarWrapper = cardElement.querySelector('.progress-bar-wrapper');
  const elProgressBarFill = cardElement.querySelector('.progress-bar-fill');
  const elProcessMsg = cardElement.querySelector('.process-msg');
  const elBtnDownloadTrack = cardElement.querySelector('.btn-download-track');
  const elBtnDownloadSingle = cardElement.querySelector('.btn-download-single');
  const elBtnViewLog = cardElement.querySelector('.btn-view-log');

  // Update Status helper
  function setStatus(status, text) {
    state.status = status;
    state.statusText = text;
    elStatus.setAttribute('data-status', status);
    elStatus.textContent = text;
    onStateChange();
  }

  // ========================================================
  // Smart Autocomplete Dropdown Search (Google Style)
  // ========================================================
  function attachSearchAutocomplete(groupEl, inputEl, fieldKey) {
    if (!groupEl || !inputEl) return;
    const btnSearch = groupEl.querySelector('.btn-field-search');
    if (!btnSearch) return;

    let dropdown = groupEl.querySelector('.search-suggestions-dropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'search-suggestions-dropdown hidden';
      groupEl.appendChild(dropdown);
    }

    const closeDropdown = () => {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    };

    btnSearch.addEventListener('click', async (e) => {
      e.stopPropagation();

      if (!dropdown.classList.contains('hidden')) {
        closeDropdown();
        return;
      }

      // Close all other open dropdowns across the application
      document.querySelectorAll('.search-suggestions-dropdown').forEach(d => {
        d.classList.add('hidden');
        d.innerHTML = '';
      });

      const currentTitle = state.title.trim();
      const currentArtist = state.artist.trim();

      if (!currentTitle && !currentArtist && fieldKey !== 'bpm') {
        showToast('Preencha o Título da Música ou Artista primeiro para buscar sugestões na web.', 'warning', 4000);
        return;
      }

      const icon = btnSearch.querySelector('.search-icon');
      const spinner = btnSearch.querySelector('.search-spinner');
      if (icon) icon.classList.add('hidden');
      if (spinner) spinner.classList.remove('hidden');

      dropdown.innerHTML = `
        <div class="suggestions-loading">
          <span class="spinner-small"></span>
          <span>Buscando opções na web...</span>
        </div>
      `;
      dropdown.classList.remove('hidden');

      try {
        const suggestions = await getSuggestionsForField(fieldKey, {
          title: currentTitle,
          artist: currentArtist,
          audioBuffer: ws ? ws.getDecodedData() : null
        });

        if (state.isDestroyed) return;

        if (!suggestions || suggestions.length === 0) {
          dropdown.innerHTML = `
            <div class="suggestions-empty">
              <span>Nenhuma sugestão encontrada na web para este campo.</span>
              <button type="button" class="btn-tiny-close">Fechar</button>
            </div>
          `;
          dropdown.querySelector('.btn-tiny-close')?.addEventListener('click', closeDropdown);
          return;
        }

        dropdown.innerHTML = `
          <div class="suggestions-header">
            <span class="suggestions-title">Sugestões da web (${suggestions.length})</span>
            <button type="button" class="btn-close-dropdown" title="Fechar">&times;</button>
          </div>
          <div class="suggestions-list">
            ${suggestions.map((s, sIdx) => `
              <div class="suggestion-item" data-index="${sIdx}">
                ${s.image ? `<img class="suggestion-thumb" src="${escapeHtml(s.image)}" alt="Capa" />` : '<div class="suggestion-bullet">🎵</div>'}
                <div class="suggestion-text">
                  <div class="suggestion-main">${escapeHtml(s.label || s.value)}</div>
                  ${s.subtext ? `<div class="suggestion-sub">${escapeHtml(s.subtext)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `;

        dropdown.querySelector('.btn-close-dropdown')?.addEventListener('click', closeDropdown);

        dropdown.querySelectorAll('.suggestion-item').forEach(itemEl => {
          itemEl.addEventListener('click', () => {
            const idx = parseInt(itemEl.getAttribute('data-index'), 10);
            const chosen = suggestions[idx];
            if (!chosen) return;

            inputEl.value = chosen.value;
            state[fieldKey] = chosen.value;

            // Smart auto-fill for companion fields if available
            if (chosen.extraData) {
              if (chosen.extraData.year && !state.year) {
                state.year = chosen.extraData.year;
                elInputYear.value = chosen.extraData.year;
              }
              if (chosen.extraData.genre && !state.genre) {
                state.genre = chosen.extraData.genre;
                const genreInput = elExtraContainer?.querySelector('.input-genre');
                if (genreInput) genreInput.value = chosen.extraData.genre;
              }
            }

            if (state.status === 'clean') setStatus('modified', 'Metadados alterados');
            closeDropdown();
            showToast(`Opção "${chosen.label || chosen.value}" selecionada!`, 'success', 2500);
          });
        });

      } catch (err) {
        console.warn(`[searchSuggestions] Erro ao buscar sugestões para ${fieldKey}:`, err);
        dropdown.innerHTML = `
          <div class="suggestions-empty">
            <span>Erro na busca de sugestões.</span>
            <button type="button" class="btn-tiny-close">Fechar</button>
          </div>
        `;
        dropdown.querySelector('.btn-tiny-close')?.addEventListener('click', closeDropdown);
      } finally {
        if (icon) icon.classList.remove('hidden');
        if (spinner) spinner.classList.add('hidden');
      }
    });
  }

  // Attach search dropdowns to Base Album and Year fields
  const groupAlbum = cardElement.querySelector('.input-search-group[data-field="album"]');
  const groupYear = cardElement.querySelector('.input-search-group[data-field="year"]');
  if (groupAlbum && elInputAlbum) attachSearchAutocomplete(groupAlbum, elInputAlbum, 'album');
  if (groupYear && elInputYear) attachSearchAutocomplete(groupYear, elInputYear, 'year');

  // ========================================================
  // Dynamic Extra Metadata Fields Grid
  // ========================================================
  function renderExtraFields() {
    if (!elExtraContainer) return;
    const enabledKeys = getEnabledFieldKeys();
    elExtraContainer.innerHTML = '';

    const fieldsToRender = ALL_METADATA_FIELDS.filter(f => enabledKeys.has(f.key));
    if (fieldsToRender.length === 0) return;

    let currentRow = null;
    let rowCount = 0;

    fieldsToRender.forEach((f) => {
      if (f.isTextarea) {
        const row = document.createElement('div');
        row.className = 'form-row';
        row.innerHTML = `
          <div class="form-group flex-full">
            <label>${escapeHtml(f.label)} <span class="tag-id3">ID3: ${f.id3Tag}</span></label>
            <div class="input-search-group" data-field="${f.key}">
              <textarea class="input-meta input-${f.key}" rows="3" placeholder="${escapeHtml(f.placeholder)}">${escapeHtml(state[f.key] || '')}</textarea>
              <button type="button" class="btn-field-search" title="Buscar opções de ${escapeHtml(f.label)} na web">
                <span class="search-icon">🔍</span>
                <span class="search-spinner hidden">⏳</span>
              </button>
            </div>
          </div>
        `;
        elExtraContainer.appendChild(row);
        const ta = row.querySelector('textarea');
        ta.addEventListener('input', () => {
          state[f.key] = ta.value.trim();
          if (state.status === 'clean') setStatus('modified', 'Metadados alterados');
        });
        attachSearchAutocomplete(row.querySelector('.input-search-group'), ta, f.key);
        currentRow = null;
        rowCount = 0;
      } else {
        if (!currentRow || rowCount >= 2) {
          currentRow = document.createElement('div');
          currentRow.className = 'form-row';
          elExtraContainer.appendChild(currentRow);
          rowCount = 0;
        }

        const col = document.createElement('div');
        col.className = 'form-group flex-2';
        col.innerHTML = `
          <label>${escapeHtml(f.label)} <span class="tag-id3">ID3: ${f.id3Tag}</span></label>
          <div class="input-search-group" data-field="${f.key}">
            <input type="text" class="input-meta input-${f.key}" placeholder="${escapeHtml(f.placeholder)}" value="${escapeHtml(state[f.key] || '')}" />
            <button type="button" class="btn-field-search" title="Buscar opções de ${escapeHtml(f.label)} na web">
              <span class="search-icon">🔍</span>
              <span class="search-spinner hidden">⏳</span>
            </button>
          </div>
        `;
        currentRow.appendChild(col);
        rowCount++;

        const inp = col.querySelector('input');
        inp.addEventListener('input', () => {
          state[f.key] = inp.value.trim();
          if (state.status === 'clean') setStatus('modified', 'Metadados alterados');
        });
        attachSearchAutocomplete(col.querySelector('.input-search-group'), inp, f.key);
      }
    });
  }

  // Subscribe to global metadata config changes
  const unsubscribeFieldChanges = subscribeToFieldChanges(() => {
    if (!state.isDestroyed) {
      renderExtraFields();
    }
  });

  // Initial render of extra fields
  renderExtraFields();

  // Close dropdowns on outside click
  const onDocumentClick = (e) => {
    if (!cardElement.contains(e.target)) {
      cardElement.querySelectorAll('.search-suggestions-dropdown').forEach(d => {
        d.classList.add('hidden');
        d.innerHTML = '';
      });
    }
  };
  document.addEventListener('click', onDocumentClick);

  // Update Cut Regions on WaveSurfer
  let wsRegions = null;

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

    wsRegions.clearRegions();

    // Visual region for discarded start (1px border, no distracting text)
    if (hasStartCut) {
      const regStart = wsRegions.addRegion({
        start: 0,
        end: state.cutStart,
        color: 'rgba(239, 68, 68, 0.35)',
        drag: false,
        resize: false
      });
      if (regStart && regStart.element) {
        regStart.element.style.borderRight = '1px solid #ef4444';
      }
    }

    // Visual region for kept audio
    wsRegions.addRegion({
      start: state.cutStart,
      end: state.cutEnd,
      color: 'rgba(16, 185, 129, 0.18)',
      drag: false,
      resize: false
    });

    // Visual region for discarded end (1px border, no distracting text)
    if (hasEndCut) {
      const regEnd = wsRegions.addRegion({
        start: state.cutEnd,
        end: state.duration,
        color: 'rgba(239, 68, 68, 0.35)',
        drag: false,
        resize: false
      });
      if (regEnd && regEnd.element) {
        regEnd.element.style.borderLeft = '1px solid #ef4444';
      }
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

  // Initialize WaveSurfer with sleek hairline playhead
  const ws = WaveSurfer.create({
    container: elWaveformContainer,
    waveColor: '#6366f1',
    progressColor: '#a855f7',
    cursorColor: '#38bdf8',
    cursorWidth: 1,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    height: 90,
    url: audioUrl
  });

  wsRegions = ws.registerPlugin(RegionsPlugin.create());

  /**
   * Synchronizes the real, accurate PCM decoded duration across the card state and UI.
   * Prevents premature endings caused by inaccurate VBR/MP3 container headers.
   * @param {number} realDuration
   */
  function syncAccurateDuration(realDuration) {
    if (!realDuration || !isFinite(realDuration) || realDuration <= 0) return;
    
    const prevDuration = state.duration;
    state.duration = realDuration;
    
    if (state.cutEnd <= 0 || state.cutEnd >= (prevDuration - 0.05)) {
      state.cutEnd = realDuration;
    } else {
      state.cutEnd = Math.min(state.cutEnd, realDuration);
    }
    
    state.cutStart = Math.min(state.cutStart, Math.max(0, realDuration - 0.05));
    
    elTotalDuration.textContent = formatTime(state.duration);
    updateCutDisplay();
  }

  // 1. Detect true duration directly via PCM decode in parallel
  detectTrueAudioDuration(file).then((trueDuration) => {
    if (trueDuration && !state.isDestroyed) {
      syncAccurateDuration(trueDuration);
    }
  });

  // 2. Also hook into WaveSurfer decode event for exact decoded PCM duration
  ws.on('decode', (decodedDuration) => {
    if (decodedDuration > 0 && isFinite(decodedDuration) && !state.isDestroyed) {
      syncAccurateDuration(decodedDuration);
    }
  });

  // WaveSurfer ready event
  ws.on('ready', () => {
    if (state.isDestroyed) return;
    elWaveformLoading.classList.add('hidden');
    
    const decoded = ws.getDecodedData();
    const accurateDuration = (decoded && decoded.duration > 0) ? decoded.duration : ws.getDuration();
    syncAccurateDuration(accurateDuration);

    elBtnPlay.disabled = false;
    elBtnPreviewTrim.disabled = false;
    elBtnStepBack.disabled = false;
    elBtnStepForward.disabled = false;
    elBtnCutStart.disabled = false;
    elBtnCutEnd.disabled = false;

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

  // Metadata Input Listeners
  function onMetaInput() {
    state.title = elInputTitle.value.trim() || state.originalName.replace(/\.[^/.]+$/, '');
    state.artist = elInputArtist.value.trim();
    state.album = elInputAlbum.value.trim();
    state.year = elInputYear.value.trim();
    if (state.status === 'clean') setStatus('modified', 'Metadados alterados');
  }

  elInputTitle.addEventListener('input', onMetaInput);
  elInputArtist.addEventListener('input', onMetaInput);
  elInputAlbum.addEventListener('input', onMetaInput);
  elInputYear.addEventListener('input', onMetaInput);

  // Download single already-processed track handler
  elBtnDownloadTrack.addEventListener('click', () => {
    if (state.processedBlob && state.processedFilename) {
      downloadSingleFile(state.processedBlob, state.processedFilename);
      showToast(`Baixando "${state.processedFilename}"...`, 'success');
    }
  });

  // Individual download: process + download a single track independently
  elBtnDownloadSingle.addEventListener('click', async () => {
    if (state.isProcessingSingle) return;
    state.isProcessingSingle = true;
    elBtnDownloadSingle.disabled = true;
    elBtnDownloadSingle.textContent = '⏳ Processando...';
    elProgressBarWrapper.classList.remove('hidden');
    elProgressBarFill.style.width = '0%';
    elProcessMsg.textContent = 'Iniciando processamento individual...';
    elBtnDownloadTrack.classList.add('hidden');
    elBtnViewLog.classList.add('hidden');

    const timeoutSec = getCurrentTimeoutSeconds();

    try {
      // Warm up FFmpeg
      elProcessMsg.textContent = 'Carregando motor FFmpeg...';
      await getFFmpeg((status) => {
        elProcessMsg.textContent = status;
      });

      elProcessMsg.textContent = `Processando "${state.title}"...`;

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
          elProgressBarFill.style.width = `${Math.round(ratio * 100)}%`;
          elProcessMsg.textContent = `Convertendo áudio... ${Math.round(ratio * 100)}%`;
        }
      });

      state.processedBlob = result.blob;
      state.processedFilename = result.filename;
      setStatus('ready', 'Pronto ✓');
      elProgressBarWrapper.classList.add('hidden');
      elProcessMsg.textContent = `Salvo como: ${result.filename}`;
      elBtnDownloadTrack.classList.remove('hidden');

      // Trigger direct download
      downloadSingleFile(result.blob, result.filename);
      showToast(`"${state.title}" baixado com sucesso!`, 'success');

    } catch (err) {
      console.error(`Erro ao processar faixa individual:`, err);
      const timestamp = new Date().toLocaleString('pt-BR');
      const cutInfo = (state.cutStart > 0 || state.cutEnd < state.duration)
        ? `${formatTime(state.cutStart)} → ${formatTime(state.cutEnd)}`
        : 'Faixa completa';

      const errMsg = (err && typeof err === 'object') ? (err.message || 'Erro desconhecido') : String(err);
      const isTimeout = Boolean(err && err.isTimeout);
      const errStack = (err && typeof err === 'object') ? (err.stack || '') : '';
      const errLogs = (err && typeof err === 'object' && Array.isArray(err.ffmpegLogs)) ? err.ffmpegLogs : [];

      state.errorLog.push({
        timestamp,
        message: errMsg,
        isTimeout,
        stack: errStack,
        context: `Arquivo: ${state.originalName} | Título: ${state.title} | Corte: ${cutInfo} | Limite Timeout: ${timeoutSec}s`,
        ffmpegLogs: errLogs
      });

      setStatus('error', 'Erro');
      elProgressBarWrapper.classList.add('hidden');
      elProcessMsg.textContent = `Erro: ${errMsg}`;
      elBtnViewLog.classList.remove('hidden');
      showToast(`Erro ao processar "${state.title}". Clique em "Ver log" para detalhes.`, 'error', 5000);

    } finally {
      state.isProcessingSingle = false;
      elBtnDownloadSingle.disabled = false;
      elBtnDownloadSingle.textContent = '⬇ Baixar esta música (.mp3)';
    }
  });

  // Error log modal viewer
  elBtnViewLog.addEventListener('click', () => {
    showErrorLogModal(state);
  });

  // Remove Card handler
  elBtnRemove.addEventListener('click', () => {
    destroy();
    onRemove(index);
  });

  // Read Audio Metadata from File
  try {
    const meta = await readAudioMetadata(file);
    if (state.isDestroyed) return;

    if (meta.title) {
      state.title = meta.title;
      elInputTitle.value = meta.title;
    } else {
      elInputTitle.value = state.title;
    }

    if (meta.artist) {
      state.artist = meta.artist;
      elInputArtist.value = meta.artist;
    }

    if (meta.album) {
      state.album = meta.album;
      elInputAlbum.value = meta.album;
    }

    if (meta.year) {
      state.year = String(meta.year);
      elInputYear.value = String(meta.year);
    }

    if (meta.genre) state.genre = meta.genre;
    if (meta.bpm) state.bpm = meta.bpm;
    if (meta.subtitle) state.subtitle = meta.subtitle;
    if (meta.rating) state.rating = meta.rating;
    if (meta.composer) state.composer = meta.composer;
    if (meta.trackNumber) state.trackNumber = meta.trackNumber;
    if (meta.discNumber) state.discNumber = meta.discNumber;
    if (meta.albumArtist) state.albumArtist = meta.albumArtist;
    if (meta.copyright) state.copyright = meta.copyright;
    if (meta.lyrics) state.lyrics = meta.lyrics;
    if (meta.comment) state.comment = meta.comment;

    renderExtraFields();

    if (meta.coverBlob && meta.coverUrl) {
      state.coverBlob = meta.coverBlob;
      state.coverUrl = meta.coverUrl;
      updateCoverUI(state.coverBlob, state.coverUrl);
    }
  } catch (err) {
    console.warn(`[trackCard] Falha ao extrair metadados para "${file.name}":`, err);
  }

  // Cleanup helper
  function destroy() {
    state.isDestroyed = true;
    unsubscribeFieldChanges();
    document.removeEventListener('click', onDocumentClick);
    try {
      ws.destroy();
    } catch (_) {}
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (state.coverUrl) URL.revokeObjectURL(state.coverUrl);
    cardElement.remove();
  }

  return {
    element: cardElement,
    state,
    destroy,
    setProcessingState: (isProcessing, progress = 0, msg = '') => {
      if (isProcessing) {
        setStatus('processing', 'Processando...');
        elProgressBarWrapper.classList.remove('hidden');
        elProgressBarFill.style.width = `${Math.round(progress * 100)}%`;
        if (msg) elProcessMsg.textContent = msg;
        elBtnDownloadSingle.disabled = true;
      } else {
        elProgressBarWrapper.classList.add('hidden');
        elBtnDownloadSingle.disabled = false;
      }
    },
    setReadyState: (blob, filename) => {
      state.processedBlob = blob;
      state.processedFilename = filename;
      setStatus('ready', 'Pronto ✓');
      elProgressBarWrapper.classList.add('hidden');
      elProcessMsg.textContent = `Salvo como: ${filename}`;
      elBtnDownloadTrack.classList.remove('hidden');
      elBtnDownloadSingle.disabled = false;
    },
    setErrorState: (errMsg, extraErrorData = {}) => {
      setStatus('error', 'Erro');
      elProgressBarWrapper.classList.add('hidden');
      elProcessMsg.textContent = `Erro: ${errMsg}`;
      elBtnDownloadSingle.disabled = false;
      
      const timestamp = new Date().toLocaleString('pt-BR');
      const cutInfo = (state.cutStart > 0 || state.cutEnd < state.duration)
        ? `${formatTime(state.cutStart)} → ${formatTime(state.cutEnd)}`
        : 'Faixa completa';

      state.errorLog.push({
        timestamp,
        message: errMsg || 'Erro desconhecido',
        isTimeout: Boolean(extraErrorData.isTimeout),
        stack: extraErrorData.stack || '',
        context: `Arquivo: ${state.originalName} | Título: ${state.title} | Corte: ${cutInfo}`,
        ffmpegLogs: extraErrorData.ffmpegLogs || []
      });
      elBtnViewLog.classList.remove('hidden');
    }
  };
}

/**
 * Opens a modal overlay showing the comprehensive error log for a track.
 * @param {Object} state - Track state with errorLog array
 */
function showErrorLogModal(state) {
  // Remove existing modal if any
  const existing = document.getElementById('error-log-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'error-log-modal';
  overlay.className = 'error-log-overlay';

  const logEntries = state.errorLog.length > 0
    ? state.errorLog.map((entry, i) => {
        const ffmpegOutput = entry.ffmpegLogs && entry.ffmpegLogs.length > 0
          ? `\n\n📺 Últimos Logs do FFmpeg.wasm (${entry.ffmpegLogs.length} linhas):\n${entry.ffmpegLogs.slice(-40).join('\n')}`
          : '';

        return `━━━ Ocorrência #${i + 1} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕐 Data/Hora: ${entry.timestamp}
📄 Contexto:  ${entry.context}
❌ Mensagem:  ${entry.message}
${entry.isTimeout ? '⏱️ Causa: Tempo limite de processamento atingido.' : ''}
${entry.stack ? `\n📋 Stack Trace:\n${entry.stack}` : ''}${ffmpegOutput}`;
      }).join('\n\n' + '─'.repeat(52) + '\n\n')
    : 'Nenhum erro registrado nesta faixa.';

  const fullLog = `════════════════════════════════════════════════
  RELATÓRIO DE ERRO & DIAGNÓSTICO — vox acies
════════════════════════════════════════════════
Música:           ${state.title || state.originalName}
Arquivo original: ${state.originalName}
Duração total:    ${formatTime(state.duration)}
Status atual:     ${state.statusText} (${state.status})
Total de falhas:  ${state.errorLog.length}

${logEntries}
`;

  overlay.innerHTML = `
    <div class="error-log-modal-content">
      <div class="error-log-header">
        <div class="error-log-title-group">
          <h3>📋 Relatório de Erro</h3>
          <span class="error-log-subtitle">${state.title || state.originalName}</span>
        </div>
        <div class="error-log-header-actions">
          <button type="button" class="btn btn-secondary btn-copy-log" title="Copiar log completo para a área de transferência">
            📋 Copiar log
          </button>
          <button type="button" class="btn btn-icon btn-close-log" title="Fechar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
      <pre class="error-log-body">${fullLog.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      <div class="error-log-footer">
        <span class="error-log-count">${state.errorLog.length} ocorrência(s) registrada(s)</span>
        <button type="button" class="btn btn-secondary btn-close-log-footer">Fechar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const closeModal = () => {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('.btn-close-log').addEventListener('click', closeModal);
  overlay.querySelector('.btn-close-log-footer').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', onEsc);
    }
  });

  // Copy to clipboard
  overlay.querySelector('.btn-copy-log').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fullLog);
      const btn = overlay.querySelector('.btn-copy-log');
      btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = '📋 Copiar log'; }, 2000);
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  });

  // Animate in
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
  });
}
