'use strict';

const { Router } = require('express');

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Estado del servicio (liveness)
 *     description: Devuelve el estado del servicio. No requiere autenticación ni está sujeto a rate limit.
 *     tags: [Salud]
 *     responses:
 *       200:
 *         description: El servicio está operativo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 uptime:
 *                   type: number
 *                   description: Segundos desde el arranque del proceso
 *                   example: 123.45
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

module.exports = router;
