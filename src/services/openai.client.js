'use strict';

const OpenAI = require('openai');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: 120000,
  maxRetries: 2,
});

function completionText(completion) {
  const choice = completion.choices?.[0];
  if (choice?.message?.refusal || (choice?.finish_reason && choice.finish_reason !== 'stop')) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'La IA no devolvió una respuesta completa. Inténtalo nuevamente.');
  }
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'La IA devolvió una respuesta vacía. Inténtalo nuevamente.');
  }
  return text.trim();
}

module.exports = { openai, completionText };
