'use strict';

const { Router } = require('express');
const { apiKeyMiddleware } = require('../middleware/apiKey.middleware');
const { upload, validateFile } = require('../middleware/upload.middleware');
const { convert } = require('../controllers/convert.controller');

const router = Router();

/**
 * @openapi
 * /api/v1/convert:
 *   post:
 *     summary: Convierte un documento a Markdown
 *     description: |
 *       Recibe un documento (PDF, Word .docx o imagen JPEG/PNG/WEBP) y devuelve todo su texto
 *       convertido a formato Markdown.
 *
 *       **Estrategia de procesamiento (híbrida):**
 *       - **PDF con texto**: extracción local + GPT para estructurar el Markdown (`local-pdf-parse+gpt`).
 *       - **PDF escaneado** (sin texto extraíble): se envía el PDF al modelo de visión de OpenAI (`openai-pdf-vision`).
 *       - **Word .docx**: extracción local con estructura + GPT (`local-mammoth+gpt`).
 *       - **Imágenes/fotografías**: OCR y estructuración con GPT Vision (`openai-image-vision`).
 *
 *       En producción requiere el header `x-api-key`.
 *     tags: [Conversión]
 *     security:
 *       - ApiKeyAuth: []
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
 *                 description: Documento a convertir (PDF, DOCX, JPEG, PNG o WEBP; máx. 10 MB por defecto)
 *     responses:
 *       200:
 *         description: Conversión exitosa
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConvertResponse'
 *       400:
 *         description: Solicitud inválida (falta el archivo o tipo no soportado)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: API key ausente o inválida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       413:
 *         description: El archivo excede el tamaño máximo permitido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: No se pudo extraer el contenido del documento
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Límite de solicitudes excedido (rate limit)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       502:
 *         description: Fallo del servicio de IA (OpenAI)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/convert', apiKeyMiddleware, upload.single('file'), validateFile, convert);

module.exports = router;
