import pdfParse from 'pdf-parse';
import WordExtractor from 'word-extractor';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['txt', 'pdf', 'doc', 'docx']);
const wordExtractor = new WordExtractor();

function getExtension(filename = '') {
  const value = String(filename).toLowerCase();
  const index = value.lastIndexOf('.');
  return index >= 0 ? value.slice(index + 1) : '';
}

function decodeBase64(value) {
  return Buffer.from(value, 'base64');
}

function normaliseText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractTextFromWord(buffer) {
  const document = await wordExtractor.extract(buffer);
  const body = typeof document?.getBody === 'function' ? document.getBody() : '';
  return normaliseText(body);
}

async function extractTextFromPdf(buffer) {
  const result = await pdfParse(buffer);
  return normaliseText(result?.text || '');
}

async function extractText(buffer, extension) {
  if (extension === 'txt') {
    return normaliseText(buffer.toString('utf8'));
  }

  if (extension === 'pdf') {
    return extractTextFromPdf(buffer);
  }

  if (extension === 'doc' || extension === 'docx') {
    return extractTextFromWord(buffer);
  }

  throw new Error('Unsupported file format.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const filename = typeof req.body?.filename === 'string' ? req.body.filename.trim() : '';
  const fileDataBase64 = typeof req.body?.fileDataBase64 === 'string' ? req.body.fileDataBase64.trim() : '';
  const extension = getExtension(filename);

  if (!filename || !fileDataBase64) {
    return res.status(400).json({ error: 'Missing uploaded file data.' });
  }

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return res.status(400).json({ error: 'Unsupported file format. Use PDF, DOC, DOCX, or TXT.' });
  }

  try {
    const buffer = decodeBase64(fileDataBase64);

    if (!buffer.length) {
      return res.status(400).json({ error: 'Uploaded file is empty.' });
    }

    if (buffer.length > MAX_FILE_BYTES) {
      return res.status(400).json({ error: 'Uploaded file is too large. Keep it under 5 MB.' });
    }

    const text = await extractText(buffer, extension);

    if (!text || text.length < 50) {
      return res.status(400).json({ error: 'Could not extract enough resume text from this file.' });
    }

    return res.status(200).json({ text });
  } catch (error) {
    console.error('Resume extraction error:', error);
    return res.status(500).json({ error: 'Could not read that resume file. Try PDF, DOC, DOCX, or TXT.' });
  }
}
