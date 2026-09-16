import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  globalThis.Buffer = Buffer;
}

import * as mm from 'music-metadata-browser';
import jsmediatags from 'jsmediatags';

/**
 * Extracts metadata and cover picture from an audio file using multi-tier fallback.
 * @param {File} file - Audio file uploaded by the user
 * @returns {Promise<{title: string, artist: string, album: string, year: string, coverBlob: Blob|null, coverUrl: string|null, coverMime: string|null}>}
 */
export async function readAudioMetadata(file) {
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const result = {
    title: baseName,
    artist: '',
    album: '',
    year: '',
    coverBlob: null,
    coverUrl: null,
    coverMime: null
  };

  // Try parsing with music-metadata parseBuffer
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const metadata = await mm.parseBuffer(uint8Array, { mimeType: file.type || 'audio/mpeg' });
    const common = metadata?.common || {};

    if (common.title && common.title.trim()) result.title = common.title.trim();
    if (common.artist && common.artist.trim()) result.artist = common.artist.trim();
    if (common.album && common.album.trim()) result.album = common.album.trim();
    if (common.year) result.year = String(common.year);

    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      result.coverMime = pic.format || 'image/jpeg';
      result.coverBlob = new Blob([pic.data], { type: result.coverMime });
      result.coverUrl = URL.createObjectURL(result.coverBlob);
      return result;
    }
  } catch (err) {
    console.warn(`[metadataReader] parseBuffer falhou para "${file.name}":`, err);
  }

  // Fallback with jsmediatags
  try {
    const tags = await new Promise((resolve, reject) => {
      jsmediatags.read(file, {
        onSuccess: (tag) => resolve(tag.tags),
        onError: (error) => reject(error)
      });
    });

    if (tags) {
      if (!result.artist && tags.artist) result.artist = tags.artist.trim();
      if (!result.album && tags.album) result.album = tags.album.trim();
      if (!result.year && tags.year) result.year = String(tags.year);
      if (result.title === baseName && tags.title) result.title = tags.title.trim();

      if (tags.picture) {
        const { data, format } = tags.picture;
        const byteArray = new Uint8Array(data);
        result.coverMime = format || 'image/jpeg';
        result.coverBlob = new Blob([byteArray], { type: result.coverMime });
        result.coverUrl = URL.createObjectURL(result.coverBlob);
        return result;
      }
    }
  } catch (err) {
    console.warn(`[metadataReader] jsmediatags fallback falhou para "${file.name}":`, err);
  }

  return result;
}
