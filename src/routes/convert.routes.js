'use strict';

const { Router } = require('express');
const { upload, fetchFromUrl, validateFile } = require('../middleware/upload.middleware');
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
 *       **Dos formas de enviar el documento:**
 *       1. **Subida directa**: `multipart/form-data` con el archivo en el campo `file`.
 *       2. **Por URL**: body JSON `{ "url": "https://...", "filename": "documento.pdf" }` — el servicio
 *          descarga el documento desde la URL y lo analiza. `filename` es opcional (se usa para
 *          identificar el documento y ayudar a detectar su tipo); si se omite, se deriva de la URL.
 *
 *       **Enlaces de Google soportados** (el documento debe estar compartido como
 *       *"Cualquier persona con el enlace"*): Google Docs (se exporta como .docx),
 *       Google Slides y Google Sheets (se exportan como PDF) y archivos de Google Drive
 *       (descarga directa). Ejemplo: `https://docs.google.com/document/d/ID/edit?usp=sharing`.
 *
 *       **Estrategia de procesamiento (híbrida):**
 *       - **PDF con texto**: extracción local + GPT para estructurar el Markdown (`local-pdf-parse+gpt`).
 *       - **PDF escaneado** (sin texto extraíble): se envía el PDF al modelo de visión de OpenAI (`openai-pdf-vision`).
 *       - **Word .docx**: extracción local con estructura + GPT (`local-mammoth+gpt`).
 *       - **Imágenes/fotografías**: OCR y estructuración con GPT Vision (`openai-image-vision`).
 *
 *       No requiere API key del cliente.
 *     tags: [Conversión]
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
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConvertUrlRequest'
 *     responses:
 *       200:
 *         description: Conversión exitosa
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ConvertResponse'
 *       400:
 *         description: Solicitud inválida (falta el documento, tipo no soportado o URL inválida)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       413:
 *         description: El documento excede el tamaño máximo permitido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: No se pudo extraer el contenido o descargar el documento desde la URL
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
router.post('/convert', upload.single('file'), fetchFromUrl, validateFile, convert);

module.exports = router;
