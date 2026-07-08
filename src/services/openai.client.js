'use strict';

const OpenAI = require('openai');
const { config } = require('../config');

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: 120000,
  maxRetries: 2,
});

module.exports = { openai };
