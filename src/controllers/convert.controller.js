'use strict';

const pdfExtractor = require('../services/extractors/pdf.extractor');
const docxExtractor = require('../services/extractors/docx.extractor');
const imageExtractor = require('../services/extractors/image.extractor');
const markdownService = require('../services/markdown.service');
const { ApiError } = require('../utils/errors');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function convert(req, res, next) {
  const startedAt = Date.now();
  const { buffer, mimetype, originalname } = req.file;

  try {
    let extraction;
    if (mimetype === 'application/pdf') {
      extraction = await pdfExtractor.extract(buffer, originalname);
    } else if (mimetype === DOCX_MIME) {
      extraction = await docxExtractor.extract(buffer);
    } else if (mimetype.startsWith('image/')) {
      extraction = await imageExtractor.extract(buffer, mimetype);
    } else {
      throw new ApiError(400, 'UNSUPPORTED_FILE_TYPE', `Tipo de archivo no soportado: ${mimetype}`);
    }

    let markdown;
    let strategy = extraction.strategy;
    let tokensUsed = extraction.tokensUsed || 0;
    let model = extraction.model;

    if (extraction.markdown !== undefined) {
      // Vision ya devolvió el Markdown final (imágenes y PDFs escaneados)
      markdown = extraction.markdown;
    } else {
      const formatted = await markdownService.toMarkdown(extraction.rawContent, { filename: originalname });
      markdown = formatted.markdown;
      tokensUsed += formatted.tokensUsed;
      model = formatted.model;
      strategy = `${extraction.strategy}+gpt`;
    }

    const meta = { model, strategy, processingMs: Date.now() - startedAt };
    if (tokensUsed > 0) meta.tokensUsed = tokensUsed;

    res.json({ filename: originalname, mimeType: mimetype, markdown, meta });
  } catch (err) {
    next(err);
  }
}

module.exports = { convert };
