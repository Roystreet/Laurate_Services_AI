'use strict';

const { Router } = require('express');
const { config } = require('../config');
const { createUpload, validateFile } = require('../middleware/upload.middleware');
const { documentStore, publicBaseUrl } = require('../services/document-store.service');
const { ApiError } = require('../utils/errors');

const router = Router();

function browserOrigin(req, res, next) {
  if (config.nodeEnv === 'production' && !config.publicBaseUrl) {
    return next(new ApiError(503, 'UPLOAD_NOT_CONFIGURED', 'La carga de documentos requiere configurar PUBLIC_BASE_URL'));
  }
  const origin = req.get('origin');
  const allowed = new Set(config.documentUploadOrigins);
  allowed.add(new URL(publicBaseUrl(req)).origin);
  if (!origin || !allowed.has(origin)) {
    return next(new ApiError(403, 'UPLOAD_ORIGIN_DENIED', 'Este sitio no está habilitado para cargar documentos'));
  }
  return next();
}

/**
 * @openapi
 * /api/v1/documents:
 *   post:
 *     summary: Carga temporal desde el widget (sin exponer la API key)
 *     description: Un archivo, origen del navegador permitido, rate limit y enlace temporal con token. No ejecuta IA.
 *     tags: [Documentos]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Documento temporal creado (source, filename, mimeType, url, expiresAt)
 *       403:
 *         description: Origen del navegador no permitido
 *       413:
 *         description: Archivo demasiado grande
 *       503:
 *         description: Almacenamiento temporal lleno
 */
router.post('/documents', browserOrigin, createUpload(config.documentUploadMaxMb).single('file'), validateFile, (req, res, next) => {
  try {
    const document = documentStore.put(req.file);
    const url = new URL(`/api/v1/documents/${document.id}`, publicBaseUrl(req));
    url.searchParams.set('token', document.token);
    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      source: 'document', filename: document.originalname, mimeType: document.mimetype,
      url: url.href, expiresAt: new Date(document.expiresAt).toISOString(),
    });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/v1/documents/{id}:
 *   get:
 *     summary: Descarga temporal mediante el token del enlace
 *     tags: [Documentos]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Contenido del documento
 *       404:
 *         description: Enlace inválido o vencido
 */
router.get('/documents/:id', (req, res, next) => {
  try {
    const document = documentStore.get(req.params.id, req.query.token);
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.attachment(document.originalname);
    res.type(document.mimetype).send(document.buffer);
  } catch (err) { next(err); }
});

module.exports = router;
