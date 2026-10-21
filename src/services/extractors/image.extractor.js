'use strict';

const { openai, completionText } = require('../openai.client');
const { config } = require('../../config');
const { ApiError } = require('../../utils/errors');

const OCR_PROMPT = [
  'Extrae TODO el texto visible en esta imagen y devuélvelo en formato Markdown bien estructurado',
  '(títulos, listas, tablas y párrafos según corresponda).',
  'Conserva el texto completo sin resumir ni omitir nada.',
  'Si la imagen no contiene texto, describe brevemente su contenido en Markdown.',
  'Responde ÚNICAMENTE con el Markdown, sin bloques de código envolventes ni comentarios.',
].join(' ');

async function extract(buffer, mimeType, { signal } = {}) {
  try {
    const completion = await openai.chat.completions.create({
      model: config.visionModel,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}`, detail: 'high' } },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
    }, signal ? { signal, maxRetries: 0 } : undefined);

    const markdown = completionText(completion);
    if (!markdown) {
      throw new ApiError(422, 'EXTRACTION_FAILED', 'No se pudo extraer contenido de la imagen');
    }
    return {
      markdown,
      strategy: 'openai-image-vision',
      tokensUsed: completion.usage ? completion.usage.total_tokens : 0,
      model: config.visionModel,
    };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, 'UPSTREAM_AI_ERROR', `Fallo al analizar la imagen con el modelo de IA: ${err.message}`);
  }
}

module.exports = { extract };
