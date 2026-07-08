'use strict';

const mammoth = require('mammoth');
const { ApiError } = require('../../utils/errors');

// convertToHtml conserva encabezados, listas y tablas, lo que permite a GPT
// generar un Markdown más fiel que partiendo de texto plano.
async function extract(buffer) {
  try {
    const result = await mammoth.convertToHtml({ buffer });
    const html = (result.value || '').trim();
    if (!html) {
      throw new ApiError(422, 'EXTRACTION_FAILED', 'El documento Word no contiene texto extraíble');
    }
    return { rawContent: html, strategy: 'local-mammoth' };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(422, 'EXTRACTION_FAILED', `No se pudo leer el documento Word: ${err.message}`);
  }
}

module.exports = { extract };
