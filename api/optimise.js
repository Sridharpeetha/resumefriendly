import Anthropic from '@anthropic-ai/sdk';

const MAX_INPUT_CHARS = 20000;

/* ---------- MODEL PRIORITY ---------- */

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash',
  process.env.GEMINI_MODEL_SECONDARY || 'gemini-1.5-flash'
];

const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

/* ---------- HELPERS ---------- */

function cleanInput(value) {
  return typeof value === 'string'
    ? value.replace(/\u0000/g, '')
    : '';
}

function sanitize(value) {
  return cleanInput(value).trim();
}

function clampScore(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) return 0;

  return Math.max(0, Math.min(100, Math.round(num)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(resume, job) {
  return `
You are an elite ATS resume optimizer.

Return ONLY valid JSON.

{
  "ats_before": number,
  "ats_after": number,
  "keyword_match": number,
  "optimised_resume": "plain text"
}

Rules:
1. Keep same identity details.
2. Keep same dates and companies.
3. Improve impact bullets using metrics if already present.
4. Add job keywords naturally.
5. No fake experience.
6. ATS clean formatting.
7. No markdown.
8. Strong concise wording.

RESUME:
${resume}

JOB DESCRIPTION:
${job}
`;
}

function parseModelResponse(rawText) {
  let text = String(rawText || '')
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  const data = JSON.parse(text);

  if (
    typeof data !== 'object' ||
    typeof data.optimised_resume !== 'string'
  ) {
    throw new Error('Invalid AI output');
  }

  return {
    ats_before: clampScore(data.ats_before),
    ats_after: clampScore(data.ats_after),
    keyword_match: clampScore(data.keyword_match),
    optimised_resume: data.optimised_resume.trim()
  };
}

/* ---------- GEMINI ---------- */

async function callGeminiModel(prompt, model) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('Gemini unavailable');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        signal: controller.signal,
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
            temperature: 0.35,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(
        data?.error?.message || `${model} failed`
      );
      err.status = response.status;
      throw err;
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new Error(`${model} empty response`);
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryGemini(prompt) {
  let lastError;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Gemini ${model} attempt ${attempt}`);
        return await callGeminiModel(prompt, model);
      } catch (err) {
        lastError = err;

        const retryable =
          err.status === 429 ||
          err.status === 500 ||
          err.status === 503 ||
          err.name === 'AbortError';

        if (!retryable) break;

        await sleep(1800 * attempt);
      }
    }
  }

  throw lastError || new Error('Gemini failed');
}

/* ---------- CLAUDE ---------- */

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('Claude unavailable');
  }

  const client = new Anthropic({ apiKey });

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

  const text = message.content
    ?.map((block) => ('text' in block ? block.text : ''))
    .join('')
    .trim();

  if (!text) {
    throw new Error('Claude empty response');
  }

  return text;
}

/* ---------- ENGINE ---------- */

async function generateAI(prompt) {
  /* Gemini first */
  if (process.env.GEMINI_API_KEY) {
    try {
      return await tryGemini(prompt);
    } catch (err) {
      console.log('All Gemini models failed');
    }
  }

  /* Claude fallback */
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await callClaude(prompt);
    } catch (err) {
      console.log('Claude failed');
    }
  }

  throw new Error(
    'AI servers are busy right now. Please try again shortly.'
  );
}

/* ---------- API ---------- */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  try {
    const resume = sanitize(req.body?.resume);
    const job = sanitize(req.body?.job);

    if (!resume || !job) {
      return res.status(400).json({
        error: 'Resume and job description required.'
      });
    }

    if (resume.length < 50) {
      return res.status(400).json({
        error: 'Resume content too short.'
      });
    }

    if (job.length < 30) {
      return res.status(400).json({
        error: 'Job description too short.'
      });
    }

    if (
      resume.length > MAX_INPUT_CHARS ||
      job.length > MAX_INPUT_CHARS
    ) {
      return res.status(400).json({
        error: 'Input too large.'
      });
    }

    const prompt = buildPrompt(resume, job);

    const raw = await generateAI(prompt);

    const result = parseModelResponse(raw);

    return res.status(200).json(result);
  } catch (err) {
    console.error('OPTIMISE ERROR:', err);

    if (err instanceof SyntaxError) {
      return res.status(500).json({
        error: 'AI returned invalid data.'
      });
    }

    if (
      err.status === 401 ||
      err.status === 403
    ) {
      return res.status(500).json({
        error: 'AI authentication failed.'
      });
    }

    if (
      err.status === 429 ||
      err.status === 503
    ) {
      return res.status(503).json({
        error:
          'High traffic right now. Please retry in 30 seconds.'
      });
    }

    return res.status(500).json({
      error:
        err.message ||
        'Something went wrong. Please try again later.'
    });
  }
}