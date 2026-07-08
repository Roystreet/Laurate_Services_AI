'use strict';

function intFromEnv(name, defaultValue) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

const config = Object.freeze({
  port: intFromEnv('PORT', 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  apiKey: process.env.API_KEY || '',
  textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
  visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
  maxFileSizeMb: intFromEnv('MAX_FILE_SIZE_MB', 10),
  rateLimitWindowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 30),
  scannedPdfMinChars: intFromEnv('SCANNED_PDF_MIN_CHARS', 200),
});

function assertConfig() {
  if (!config.openaiApiKey) {
    throw new Error('Falta la variable de entorno OPENAI_API_KEY. Configúrala en el archivo .env');
  }
  if (config.nodeEnv === 'production' && !config.apiKey) {
    throw new Error('En producción (NODE_ENV=production) la variable API_KEY es obligatoria para proteger el servicio');
  }
}

module.exports = { config, assertConfig };
