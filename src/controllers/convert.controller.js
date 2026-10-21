'use strict';

const { convertFile } = require('../services/conversion.service');

async function convert(req, res, next) {
  try {
    res.json({ source: req.inputSource || 'document', ...await convertFile(req.file) });
  } catch (err) {
    next(err);
  }
}

module.exports = { convert };
