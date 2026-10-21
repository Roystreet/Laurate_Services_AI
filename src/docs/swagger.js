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
        'La conversión no requiere API key del cliente. La carga temporal del widget acepta cualquier origen',
        'y tiene límites de tamaño y frecuencia; la descarga requiere el token temporal del enlace.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Servidor actual' }],
    paths: require('./interview.openapi'),
    components: {
      securitySchemes: { InterviewSession: { type: 'http', scheme: 'bearer', description: 'Token temporal de la entrevista, nunca OPENAI_API_KEY.' } },
      schemas: {
        CvMatchRequest: {
          type: 'object',
          required: ['cvMarkdown'],
          description: 'Envía exactamente una fuente no vacía: proposalUrl o proposalText. La otra puede omitirse o enviarse vacía.',
          oneOf: [
            { required: ['proposalUrl'], properties: { proposalUrl: { format: 'uri', pattern: '\\S' }, proposalText: { pattern: '^\\s*$' } } },
            { required: ['proposalText'], properties: { proposalText: { pattern: '\\S' }, proposalUrl: { pattern: '^\\s*$' } } },
          ],
          properties: {
            cvMarkdown: { type: 'string', minLength: 1, maxLength: 80000, description: 'Markdown del CV devuelto por /api/v1/convert' },
            proposalUrl: { type: 'string', description: 'URL pública de una propuesta laboral, documento compartido o archivo temporal del widget' },
            proposalText: { type: 'string', maxLength: 80000, description: 'Texto completo de una sola propuesta laboral pegada o escrita por el usuario' },
          },
        },
        CvMatchResponse: {
          type: 'object',
          required: ['verdict', 'text'],
          properties: {
            verdict: { type: 'string', enum: ['COMPATIBLE', 'NO_COMPATIBLE', 'INFORMACION_INSUFICIENTE'] },
            text: { type: 'string', description: 'Markdown en español con veredicto, evidencia, brechas, recomendaciones e información pendiente' },
          },
        },
        ConvertUrlRequest: {
          type: 'object',
          required: ['url'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://ejemplo.com/archivos/informe.pdf',
              description: 'URL pública (http/https) desde donde el servicio descargará el documento',
            },
            filename: {
              type: 'string',
              example: 'informe.pdf',
              description: 'Nombre del archivo (opcional). Ayuda a identificar el documento y detectar su tipo; si se omite, se deriva de la URL',
            },
          },
        },
        ConvertResponse: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: ['document', 'link'], description: 'Origen de la entrada' },
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
      { name: 'Documentos', description: 'Carga y descarga temporal del widget' },
      { name: 'Conversión', description: 'Conversión de documentos a Markdown' },
      { name: 'Empleabilidad', description: 'Match del CV con una propuesta laboral' },
      { name: 'Entrevistas', description: 'Simulador oral con OpenAI Realtime' },
      { name: 'Salud', description: 'Estado del servicio' },
    ],
  },
  // Forward slashes: el glob de swagger-jsdoc no reconoce backslashes de Windows
  apis: [path.join(__dirname, '../routes/*.js').replace(/\\/g, '/')],
};

module.exports = swaggerJsdoc(options);
