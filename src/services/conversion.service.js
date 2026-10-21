'use strict';

const pdfExtractor = require('./extractors/pdf.extractor');
const docxExtractor = require('./extractors/docx.extractor');
const imageExtractor = require('./extractors/image.extractor');
const markdownService = require('./markdown.service');
const { DOCX_MIME } = require('../utils/fileTypes');
const { ApiError } = require('../utils/errors');

function checkContentLength(content, maxChars) {
  if (maxChars && content.length > maxChars) {
    throw new ApiError(413, 'CONTENT_TOO_LONG', `El documento supera los ${maxChars} caracteres. Usa una versión más breve; no se ha recortado el contenido.`);
  }
}

async function convertFile({ buffer, mimetype, originalname }, { signal, maxChars } = {}) {
  const startedAt = Date.now();
  signal?.throwIfAborted();
  let extraction;
  if (mimetype === 'application/pdf') {
    extraction = await pdfExtractor.extract(buffer, originalname, { signal });
  } else if (mimetype === DOCX_MIME) {
    extraction = await docxExtractor.extract(buffer);
  } else if (mimetype.startsWith('image/')) {
    extraction = await imageExtractor.extract(buffer, mimetype, { signal });
  } else {
    throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', `Tipo de archivo no soportado: ${mimetype}`);
  }
  signal?.throwIfAborted();
  let { markdown, strategy, model } = extraction;
  let tokensUsed = extraction.tokensUsed || 0;
  checkContentLength(markdown ?? extraction.rawContent, maxChars);
  if (markdown === undefined) {
    const formatted = await markdownService.toMarkdown(extraction.rawContent, { filename: originalname, signal });
    markdown = formatted.markdown;
    tokensUsed += formatted.tokensUsed;
    model = formatted.model;
    strategy += '+gpt';
  }
  checkContentLength(markdown, maxChars);
  if (!markdown.trim()) throw new ApiError(422, 'EXTRACTION_FAILED', 'El documento no contiene texto legible');
  const meta = { model, strategy, processingMs: Date.now() - startedAt };
  if (tokensUsed > 0) meta.tokensUsed = tokensUsed;
  return { filename: originalname, mimeType: mimetype, markdown, meta };
}

module.exports = { convertFile, checkContentLength };
