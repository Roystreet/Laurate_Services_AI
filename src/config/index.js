'use strict';

function intFromEnv(name, defaultValue) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

const config = Object.freeze({
  port: intFromEnv('PORT', 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
  visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
  interviewEnabled: process.env.INTERVIEW_ENABLED === 'true',
  realtimeModel: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
  realtimeVoice: process.env.OPENAI_REALTIME_VOICE || 'marin',
  interviewMaxSessions: intFromEnv('INTERVIEW_MAX_SESSIONS', 3),
  interviewDurationSeconds: intFromEnv('INTERVIEW_DURATION_SECONDS', 600),
  interviewAllowedOrigins: (process.env.INTERVIEW_ALLOWED_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8082,http://127.0.0.1:8082')).split(',').map(s => s.trim()).filter(Boolean),
  maxFileSizeMb: intFromEnv('MAX_FILE_SIZE_MB', 10),
  rateLimitWindowMs: intFromEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  rateLimitMax: intFromEnv('RATE_LIMIT_MAX', 30),
  scannedPdfMinChars: intFromEnv('SCANNED_PDF_MIN_CHARS', 200),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  documentUploadMaxMb: intFromEnv('DOCUMENT_UPLOAD_MAX_MB', 10),
  documentTtlSeconds: intFromEnv('DOCUMENT_TTL_SECONDS', 900),
  documentStoreMaxMb: intFromEnv('DOCUMENT_STORE_MAX_MB', 100),
});

function assertConfig() {
  if (!config.openaiApiKey) {
    throw new Error('Falta la variable de entorno OPENAI_API_KEY. Configúrala en el archivo .env');
  }
  if (config.publicBaseUrl) {
    const url = new URL(config.publicBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('PUBLIC_BASE_URL debe ser el origen público del servicio, sin rutas ni credenciales');
    }
  }
  if (config.nodeEnv === 'production' && config.publicBaseUrl && !config.publicBaseUrl.startsWith('https://')) {
    throw new Error('En producción PUBLIC_BASE_URL debe ser una URL HTTPS accesible desde Copilot');
  }
  for (const key of ['documentUploadMaxMb', 'documentTtlSeconds', 'documentStoreMaxMb']) {
    if (config[key] <= 0) throw new Error(`${key} debe ser mayor que cero`);
  }
  if (config.interviewEnabled) {
    if (!config.interviewAllowedOrigins.length) throw new Error('Configura INTERVIEW_ALLOWED_ORIGINS para habilitar el simulador');
    for (const origin of config.interviewAllowedOrigins) {
      if (new URL(origin).origin !== origin) throw new Error('INTERVIEW_ALLOWED_ORIGINS debe contener orígenes completos sin rutas');
    }
    if (config.interviewMaxSessions < 1 || config.interviewMaxSessions > 3) throw new Error('INTERVIEW_MAX_SESSIONS debe estar entre 1 y 3 para el piloto');
    if (config.interviewDurationSeconds < 120 || config.interviewDurationSeconds > 600) throw new Error('INTERVIEW_DURATION_SECONDS debe estar entre 120 y 600');
  }
}

module.exports = { config, assertConfig };
