'use strict';

const { openai, completionText } = require('./openai.client');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');

const SYSTEM_PROMPT = [
  'Eres un conversor de documentos a Markdown.',
  'Recibirás el contenido extraído de un documento (texto plano o HTML).',
  'Conviértelo a Markdown bien formateado: detecta títulos, subtítulos, listas, tablas y párrafos.',
  'Conserva TODO el texto original sin resumir, omitir ni inventar contenido.',
  'Responde ÚNICAMENTE con el Markdown resultante, sin bloques de código envolventes (```), sin comentarios ni explicaciones.',
].join(' ');

// Límite defensivo por llamada; los documentos más largos se procesan en trozos secuenciales
const MAX_CHUNK_CHARS = 80000;

function splitIntoChunks(text) {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf('\n', end);
      if (lastBreak > start) end = lastBreak;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function toMarkdown(rawContent, { filename, signal } = {}) {
  const chunks = splitIntoChunks(rawContent);
  const parts = [];
  let totalTokens = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkNote = chunks.length > 1 ? ` (parte ${i + 1} de ${chunks.length})` : '';
    try {
      const completion = await openai.chat.completions.create({
        model: config.textModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Documento: ${filename || 'sin nombre'}${chunkNote}\n\n${chunks[i]}` },
        ],
      }, signal ? { signal, maxRetries: 0 } : undefined);
      parts.push(completionText(completion));
      totalTokens += completion.usage ? completion.usage.total_tokens : 0;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(502, 'UPSTREAM_AI_ERROR', `Fallo al procesar el documento con el modelo de IA: ${err.message}`);
    }
  }

  return { markdown: parts.join('\n\n').trim(), tokensUsed: totalTokens, model: config.textModel };
}

module.exports = { toMarkdown };
