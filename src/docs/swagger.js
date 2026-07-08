'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Laurate Convertidor Markdown',
      version: '1.0.0',
      description: [
        'Servicio REST que recibe documentos (PDF, Word .docx e imágenes/fotografías) y devuelve todo su texto',
        'convertido a formato Markdown. El análisis se realiza con IA usando modelos GPT de OpenAI con una',
        'estrategia híbrida: extracción local cuando el documento tiene texto y GPT Vision para imágenes y PDFs escaneados.',
        '',
        '**Seguridad:** en modo producción (`NODE_ENV=production`) todas las llamadas a `/api/v1/*` requieren el',
        'header `x-api-key`. Además se aplica rate limiting y un límite de tamaño de archivo.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Servidor actual' }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'API key del servicio. Obligatoria en producción; en desarrollo solo si API_KEY está definida.',
        },
      },
      schemas: {
        ConvertResponse: {
          type: 'object',
          properties: {
            filename: { type: 'string', example: 'informe.pdf' },
            mimeType: { type: 'string', example: 'application/pdf' },
            markdown: { type: 'string', example: '# Informe anual\n\nContenido del documento...' },
            meta: {
              type: 'object',
              properties: {
                model: { type: 'string', example: 'gpt-4o-mini', description: 'Modelo GPT utilizado' },
                strategy: {
                  type: 'string',
                  example: 'local-pdf-parse+gpt',
                  description: 'Estrategia aplicada: local-pdf-parse+gpt, local-mammoth+gpt, openai-pdf-vision u openai-image-vision',
                },
                tokensUsed: { type: 'integer', example: 1234, description: 'Tokens consumidos en las llamadas a OpenAI (si aplica)' },
                processingMs: { type: 'integer', example: 4321, description: 'Tiempo total de procesamiento en milisegundos' },
              },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'UNSUPPORTED_FILE_TYPE' },
                message: { type: 'string', example: 'Tipo de archivo no soportado' },
                status: { type: 'integer', example: 400 },
              },
            },
          },
        },
      },
    },
    tags: [
      { name: 'Conversión', description: 'Conversión de documentos a Markdown' },
      { name: 'Salud', description: 'Estado del servicio' },
    ],
  },
  // Forward slashes: el glob de swagger-jsdoc no reconoce backslashes de Windows
  apis: [path.join(__dirname, '../routes/*.js').replace(/\\/g, '/')],
};

module.exports = swaggerJsdoc(options);
