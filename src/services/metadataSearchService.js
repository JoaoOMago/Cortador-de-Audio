/**
 * Service for searching music metadata on public APIs (iTunes, LRCLIB, MusicBrainz)
 * and analyzing audio files in real-time without requiring backend servers or API keys.
 */

/**
 * Searches iTunes Search API for comprehensive track metadata.
 * @param {string} title 
 * @param {string} artist 
 * @returns {Promise<Array<Object>>}
 */
export async function searchITunesTracks(title, artist) {
  const queryParts = [artist, title].filter(Boolean).map(s => s.trim());
  if (queryParts.length === 0) return [];
  
  const searchTerm = encodeURIComponent(queryParts.join(' '));
  const url = `https://itunes.apple.com/search?term=${searchTerm}&entity=song&limit=20`;

  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.warn('[metadataSearchService] iTunes search failed:', err);
    return [];
  }
}

/**
 * Searches LRCLIB for lyrics and additional release information.
 * @param {string} title 
 * @param {string} artist 
 * @returns {Promise<Array<Object>>}
 */
export async function searchLyrics(title, artist) {
  const queryParts = [artist, title].filter(Boolean).map(s => s.trim());
  if (queryParts.length === 0) return [];

  const query = encodeURIComponent(queryParts.join(' '));
  const url = `https://lrclib.net/api/search?q=${query}`;

  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[metadataSearchService] LRCLIB lyrics search failed:', err);
    return [];
  }
}

/**
 * Computes BPM by analyzing energy peaks in decoded audio PCM data (WebAudio).
 * @param {AudioBuffer} audioBuffer 
 * @returns {number|null} Estimated BPM
 */
export function detectAudioBPM(audioBuffer) {
  if (!audioBuffer) return null;
  try {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    
    // Analyze 30-second window in the middle for maximum beat consistency
    const duration = audioBuffer.duration;
    const startSec = Math.max(0, (duration / 2) - 15);
    const startSample = Math.floor(startSec * sampleRate);
    const endSample = Math.min(channelData.length, Math.floor((startSec + 30) * sampleRate));
    
    if (endSample - startSample < sampleRate * 5) return null;

    // Subsample buffer for fast processing
    const step = 4;
    const energy = [];
    for (let i = startSample; i < endSample; i += step) {
      const val = channelData[i];
      energy.push(val * val);
    }

    // Moving average filter
    const windowSize = Math.floor((sampleRate / step) * 0.1); // 100ms
    const peaks = [];
    let localAvg = 0;
    
    for (let i = 0; i < energy.length; i++) {
      localAvg += (energy[i] - (energy[i - windowSize] || 0)) / windowSize;
      if (energy[i] > localAvg * 1.5 && energy[i] > 0.01) {
        peaks.push(i);
      }
    }

    // Compute intervals between consecutive peaks
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      const diffSamples = (peaks[i] - peaks[i - 1]) * step;
      const diffSec = diffSamples / sampleRate;
      if (diffSec >= 0.28 && diffSec <= 1.2) { // 50 to 215 BPM
        const bpm = Math.round(60 / diffSec);
        intervals.push(bpm);
      }
    }

    if (intervals.length === 0) return null;

    // Histogram mode calculation
    const counts = {};
    let maxCount = 0;
    let bestBpm = null;

    for (const bpm of intervals) {
      counts[bpm] = (counts[bpm] || 0) + 1;
      if (counts[bpm] > maxCount) {
        maxCount = counts[bpm];
        bestBpm = bpm;
      }
    }

    return bestBpm;
  } catch (err) {
    console.warn('[metadataSearchService] BPM detection error:', err);
    return null;
  }
}

/**
 * Returns a list of smart, deduplicated suggestions for a specific metadata field.
 *
 * @param {string} fieldKey - e.g. 'album', 'year', 'genre', 'bpm', 'lyrics', 'rating', 'composer', 'subtitle', 'trackNumber', 'discNumber', 'albumArtist'
 * @param {Object} context
 * @param {string} context.title
 * @param {string} context.artist
 * @param {AudioBuffer} [context.audioBuffer]
 * @returns {Promise<Array<{ value: string, label: string, subtext?: string, image?: string, extraData?: any }>>}
 */
