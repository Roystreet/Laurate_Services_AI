'use strict';

// Import directo del módulo interno: el index.js de pdf-parse tiene un modo debug
// que intenta leer un PDF de prueba inexistente.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const { openai, completionText } = require('../openai.client');
const { config } = require('../../config');
const { ApiError } = require('../../utils/errors');

const OCR_PROMPT = [
  'Este PDF es un documento escaneado o sin texto extraíble.',
  'Extrae TODO el texto de todas sus páginas y devuélvelo en formato Markdown bien estructurado',
  '(títulos, listas, tablas y párrafos según corresponda).',
  'Conserva el texto completo sin resumir ni omitir nada.',
  'Responde ÚNICAMENTE con el Markdown, sin bloques de código envolventes ni comentarios.',
].join(' ');

function looksScanned(text, numPages) {
  const meaningfulChars = text.replace(/\s/g, '').length;
  return meaningfulChars < Math.max(config.scannedPdfMinChars, 50 * (numPages || 1));
}

// OpenAI rasteriza internamente el PDF (límite ~100 páginas / 32 MB por solicitud)
async function extractViaVision(buffer, filename, { signal } = {}) {
  try {
    const completion = await openai.chat.completions.create({
      model: config.visionModel,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: { filename: filename || 'documento.pdf', file_data: `data:application/pdf;base64,${buffer.toString('base64')}` },
            },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
    }, signal ? { signal, maxRetries: 0 } : undefined);

    const markdown = completionText(completion);
    if (!markdown) {
      throw new ApiError(422, 'EXTRACTION_FAILED', 'No se pudo extraer contenido del PDF escaneado');
    }
    return {
      markdown,
      strategy: 'openai-pdf-vision',
      tokensUsed: completion.usage ? completion.usage.total_tokens : 0,
      model: config.visionModel,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, 'UPSTREAM_AI_ERROR', `Fallo al analizar el PDF con el modelo de IA: ${err.message}`);
  }
}

async function extract(buffer, filename, options) {
  let parsed;
  try {
    // Old pdf.js versions can misread pooled Node Buffers with a non-zero byteOffset.
    parsed = await pdfParse(new Uint8Array(buffer));
  } catch (err) {
    throw new ApiError(422, 'EXTRACTION_FAILED', `No se pudo leer el PDF: ${err.message}`);
  }

  const text = (parsed.text || '').trim();
  if (looksScanned(text, parsed.numpages)) {
    return extractViaVision(buffer, filename, options);
  }
  return { rawContent: text, strategy: 'local-pdf-parse' };
}

module.exports = { extract };
