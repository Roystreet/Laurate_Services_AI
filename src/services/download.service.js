'use strict';

const path = require('path');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');
const { ALLOWED_MIME_TYPES, detectMimeType } = require('../utils/fileTypes');

const DOWNLOAD_TIMEOUT_MS = 30000;

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
    throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'El documento descargado no es de un tipo soportado. Se aceptan: PDF, DOCX, JPEG, PNG y WEBP');
  }

  return { buffer, mimetype, originalname };
}

module.exports = { download };
