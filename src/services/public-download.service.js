'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const net = require('node:net');
const zlib = require('node:zlib');
const ipaddr = require('ipaddr.js');
const { ApiError } = require('../utils/errors');
const { withSignal } = require('../utils/abort');

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 30000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function parsePublicUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) {
    throw new ApiError(400, 'INVALID_URL', 'El enlace de la propuesta no es válido');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ApiError(400, 'INVALID_URL', 'Usa un enlace http o https sin credenciales');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new ApiError(400, 'UNSAFE_URL', 'La propuesta debe estar disponible en una dirección pública');
  }
  return url;
}

function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch (_) { return false; }
}

function tooLarge() {
  return new ApiError(413, 'FILE_TOO_LARGE', 'La propuesta excede el tamaño máximo permitido');
}

function decodeBody(buffer, encoding, maxBytes) {
  const options = { maxOutputLength: maxBytes };
  try {
    if (!encoding || encoding === 'identity') return buffer;
    if (encoding === 'gzip') return zlib.gunzipSync(buffer, options);
    if (encoding === 'deflate') return zlib.inflateSync(buffer, options);
    if (encoding === 'br') return zlib.brotliDecompressSync(buffer, options);
    throw new ApiError(422, 'DOWNLOAD_FAILED', 'La propuesta utiliza una compresión no soportada');
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE') throw tooLarge();
    throw err;
  }
}

function requestOnce(url, { addresses, signal, maxBytes, requestImpl }) {
  const request = requestImpl || (url.protocol === 'https:' ? https.get : http.get);
  return new Promise((resolve, reject) => {
    const selected = addresses[0];
    const req = request(url, {
      signal,
      agent: false,
      autoSelectFamily: true,
      // Connect only to validated addresses, with IPv4/IPv6 fallback and original TLS host/SNI.
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, addresses) : callback(null, selected.address, selected.family),
      headers: {
        Accept: 'text/html, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, image/*;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Laurate-CV-Match/1.0',
      },
    }, response => {
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Descarga interrumpida')));
      if (REDIRECTS.has(response.statusCode) || response.statusCode !== 200) {
        resolve({ status: response.statusCode, headers: response.headers, buffer: Buffer.alloc(0) });
        response.destroy();
        return;
      }
      const contentLength = Number(response.headers['content-length']);
      if (contentLength > maxBytes) {
        reject(tooLarge());
        response.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(tooLarge());
          response.destroy();
        } else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          const buffer = decodeBody(Buffer.concat(chunks), response.headers['content-encoding'], maxBytes);
          resolve({ status: response.statusCode, headers: response.headers, buffer });
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
  });
}

function createPublicDownloader({ lookup = dns.lookup, request = requestOnce, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  return async function download(value, { signal, maxBytes } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new ApiError(504, 'PROPOSAL_DOWNLOAD_TIMEOUT', 'La descarga tardó demasiado. Prueba con otro enlace.')), timeoutMs);
    try {
      let url = parsePublicUrl(value);
      for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        controller.signal.throwIfAborted();
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const family = net.isIP(hostname);
        const addresses = family ? [{ address: hostname, family }] :
          await withSignal(lookup(hostname, { all: true, verbatim: true }), controller.signal);
        // Reject mixed public/private DNS answers as well as private literal IPs.
        if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
          throw new ApiError(400, 'UNSAFE_URL', 'La propuesta debe estar disponible en una dirección pública');
        }
        const result = await withSignal(request(url, { addresses, signal: controller.signal, maxBytes }), controller.signal);
        if (REDIRECTS.has(result.status)) {
          if (redirects === MAX_REDIRECTS || !result.headers.location) {
            throw new ApiError(422, 'DOWNLOAD_FAILED', 'El enlace tiene demasiadas redirecciones o una redirección inválida');
          }
          url = parsePublicUrl(new URL(result.headers.location, url).href);
          continue;
        }
        if (result.status !== 200) {
          throw new ApiError(422, 'PROPOSAL_UNAVAILABLE', `No se pudo abrir la propuesta (HTTP ${result.status}). Usa un enlace público sin inicio de sesión, o un documento compartido.`);
        }
        if (!result.buffer.length) throw new ApiError(422, 'PROPOSAL_UNREADABLE', 'La propuesta está vacía. Prueba con otro enlace.');
        return { ...result, url: url.href };
      }
    } catch (err) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (err instanceof ApiError) throw err;
      throw new ApiError(422, 'DOWNLOAD_FAILED', 'No se pudo descargar la propuesta. Verifica el enlace y que permita el acceso público.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  };
}

module.exports = { download: createPublicDownloader(), createPublicDownloader, requestOnce, isPublicAddress };
