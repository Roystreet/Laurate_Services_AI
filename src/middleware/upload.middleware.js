'use strict';

const multer = require('multer');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');
const { ALLOWED_MIME_TYPES, matchesDeclaredType } = require('../utils/fileTypes');
const downloadService = require('../services/download.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new ApiError(
        400,
        'UNSUPPORTED_FILE_TYPE',
        `Tipo de archivo no soportado: ${file.mimetype}. Se aceptan: PDF, DOCX, JPEG, PNG y WEBP`,
      ));
    }
    return cb(null, true);
  },
});

// Alternativa a la subida directa: el cliente envía { url, filename } y el
// servicio descarga el documento. Deja el resultado en req.file con la misma
// forma que multer para que el resto del pipeline no cambie.
async function fetchFromUrl(req, res, next) {
  if (req.file) return next();
  const { url, filename } = req.body || {};
  if (!url) return next();

  try {
    req.file = await downloadService.download(url, filename);
    return next();
  } catch (err) {
    return next(err);
  }
}

function validateFile(req, res, next) {
  if (!req.file) {
    return next(new ApiError(
      400,
      'MISSING_FILE',
      'No se recibió ningún documento. Envíalo en el campo "file" (multipart/form-data) o indica { "url", "filename" } en un body JSON',
    ));
  }

  if (!matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
    return next(new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'El contenido del archivo no coincide con su tipo declarado'));
  }
  return next();
}

module.exports = { upload, fetchFromUrl, validateFile, ALLOWED_MIME_TYPES };
