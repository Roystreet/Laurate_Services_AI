'use strict';

require('dotenv').config();

const { config, assertConfig } = require('./config');

try {
  assertConfig();
} catch (err) {
  console.error(`[config] ${err.message}`);
  process.exit(1);
}

const app = require('./app');

const server = app.listen(config.port, () => {
  console.log(`Laurate Convertidor Markdown escuchando en http://localhost:${config.port} (modo: ${config.nodeEnv})`);
  console.log(`Documentación de la API: http://localhost:${config.port}/docs`);
  console.log('Conversión disponible sin API key del cliente');
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  server.close(() => process.exit(1));
});
