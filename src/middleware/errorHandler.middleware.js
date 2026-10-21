'use strict';

const multer = require('multer');
const { ApiError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `La ruta ${req.method} ${req.originalUrl} no existe`, status: 404 },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'El JSON excede el tamaño máximo permitido', status: 413 } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo debe contener JSON válido', status: 400 } });
  }
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, status: err.statusCode },
    });
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: { code: 'FILE_TOO_LARGE', message: 'El archivo excede el tamaño máximo permitido', status: 413 },
      });
    }
    return res.status(400).json({
      error: { code: 'BAD_UPLOAD', message: `Error en la carga del archivo: ${err.message}`, status: 400 },
    });
  }

  console.error('[error no controlado]', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor', status: 500 },
  });
}

module.exports = { errorHandler, notFoundHandler };
