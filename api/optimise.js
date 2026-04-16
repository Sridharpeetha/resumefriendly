import Anthropic from '@anthropic-ai/sdk';

const MAX_INPUT_CHARS = 20000;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function cleanInput(value) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '';
}

function clampScore(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function buildPrompt(resume, job) {
  return `You are an expert resume writer and ATS optimisation specialist.

Given this resume and job description, return only a valid JSON object.
Do not use markdown, code fences, or commentary.

Return exactly this shape:
{
  "ats_before": <integer 0-100>,
  "ats_after": <integer 0-100>,
  "keyword_match": <integer 0-100>,
  "optimised_resume": "<full optimised resume as plain text with \\n for line breaks>"
}

Rules:
1. Keep the same candidate name, email, phone, education, employers, and job titles.
2. Rewrite weak bullet points with stronger action verbs and clearer impact.
3. Add relevant job keywords only when they fit the candidate's real experience.
4. Do not invent tools, certifications, companies, dates, or achievements.
5. Keep formatting simple and ATS-friendly. No tables, icons, or columns.
6. Keep scores honest and realistic.

RESUME:
${resume}

JOB DESCRIPTION:
${job}`;
}

async function callAnthropic(prompt) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2200,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  return message.content
    .map((block) => ('text' in block ? block.text : ''))
    .join('')
    .trim();
}

async function callGemini(prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error?.message || 'Gemini request failed.');
    error.status = response.status;
    throw error;
  }

  const text = data.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('AI returned an empty response.');
  }

  return text;
}

function parseModelResponse(rawText) {
  const cleanText = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const result = JSON.parse(cleanText);

  if (
    typeof result.ats_before === 'undefined' ||
    typeof result.ats_after === 'undefined' ||
    typeof result.keyword_match === 'undefined' ||
    typeof result.optimised_resume !== 'string'
  ) {
    throw new Error('Invalid response structure from AI.');
  }

  return {
    ats_before: clampScore(result.ats_before),
    ats_after: clampScore(result.ats_after),
    keyword_match: clampScore(result.keyword_match),
    optimised_resume: result.optimised_resume.trim()
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const resume = cleanInput(req.body?.resume);
  const job = cleanInput(req.body?.job);

  if (!resume || !job) {
    return res.status(400).json({ error: 'Missing resume or job description.' });
  }

  if (resume.length < 50) {
    return res.status(400).json({ error: 'Resume content is too short.' });
  }

  if (job.length < 30) {
    return res.status(400).json({ error: 'Job description is too short.' });
  }

  if (resume.length > MAX_INPUT_CHARS || job.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ error: 'Resume or job description is too long.' });
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: 'AI service is not configured. Add ANTHROPIC_API_KEY or GEMINI_API_KEY.'
    });
  }

  try {
    const prompt = buildPrompt(resume, job);
    const rawText = process.env.ANTHROPIC_API_KEY
      ? await callAnthropic(prompt)
      : await callGemini(prompt);
    const result = parseModelResponse(rawText);

    return res.status(200).json(result);
  } catch (err) {
    console.error('Optimise error:', err);

    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned invalid JSON. Please try again.' });
    }

    if (err.status === 429) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }

    if (err.status === 401 || err.status === 403) {
      return res.status(500).json({ error: 'AI credentials are invalid or missing.' });
    }

    if (err.status === 400) {
      return res.status(500).json({ error: err.message || 'AI request was rejected.' });
    }

    if (err instanceof TypeError || /fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err.message || '')) {
      return res.status(500).json({
        error: 'Could not reach the AI provider. Check internet access, API keys, and provider availability.'
      });
    }

    return res.status(500).json({
      error: err.message || 'The optimisation request failed unexpectedly.'
    });
  }
}