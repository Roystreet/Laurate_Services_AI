'use strict';

const crypto = require('crypto');
const path = require('path');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');

// Single-instance, bounded, temporary storage. Files disappear on restart.
function createDocumentStore({ ttlSeconds, maxBytes, now = Date.now }) {
  const documents = new Map();
  let storedBytes = 0;

  function prune() {
    for (const [id, document] of documents) {
      if (document.expiresAt <= now()) {
        storedBytes -= document.buffer.length;
        documents.delete(id);
      }
    }
  }

  function put(file) {
    prune();
    if (storedBytes + file.buffer.length > maxBytes) {
      throw new ApiError(503, 'DOCUMENT_STORE_FULL', 'La carga temporal está ocupada. Inténtalo más tarde');
    }
    const id = crypto.randomBytes(16).toString('hex');
    const token = crypto.randomBytes(32).toString('hex');
    const document = {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: path.basename(file.originalname.replace(/\\/g, '/')).replace(/[\r\n\x00-\x1f]/g, '').slice(0, 200) || 'documento',
      token,
      expiresAt: now() + ttlSeconds * 1000,
    };
    documents.set(id, document);
    storedBytes += document.buffer.length;
    return { id, ...document };
  }

  function get(id, token) {
    prune();
    const document = documents.get(id);
    const received = typeof token === 'string' ? Buffer.from(token) : Buffer.alloc(0);
    const expected = document ? Buffer.from(document.token) : Buffer.alloc(0);
    if (!document || received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'El documento temporal no existe o su enlace venció. Vuelve a adjuntarlo');
    }
    return document;
  }

  const timer = setInterval(prune, Math.min(ttlSeconds * 1000, 60000));
  timer.unref();
  return { put, get, close: () => clearInterval(timer) };
}

const documentStore = createDocumentStore({
  ttlSeconds: config.documentTtlSeconds,
  maxBytes: config.documentStoreMaxMb * 1024 * 1024,
});

function publicBaseUrl(req) {
  return config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
}

function resolveDocumentUrl(value, req) {
  let url;
  try { url = new URL(value); } catch (_) { return null; }
  if (url.origin !== new URL(publicBaseUrl(req)).origin) return null;
  const match = url.pathname.match(/^\/api\/v1\/documents\/([a-f0-9]{32})$/);
  return match ? documentStore.get(match[1], url.searchParams.get('token')) : null;
}

module.exports = { createDocumentStore, documentStore, publicBaseUrl, resolveDocumentUrl };
