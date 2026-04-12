import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {

  // Allow only POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get resume and job from the request body
  const { resume, job } = req.body;

  // Validate inputs
  if (!resume || !job) {
    return res.status(400).json({ error: 'Missing resume or job description' });
  }

  if (resume.length < 50) {
    return res.status(400).json({ error: 'Resume is too short' });
  }

  if (job.length < 30) {
    return res.status(400).json({ error: 'Job description is too short' });
  }

  try {
    // Create Anthropic client using secret key from .env
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    // Build the prompt
    const prompt = `You are an expert resume writer and ATS optimization specialist.

Given this resume and job description, return ONLY a valid JSON object.
No markdown, no backticks, no explanation — just raw JSON.

The JSON must have exactly these 4 keys:
{
  "ats_before": <integer 0-100, estimated original ATS score>,
  "ats_after": <integer 0-100, estimated optimised ATS score>,
  "keyword_match": <integer 0-100, percentage of job keywords matched after optimisation>,
  "optimised_resume": "<full optimised resume as plain text, use \\n for line breaks>"
}

Rules you must follow:
1. Rewrite weak bullet points using strong action verbs and quantified results
2. Naturally inject missing keywords from the job description into the resume
3. Keep the exact same candidate name, email, phone, and education
4. Do NOT invent fake companies, job titles, or experience
5. Keep formatting clean — no tables, no columns, no special symbols
6. Be honest about scores — if resume is already strong, reflect that

RESUME:
${resume}

JOB DESCRIPTION:
${job}`;

    // Call Claude API
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extract the text response
    const rawText = message.content
      .map(block => block.text || '')
      .join('');

    // Clean and parse JSON
    const cleanText = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const result = JSON.parse(cleanText);

    // Validate result has required keys
    if (
      typeof result.ats_before !== 'number' ||
      typeof result.ats_after !== 'number' ||
      typeof result.keyword_match !== 'number' ||
      typeof result.optimised_resume !== 'string'
    ) {
      throw new Error('Invalid response structure from AI');
    }

    // Return the result to frontend
    return res.status(200).json({
      ats_before:       Math.round(result.ats_before),
      ats_after:        Math.round(result.ats_after),
      keyword_match:    Math.round(result.keyword_match),
      optimised_resume: result.optimised_resume
    });

  } catch (err) {
    console.error('Optimise error:', err.message);

    if (err instanceof SyntaxError) {
      return res.status(500).json({ error: 'AI returned invalid format. Please try again.' });
    }

    if (err.status === 429) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }

    if (err.status === 401) {
      return res.status(500).json({ error: 'Invalid API key. Check your .env file.' });
    }

    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}