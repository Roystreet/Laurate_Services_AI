'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const { config } = require('./config');
const swaggerSpec = require('./docs/swagger');
const healthRoutes = require('./routes/health.routes');
const convertRoutes = require('./routes/convert.routes');
const documentRoutes = require('./routes/document.routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler.middleware');

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.use(healthRoutes);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Laurate Convertidor Markdown — API' }));
app.get('/docs.json', (req, res) => res.json(swaggerSpec));

const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Demasiadas solicitudes, inténtalo de nuevo más tarde', status: 429 },
  },
});
app.use('/api', apiLimiter);

app.use('/api/v1', documentRoutes);
app.use('/api/v1', convertRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
