import * as mm from 'music-metadata-browser';

/**
 * Extracts metadata and cover picture from an audio file.
 * @param {File} file - Audio file uploaded by the user
 * @returns {Promise<{title: string, artist: string, album: string, year: string, coverBlob: Blob|null, coverUrl: string|null, coverMime: string|null}>}
 */
export async function readAudioMetadata(file) {
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const defaultResult = {
    title: baseName,
    artist: '',
    album: '',
    year: '',
    coverBlob: null,
    coverUrl: null,
    coverMime: null
  };

  try {
    const metadata = await mm.parseBlob(file);
    const common = metadata?.common || {};

    let coverBlob = null;
    let coverUrl = null;
    let coverMime = null;

    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      coverMime = pic.format || 'image/jpeg';
      coverBlob = new Blob([pic.data], { type: coverMime });
      coverUrl = URL.createObjectURL(coverBlob);
    }

    return {
      title: (common.title && common.title.trim()) || baseName,
      artist: (common.artist && common.artist.trim()) || '',
      album: (common.album && common.album.trim()) || '',
      year: common.year ? String(common.year) : '',
      coverBlob,
      coverUrl,
      coverMime
    };
  } catch (err) {
    console.warn(`[metadataReader] Não foi possível ler metadados de "${file.name}":`, err);
    return defaultResult;
  }
}
