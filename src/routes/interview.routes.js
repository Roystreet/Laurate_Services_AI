'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { ApiError } = require('../utils/errors');
const { InterviewService } = require('../services/interview.service');
const { createProvider } = require('../services/interview-provider');

function createInterviewRouter({ service, enabled = config.interviewEnabled } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return next(new ApiError(503, 'INTERVIEW_DISABLED', 'El simulador de voz aún no está habilitado.'));
    next();
  });
  const createLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false,
    message: { error: { code: 'INTERVIEW_RATE_LIMIT', message: 'Has iniciado varias prácticas. Intenta nuevamente más tarde.', status: 429 } } });
  const controlLimit = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false });
  router.post('/', createLimit, (req, res) => res.status(201).json(service.create()));
  router.use('/:id', controlLimit, (req, res, next) => {
    try { req.interview = service.authorize(req.params.id, req.get('authorization')?.replace(/^Bearer /, '')); next(); } catch (err) { next(err); }
  });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.post('/:id/connect', wrap(async (req, res) => res.json(await service.connect(req.interview, req.body?.sdp))));
  router.get('/:id/events', (req, res, next) => {
    try {
      if (req.interview.listeners.size) throw new ApiError(409, 'INTERVIEW_ALREADY_OPEN', 'Esta sesión ya está abierta.');
      res.set({ 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders();
      const unsubscribe = service.subscribe(req.interview, state => res.write(`data: ${JSON.stringify(state)}\n\n`));
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
      heartbeat.unref();
      res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
    } catch (err) { next(err); }
  });
  router.post('/:id/ready', (req, res, next) => { try { service.ready(req.interview); res.sendStatus(204); } catch (err) { next(err); } });
  router.post('/:id/finish', wrap(async (req, res) => res.json({ report: await service.finish(req.interview) })));
  router.post('/:id/end', wrap(async (req, res) => { await service.end(req.interview); res.sendStatus(204); }));
  return router;
}

const interviewService = new InterviewService({ provider: createProvider(), maxSessions: config.interviewMaxSessions, durationSeconds: config.interviewDurationSeconds });
module.exports = { createInterviewRouter, interviewService };
