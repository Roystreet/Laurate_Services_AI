'use strict';

const path = require('path');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');
const { ALLOWED_MIME_TYPES, detectMimeType } = require('../utils/fileTypes');

const DOWNLOAD_TIMEOUT_MS = 30000;

// Enlaces de Google Docs/Drive no son descargas directas: se reescriben a su
// URL de exportación. El documento debe estar compartido como
// "Cualquier persona con el enlace".
function resolveGoogleUrl(parsedUrl) {
  const host = parsedUrl.hostname;

  if (host === 'docs.google.com') {
    const match = parsedUrl.pathname.match(/^\/(document|presentation|spreadsheets)\/d\/([\w-]+)/);
    if (!match) return null;
    const [, kind, id] = match;
    if (kind === 'document') {
      return { url: `https://docs.google.com/document/d/${id}/export?format=docx`, filename: `google-doc-${id}.docx` };
    }
    if (kind === 'presentation') {
      return { url: `https://docs.google.com/presentation/d/${id}/export/pdf`, filename: `google-slides-${id}.pdf` };
    }
    return { url: `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`, filename: `google-sheet-${id}.pdf` };
  }

  if (host === 'drive.google.com') {
    const match = parsedUrl.pathname.match(/^\/file\/d\/([\w-]+)/);
    const id = match ? match[1] : parsedUrl.searchParams.get('id');
    if (!id) return null;
    return { url: `https://drive.google.com/uc?export=download&id=${id}`, filename: null };
  }

  return null;
}

function looksLikeHtml(buffer) {
  const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<');
}

// Descarga el documento desde una URL y devuelve un objeto con la misma forma
// que req.file de multer ({ buffer, mimetype, originalname }).
async function download(url, filename) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    throw new ApiError(400, 'INVALID_URL', `La URL proporcionada no es válida: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new ApiError(400, 'INVALID_URL', 'Solo se permiten URLs con protocolo http o https');
  }

  const google = resolveGoogleUrl(parsedUrl);
  if (google) {
    parsedUrl = new URL(google.url);
    if (!filename && google.filename) filename = google.filename;
  }
  if (['www.dropbox.com', 'dropbox.com'].includes(parsedUrl.hostname)) {
    parsedUrl.searchParams.set('dl', '1');
  }

  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  let response;
  try {
    response = await fetch(parsedUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'tiempo de espera agotado' : err.message;
    throw new ApiError(422, 'DOWNLOAD_FAILED', `No se pudo descargar el documento desde la URL: ${reason}`);
  }

  if (!response.ok) {
    if (google && [401, 403, 404].includes(response.status)) {
      throw new ApiError(422, 'DOWNLOAD_FAILED', `No se pudo acceder al documento de Google (HTTP ${response.status}). Verifica que esté compartido como "Cualquier persona con el enlace"`);
    }
    throw new ApiError(422, 'DOWNLOAD_FAILED', `No se pudo descargar el documento desde la URL (HTTP ${response.status})`);
  }

  const contentLength = parseInt(response.headers.get('content-length'), 10);
  if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `El documento excede el tamaño máximo permitido (${config.maxFileSizeMb} MB)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new ApiError(413, 'FILE_TOO_LARGE', `El documento excede el tamaño máximo permitido (${config.maxFileSizeMb} MB)`);
  }
  if (buffer.length === 0) {
    throw new ApiError(422, 'DOWNLOAD_FAILED', 'La URL devolvió un documento vacío');
  }

  const originalname = filename || path.basename(parsedUrl.pathname) || 'documento';
  const mimetype = detectMimeType(buffer, originalname);
  if (!mimetype || !ALLOWED_MIME_TYPES.includes(mimetype)) {
    if (looksLikeHtml(buffer)) {
      const hint = google
        ? 'El documento de Google devolvió una página web en lugar del archivo. Verifica que esté compartido como "Cualquier persona con el enlace"'
        : 'La URL devolvió una página web en lugar de un documento. Usa un enlace de descarga directa';
      throw new ApiError(422, 'DOWNLOAD_FAILED', hint);
    }
    throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'El documento descargado no es de un tipo soportado. Se aceptan: PDF, DOCX, JPEG, PNG y WEBP');
  }

  return { buffer, mimetype, originalname };
}

module.exports = { download };
