'use strict';

const proposalService = require('../services/proposal.service');
const matchService = require('../services/cv-match.service');
const { resolveDocumentUrl } = require('../services/document-store.service');
const { checkContentLength } = require('../services/conversion.service');
const { ApiError } = require('../utils/errors');
const { withSignal } = require('../utils/abort');

function createMatchHandler({ extractProposal = proposalService.extract, compare = matchService.compare, timeoutMs = 110000 } = {}) {
  return async function match(req, res, next) {
    const { cvMarkdown, proposalUrl } = req.body || {};
    let controller, timer, onClose;
    try {
      if (typeof cvMarkdown !== 'string' || !cvMarkdown.trim() || typeof proposalUrl !== 'string' || !proposalUrl.trim()) {
        throw new ApiError(400, 'INVALID_MATCH_REQUEST', 'Envía cvMarkdown con el CV leído y proposalUrl con el enlace de la propuesta');
      }
      checkContentLength(cvMarkdown, proposalService.MAX_CONTENT_CHARS);
      let url;
      try { url = new URL(proposalUrl.trim()); } catch (_) {
        throw new ApiError(400, 'INVALID_URL', 'El enlace de la propuesta no es válido');
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new ApiError(400, 'INVALID_URL', 'Usa un enlace http o https sin credenciales');
      }
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(new ApiError(504, 'MATCH_TIMEOUT', 'El análisis tardó demasiado. Reintenta o comparte otro enlace; puedes conservar el mismo CV.')), timeoutMs);
      onClose = () => { if (!res.writableEnded) controller.abort(new Error('Cliente desconectado')); };
      res.once('close', onClose);
      const task = async () => {
        // Only our own token-protected documents bypass external network access.
        const document = resolveDocumentUrl(url.href, req);
        const proposal = await extractProposal(url.href, { signal: controller.signal, document });
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
