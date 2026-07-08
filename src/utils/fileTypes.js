'use strict';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  DOCX_MIME,
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Firmas (magic bytes) por mimetype. DOCX comparte la firma ZIP con xlsx/pptx;
// si no es un Word real, mammoth fallará y se responde 422.
const MAGIC_BYTES = {
  'application/pdf': [Buffer.from('%PDF')],
  [DOCX_MIME]: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  'image/webp': [Buffer.from('RIFF')],
};

const EXTENSION_MIME = {
  '.pdf': 'application/pdf',
  '.docx': DOCX_MIME,
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function matchesDeclaredType(buffer, mimetype) {
  const signatures = MAGIC_BYTES[mimetype] || [];
  return signatures.some((sig) => buffer.subarray(0, sig.length).equals(sig));
}

// Detecta el mimetype real a partir del contenido; se usa para archivos
// descargados desde una URL, donde el Content-Type no es confiable.
function detectMimeType(buffer, filename) {
  if (buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) return 'application/pdf';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 4).equals(Buffer.from('RIFF')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  // ZIP: el único formato basado en ZIP que soportamos es DOCX
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return DOCX_MIME;

  const ext = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return ext ? EXTENSION_MIME[ext[0]] || null : null;
}

module.exports = { ALLOWED_MIME_TYPES, MAGIC_BYTES, DOCX_MIME, matchesDeclaredType, detectMimeType };