export async function getSuggestionsForField(fieldKey, { title, artist, audioBuffer }) {
  const suggestions = [];

  // 1. Fetch iTunes results
  const itunesResults = await searchITunesTracks(title, artist);

  switch (fieldKey) {
    case 'album': {
      const seen = new Set();
      for (const item of itunesResults) {
        const name = (item.collectionName || '').trim();
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : '';
          const artwork = item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '300x300bb') : null;
          suggestions.push({
            value: name,
            label: name,
            subtext: [year, item.artistName, item.primaryGenreName].filter(Boolean).join(' • '),
            image: artwork,
            extraData: {
              year: year ? String(year) : '',
              genre: item.primaryGenreName || '',
              artworkUrl: artwork
            }
          });
        }
      }
      break;
    }

    case 'year': {
      const seen = new Set();
      for (const item of itunesResults) {
        if (item.releaseDate) {
          const dateObj = new Date(item.releaseDate);
          const yearStr = String(dateObj.getFullYear());
          if (yearStr && !seen.has(yearStr)) {
            seen.add(yearStr);
            const dateFull = dateObj.toLocaleDateString('pt-BR');
            suggestions.push({
              value: yearStr,
              label: yearStr,
              subtext: `Lançamento: ${dateFull} (${item.collectionName || 'Single/Álbum'})`
            });
          }
        }
      }
      break;
    }

    case 'genre': {
      const seen = new Set();
      for (const item of itunesResults) {
        const g = (item.primaryGenreName || '').trim();
        if (g && !seen.has(g.toLowerCase())) {
          seen.add(g.toLowerCase());
          suggestions.push({
            value: g,
            label: g,
            subtext: `Gênero catalogado em "${item.collectionName || item.trackName}"`
          });
        }
      }
      // Common genre fallbacks if empty
      const popularGenres = ['Pop', 'Rock', 'Electronic', 'Synthwave', 'Eurobeat', 'Dance', 'Hip-Hop/Rap', 'R&B', 'Indie', 'Jazz', 'Metal', 'Sertanejo', 'MPB', 'Funk', 'Lo-Fi'];
      for (const g of popularGenres) {
        if (!seen.has(g.toLowerCase())) {
          suggestions.push({
            value: g,
            label: g,
            subtext: 'Gênero musical popular'
          });
        }
      }
      break;
    }

    case 'bpm': {
      // Direct WebAudio PCM analysis
      if (audioBuffer) {
        const detectedBpm = detectAudioBPM(audioBuffer);
        if (detectedBpm) {
          suggestions.push({
            value: String(detectedBpm),
            label: `${detectedBpm} BPM`,
            subtext: '⚡ Calculado com precisão diretamente do áudio (WebAudio PCM)'
          });
          // Half-time and double-time options
          suggestions.push({
            value: String(Math.round(detectedBpm / 2)),
            label: `${Math.round(detectedBpm / 2)} BPM (Meio tempo / Half-time)`,
            subtext: 'Variação rítmica em metade da velocidade'
          });
          suggestions.push({
            value: String(Math.round(detectedBpm * 2)),
            label: `${Math.round(detectedBpm * 2)} BPM (Tempo duplo / Double-time)`,
            subtext: 'Variação rítmica em dobro da velocidade'
          });
        }
      }
      // Standard tempo presets
      const tempoPresets = [
        { value: '128', label: '128 BPM', subtext: 'Padrão House / Dance / EDM' },
        { value: '120', label: '120 BPM', subtext: 'Padrão Pop / Disco moderado' },
        { value: '140', label: '140 BPM', subtext: 'Padrão Trance / Techno / Dubstep' },
        { value: '160', label: '160 BPM', subtext: 'Padrão Eurobeat / Drum & Bass' },
        { value: '95', label: '95 BPM', subtext: 'Padrão Hip-Hop / R&B' }
      ];
      for (const p of tempoPresets) {
        if (!suggestions.some(s => s.value === p.value)) {
          suggestions.push(p);
        }
      }
      break;
    }

    case 'lyrics': {
      const lyricsResults = await searchLyrics(title, artist);
      for (const item of lyricsResults) {
        const lyricsText = item.plainLyrics || (item.syncedLyrics ? item.syncedLyrics.replace(/\[\d+:\d+\.\d+\]\s*/g, '') : '');
        if (lyricsText) {
          const preview = lyricsText.slice(0, 140).replace(/\n+/g, ' ') + '...';
          suggestions.push({
            value: lyricsText.trim(),
            label: `${item.trackName} - ${item.artistName}`,
            subtext: `"${preview}" (LRCLIB)`
          });
        }
      }
      break;
    }

    case 'rating': {
      suggestions.push(
        { value: 'Clean', label: 'Livre / Clean (Sem conteúdo explícito)', subtext: 'Recomendado para todas as idades' },
        { value: 'Explicit', label: 'Explícito / Explicit (Parental Advisory)', subtext: 'Contém linguagem adulta ou temas fortes' },
        { value: '+12', label: 'Classificação 12 Anos', subtext: 'Não recomendado para menores de 12 anos' },
        { value: '+16', label: 'Classificação 16 Anos', subtext: 'Não recomendado para menores de 16 anos' },
        { value: '+18', label: 'Classificação 18 Anos (Adulto)', subtext: 'Restrito para maiores de 18 anos' }
      );
      break;
    }

    case 'subtitle': {
      const seen = new Set();
      const defaultVersions = ['Original Mix', 'Radio Edit', 'Extended Mix', 'Remix', 'Instrumental', 'Acoustic', 'Live', 'Remastered', 'Club Mix'];
      for (const item of itunesResults) {
        const match = (item.trackName || '').match(/\(([^)]+)\)|\[([^\]]+)\]/);
        if (match) {
          const sub = (match[1] || match[2]).trim();
          if (sub && !seen.has(sub.toLowerCase())) {
            seen.add(sub.toLowerCase());
            suggestions.push({
              value: sub,
              label: sub,
              subtext: `Encontrado no catálogo da música ("${item.trackName}")`
            });
          }
        }
      }
      for (const v of defaultVersions) {
        if (!seen.has(v.toLowerCase())) {
          suggestions.push({
            value: v,
            label: v,
            subtext: 'Versão/Mix padrão da indústria'
          });
        }
      }
      break;
    }

    case 'composer': {
      const seen = new Set();
      for (const item of itunesResults) {
        const c = (item.artistName || '').trim();
        if (c && !seen.has(c.toLowerCase())) {
          seen.add(c.toLowerCase());
          suggestions.push({
            value: c,
            label: c,
            subtext: `Artista principal / Compositor associado`
          });
        }
      }
      break;
    }

    case 'trackNumber': {
      const seen = new Set();
      for (const item of itunesResults) {
        if (item.trackNumber) {
          const trackVal = item.trackCount ? `${item.trackNumber}/${item.trackCount}` : String(item.trackNumber);
          if (!seen.has(trackVal)) {
            seen.add(trackVal);
            suggestions.push({
              value: trackVal,
              label: `Faixa ${trackVal}`,
              subtext: `Álbum: ${item.collectionName || 'Não especificado'}`
            });
          }
        }
      }
      break;
    }

    case 'discNumber': {
      const seen = new Set();
      for (const item of itunesResults) {
        if (item.discNumber) {
          const discVal = item.discCount ? `${item.discNumber}/${item.discCount}` : String(item.discNumber);
          if (!seen.has(discVal)) {
            seen.add(discVal);
            suggestions.push({
              value: discVal,
              label: `Disco ${discVal}`,
              subtext: `Álbum: ${item.collectionName || 'Não especificado'}`
            });
          }
        }
      }
      break;
    }

    case 'albumArtist': {
      const seen = new Set();
      for (const item of itunesResults) {
        const a = (item.artistName || '').trim();
        if (a && !seen.has(a.toLowerCase())) {
          seen.add(a.toLowerCase());
          suggestions.push({
            value: a,
            label: a,
            subtext: `Artista do álbum "${item.collectionName || ''}"`
          });
        }
      }
      break;
    }

    case 'copyright': {
      const seen = new Set();
      for (const item of itunesResults) {
        if (item.artistName && item.releaseDate) {
          const yr = new Date(item.releaseDate).getFullYear();
          const copyStr = `© ${yr} ${item.artistName}`;
          if (!seen.has(copyStr)) {
            seen.add(copyStr);
            suggestions.push({
              value: copyStr,
              label: copyStr,
              subtext: `Informação de direitos autorais padrão`
            });
          }
        }
      }
      break;
    }

    default:
      break;
  }

  return suggestions;
}
