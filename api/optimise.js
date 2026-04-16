import Anthropic from '@anthropic-ai/sdk';

const MAX_INPUT_CHARS = 20000;
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function cleanInput(value) {
  return typeof value === 'string'
    ? value.replace(/\u0000/g, '').trim()
    : '';
}

function clampScore(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) return 0;

  return Math.max(0, Math.min(100, Math.round(num)));
}

function buildPrompt(resume, job) {
  return `
You are an expert resume writer and ATS optimisation specialist.

Return ONLY valid JSON.
No markdown.
No explanation.

{
  "ats_before": number,
  "ats_after": number,
  "keyword_match": number,
  "optimised_resume": "plain text"
}

Rules:
1. Keep same name, email, phone, company names, dates.
2. Improve bullet points professionally.
3. Add relevant keywords naturally.
4. Do not invent fake experience.
5. ATS friendly formatting.

RESUME:
${resume}

JOB DESCRIPTION:
${job}
`;
}

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY missing.');
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
    throw new Error('Anthropic returned empty response.');
  }

  return text;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY missing.');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
    const err = new Error(
      data?.error?.message || 'Gemini request failed.'
    );
    err.status = response.status;
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini returned empty response.');
  }

  return text;
}

function parseModelResponse(rawText) {
  const clean = rawText
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  const result = JSON.parse(clean);

  if (
    typeof result.optimised_resume !== 'string'
  ) {
    throw new Error('Invalid AI JSON structure.');
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
    return res.status(405).json({
      error: 'Method not allowed.'
    });
  }

  try {
    const resume = cleanInput(req.body?.resume);
    const job = cleanInput(req.body?.job);

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

    let rawText = '';

    if (process.env.GEMINI_API_KEY) {
      rawText = await callGemini(prompt);
    } else if (process.env.ANTHROPIC_API_KEY) {
      rawText = await callAnthropic(prompt);
    } else {
      return res.status(500).json({
        error:
          'No AI key found. Add GEMINI_API_KEY or ANTHROPIC_API_KEY.'
      });
    }

    const result = parseModelResponse(rawText);

    return res.status(200).json(result);
  } catch (err) {
    console.error('OPTIMISE ERROR:', err);

    if (err instanceof SyntaxError) {
      return res.status(500).json({
        error: 'AI returned invalid JSON.'
      });
    }

    if (err.status === 401 || err.status === 403) {
      return res.status(500).json({
        error: 'Invalid API key.'
      });
    }

    if (err.status === 429) {
      return res.status(429).json({
        error: 'Too many requests. Try later.'
      });
    }

    return res.status(500).json({
      error:
        err.message ||
        'Something went wrong. Please try again later.'
    });
  }
}