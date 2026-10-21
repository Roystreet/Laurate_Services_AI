'use strict';

const path = require('node:path');
const cheerio = require('cheerio');
const { config } = require('../config');
const publicDownload = require('./public-download.service');
const { resolveDownloadUrl, looksLikeHtml } = require('./download.service');
const { convertFile, checkContentLength } = require('./conversion.service');
const { detectMimeType, matchesDeclaredType } = require('../utils/fileTypes');
const { ApiError } = require('../utils/errors');

const MAX_CONTENT_CHARS = 80000;

function readableText($, element) {
  const copy = element.clone();
  copy.find('script, style, noscript, nav, header, footer, aside, form, iframe, button, [hidden], [aria-hidden="true"]').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p, div, li, h1, h2, h3, h4, section, tr').append('\n');
  return copy.text().replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function findJobs(value, jobs = []) {
  if (Array.isArray(value)) value.forEach(entry => findJobs(entry, jobs));
  else if (value && typeof value === 'object') {
    if ([value['@type']].flat().includes('JobPosting')) jobs.push(value);
    if (value['@graph']) findJobs(value['@graph'], jobs);
  }
  return jobs;
}

function extractHtml(buffer, contentType = '') {
  // loadBuffer respects the document's charset, including legacy job sites.
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  const $ = cheerio.loadBuffer(buffer, { encoding: { defaultEncoding: 'utf8', transportLayerEncodingLabel: charset } });
  const jobs = [];
  $('script[type="application/ld+json"]').each((_i, element) => {
    try { findJobs(JSON.parse($(element).text()), jobs); } catch (_) { /* Ignore malformed unrelated metadata. */ }
  });
  if (jobs.length > 1) {
    throw new ApiError(422, 'MULTIPLE_PROPOSALS', 'El enlace contiene varias vacantes. Comparte el enlace de una sola propuesta.');
  }
  let text;
  if (jobs.length === 1 && typeof jobs[0].description === 'string') {
    const job = jobs[0];
    const details = [job.title, job.hiringOrganization?.name, job.description];
    for (const key of ['qualifications', 'skills', 'experienceRequirements', 'educationRequirements', 'responsibilities', 'employmentType', 'jobLocation', 'applicantLocationRequirements', 'jobLocationType']) {
      if (job[key]) details.push(`${key}: ${typeof job[key] === 'string' ? job[key] : JSON.stringify(job[key])}`);
    }
    // Add metadata as text, rather than injecting its values into HTML.
    text = details.map(detail => {
      const fragment = cheerio.load(String(detail || ''));
      return readableText(fragment, fragment('body'));
    }).filter(Boolean).join('\n\n');
  } else {
    const main = $('main').first();
    const article = $('article').first();
    text = readableText($, main.length ? main : article.length ? article : $('body'));
  }
  checkContentLength(text, MAX_CONTENT_CHARS);
  const title = $('title').text();
  if (text.length < 100 || /^(just a moment|access denied|sign in|iniciar sesi[oó]n|attention required)/i.test(title.trim()) ||
      /enable javascript (and cookies )?to continue|checking your browser|verify (that )?you are human|verifica que eres humano/i.test(text)) {
    throw new ApiError(422, 'PROPOSAL_UNREADABLE', 'La página no muestra una propuesta legible o requiere acceso/JavaScript. Comparte un enlace público de la vacante o un documento descargable.');
  }
  return text;
}

async function extract(value, { signal, document } = {}) {
  if (document) return (await convertFile(document, { signal, maxChars: MAX_CONTENT_CHARS })).markdown;
  const resolved = resolveDownloadUrl(value);
  const downloaded = await publicDownload.download(resolved.url.href, { signal, maxBytes: config.maxFileSizeMb * 1024 * 1024 });
  const filename = resolved.filename || path.basename(new URL(downloaded.url).pathname) || 'propuesta';
  const mime = detectMimeType(downloaded.buffer, filename);
  if (mime && matchesDeclaredType(downloaded.buffer, mime)) {
    return (await convertFile({ buffer: downloaded.buffer, mimetype: mime, originalname: filename }, { signal, maxChars: MAX_CONTENT_CHARS })).markdown;
  }
  if (looksLikeHtml(downloaded.buffer) || /text\/html|application\/xhtml\+xml/i.test(downloaded.headers['content-type'] || '')) {
    // A Google/Dropbox sign-in or interstitial is not the shared document.
    if (resolved.google || ['www.dropbox.com', 'dropbox.com'].includes(resolved.url.hostname)) {
      throw new ApiError(422, 'PROPOSAL_UNAVAILABLE', 'El enlace compartido devolvió una página en lugar del documento. Habilita el acceso público o usa un enlace de descarga directa.');
    }
    return extractHtml(downloaded.buffer, downloaded.headers['content-type']);
  }
  throw new ApiError(422, 'PROPOSAL_UNREADABLE', 'El enlace debe contener una propuesta web, PDF, DOCX, JPG, PNG o WEBP legible');
}

module.exports = { extract, extractHtml, MAX_CONTENT_CHARS };
