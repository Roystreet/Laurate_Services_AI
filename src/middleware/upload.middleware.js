'use strict';

const multer = require('multer');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Firmas (magic bytes) por mimetype. DOCX comparte la firma ZIP con xlsx/pptx;
// si no es un Word real, mammoth fallará y se responde 422.
const MAGIC_BYTES = {
  'application/pdf': [Buffer.from('%PDF')],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  'image/webp': [Buffer.from('RIFF')],
};

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

function validateFile(req, res, next) {
  if (!req.file) {
    return next(new ApiError(400, 'MISSING_FILE', 'No se recibió ningún archivo. Envía el documento en el campo "file" (multipart/form-data)'));
  }

  const signatures = MAGIC_BYTES[req.file.mimetype] || [];
  const matches = signatures.some((sig) => req.file.buffer.subarray(0, sig.length).equals(sig));
  if (!matches) {
    return next(new ApiError(400, 'UNSUPPORTED_FILE_TYPE', 'El contenido del archivo no coincide con su tipo declarado'));
  }
  return next();
}

module.exports = { upload, validateFile, ALLOWED_MIME_TYPES };
