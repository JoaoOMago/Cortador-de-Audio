import JSZip from 'jszip';

/**
 * Downloads a single file blob directly in the browser.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadSingleFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2000);
}

/**
 * Bundles multiple audio files into a single .zip file and triggers the download.
 * @param {Array<{filename: string, blob: Blob}>} files - List of processed files
 * @param {string} [zipName='musicas_editadas.zip'] - Name of the output zip file
 * @param {Function} [onZipProgress] - Progress callback (percent: 0-100)
 * @returns {Promise<Blob>}
 */
export async function exportToZip(files, zipName = 'musicas_editadas.zip', onZipProgress = () => {}) {
  if (!files || files.length === 0) {
    throw new Error('Nenhum arquivo para empacotar no ZIP.');
  }

  const zip = new JSZip();
  const usedNames = new Set();

  for (const item of files) {
    let finalName = item.filename;
    let counter = 1;

    // Handle duplicate filenames gracefully
    while (usedNames.has(finalName.toLowerCase())) {
      const extMatch = item.filename.match(/\.([0-9a-z]+)$/i);
      const ext = extMatch ? `.${extMatch[1]}` : '';
      const base = item.filename.replace(/\.[^/.]+$/, '');
      finalName = `${base} (${counter})${ext}`;
      counter++;
    }

    usedNames.add(finalName.toLowerCase());
    zip.file(finalName, item.blob);
  }

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    },
    (metadata) => {
      onZipProgress(metadata.percent);
    }
  );

  downloadSingleFile(zipBlob, zipName);
  return zipBlob;
}
