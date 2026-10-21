'use strict';

const { Router } = require('express');
const { match } = require('../controllers/cv-match.controller');
const router = Router();

/**
 * @openapi
 * /api/v1/cv-match:
 *   post:
 *     summary: Compara un CV leído con una propuesta laboral pública
 *     description: |
 *       Recibe el Markdown del CV devuelto por /convert y una URL de propuesta.
 *       Admite HTML público, PDF, DOCX, JPEG, PNG, WEBP y documentos compartidos de Google/Dropbox.
 *       No requiere API key del cliente. No acepta destinos de red privados.
 *       Límite de 80.000 caracteres por documento y 512 KB de JSON. Presupuesto total de 110 segundos.
 *       El veredicto no incluye porcentajes. La respuesta no se almacena en el servidor.
 *     tags: [Empleabilidad]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CvMatchRequest'
 *     responses:
 *       200:
 *         description: Veredicto y crítica en español, listos para mostrar en Copilot
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CvMatchResponse'
 *       400:
 *         description: Entrada incompleta, URL inválida o destino privado
 *       404:
 *         description: Documento temporal vencido o token inválido
 *       413:
 *         description: JSON, archivo o texto demasiado grande; el contenido no se trunca
 *       422:
 *         description: Propuesta inaccesible, ilegible o enlace con varias vacantes
 *       429:
 *         description: Demasiadas solicitudes
 *       502:
 *         description: Fallo de IA o respuesta incompleta/inválida
 *       504:
 *         description: Descarga o análisis agotó su tiempo máximo
 */
router.post('/cv-match', match);

module.exports = router;
