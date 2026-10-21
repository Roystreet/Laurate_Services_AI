'use strict';

const proposalService = require('../services/proposal.service');
const matchService = require('../services/cv-match.service');
const { resolveDocumentUrl } = require('../services/document-store.service');
const { checkContentLength } = require('../services/conversion.service');
const { ApiError } = require('../utils/errors');
const { withSignal } = require('../utils/abort');

function createMatchHandler({ extractProposal = proposalService.extract, compare = matchService.compare, timeoutMs = 110000 } = {}) {
  return async function match(req, res, next) {
    const { cvMarkdown, proposalUrl, proposalText } = req.body || {};
    let controller, timer, onClose;
    try {
      const hasUrl = typeof proposalUrl === 'string' && Boolean(proposalUrl.trim());
      const hasText = typeof proposalText === 'string' && Boolean(proposalText.trim());
      if (typeof cvMarkdown !== 'string' || !cvMarkdown.trim() ||
          (proposalUrl !== undefined && typeof proposalUrl !== 'string') ||
          (proposalText !== undefined && typeof proposalText !== 'string') || hasUrl === hasText) {
        throw new ApiError(400, 'INVALID_MATCH_REQUEST', 'Envía cvMarkdown con el CV leído y una sola propuesta: proposalUrl con su enlace o proposalText con el texto completo');
      }
      checkContentLength(cvMarkdown, proposalService.MAX_CONTENT_CHARS);
      let url;
      if (hasUrl) {
        try { url = new URL(proposalUrl.trim()); } catch (_) {
          throw new ApiError(400, 'INVALID_URL', 'El enlace de la propuesta no es válido');
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new ApiError(400, 'INVALID_URL', 'Usa un enlace http o https sin credenciales');
        }
      } else {
        checkContentLength(proposalText, proposalService.MAX_CONTENT_CHARS);
      }
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(new ApiError(504, 'MATCH_TIMEOUT', 'El análisis tardó demasiado. Reintenta o comparte otra propuesta; puedes conservar el mismo CV.')), timeoutMs);
      onClose = () => { if (!res.writableEnded) controller.abort(new Error('Cliente desconectado')); };
      res.once('close', onClose);
      const task = async () => {
        let proposal = hasText ? proposalText.trim() : undefined;
        if (url) {
          // Only our own token-protected documents bypass external network access.
          const document = resolveDocumentUrl(url.href, req);
          proposal = await extractProposal(url.href, { signal: controller.signal, document });
        }
        controller.signal.throwIfAborted();
        checkContentLength(proposal, proposalService.MAX_CONTENT_CHARS);
        return compare(cvMarkdown.trim(), proposal, { signal: controller.signal });
      };
      const result = await withSignal(task(), controller.signal);
      res.set('Cache-Control', 'no-store').json(result);
    } catch (err) {
      if (!res.destroyed) next(err);
    } finally {
      clearTimeout(timer);
      if (onClose) res.removeListener('close', onClose);
    }
  };
}

module.exports = { match: createMatchHandler(), createMatchHandler };
