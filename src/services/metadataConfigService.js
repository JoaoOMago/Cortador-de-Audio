/**
 * Service for managing active metadata fields configuration across all tracks.
 */

const STORAGE_KEY = 'vox_acies_metadata_fields';

export const ALL_METADATA_FIELDS = [
  { key: 'genre', label: 'Gênero Musical', placeholder: 'Ex: Synth-pop, Rock, Eurobeat', id3Tag: 'TCON', category: 'musical' },
  { key: 'bpm', label: 'BPM / Andamento', placeholder: 'Ex: 128', id3Tag: 'TBPM', category: 'musical' },
  { key: 'subtitle', label: 'Legenda / Subtítulo', placeholder: 'Ex: Extended Mix, Remaster 2024', id3Tag: 'TIT3', category: 'info' },
  { key: 'rating', label: 'Classificação / Rating', placeholder: 'Ex: Clean, Explicit, +16', id3Tag: 'POPM', category: 'info' },
  { key: 'composer', label: 'Compositor', placeholder: 'Ex: Nome do compositor', id3Tag: 'TCOM', category: 'credits' },
  { key: 'trackNumber', label: 'Número da Faixa', placeholder: 'Ex: 1 ou 1/12', id3Tag: 'TRCK', category: 'structure' },
  { key: 'discNumber', label: 'Número do Disco', placeholder: 'Ex: 1 ou 1/2', id3Tag: 'TPOS', category: 'structure' },
  { key: 'albumArtist', label: 'Artista do Álbum', placeholder: 'Ex: Vários Artistas / Nome', id3Tag: 'TPE2', category: 'credits' },
  { key: 'copyright', label: 'Copyright / Gravadora', placeholder: 'Ex: © 2024 Gravadora', id3Tag: 'TCOP', category: 'credits' },
  { key: 'lyrics', label: 'Letra da Música', placeholder: 'Letra completa da música...', id3Tag: 'USLT', isTextarea: true, category: 'extra' },
  { key: 'comment', label: 'Comentário / Notas', placeholder: 'Observações, créditos ou notas adicionais...', id3Tag: 'COMM', isTextarea: true, category: 'extra' }
];

const DEFAULT_ENABLED_KEYS = ['genre', 'bpm'];

let subscribers = [];

/**
 * Loads enabled field keys from localStorage or returns default.
 * @returns {Set<string>}
 */
export function getEnabledFieldKeys() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch (e) {
    console.warn('[metadataConfigService] Could not read localStorage:', e);
  }
  return new Set(DEFAULT_ENABLED_KEYS);
}

/**
 * Saves enabled field keys to localStorage and notifies all subscribers.
 * @param {Set<string>|Array<string>} keys 
 */
export function saveEnabledFieldKeys(keys) {
  const arr = Array.from(keys);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('[metadataConfigService] Could not write to localStorage:', e);
  }
  notifySubscribers(new Set(arr));
}

/**
 * Checks if a specific field is enabled.
 * @param {string} fieldKey 
 * @returns {boolean}
 */
export function isFieldEnabled(fieldKey) {
  const enabled = getEnabledFieldKeys();
  return enabled.has(fieldKey);
}

/**
 * Subscribes a callback to receive updates when enabled fields change.
 * @param {Function} callback 
 * @returns {Function} Unsubscribe function
 */
export function subscribeToFieldChanges(callback) {
  subscribers.push(callback);
  return () => {
    subscribers = subscribers.filter(cb => cb !== callback);
  };
}

function notifySubscribers(enabledKeys) {
  for (const cb of subscribers) {
    try {
      cb(enabledKeys);
    } catch (err) {
      console.error('[metadataConfigService] Subscriber error:', err);
    }
  }
}
