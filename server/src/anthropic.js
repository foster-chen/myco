// Shared Anthropic Messages-API client (raw HTTPS, no SDK).
//
// Used by both the session summarizer and the plan/arch/test extractor.
// Returns the assistant's text or null on any failure (missing API key,
// network error, timeout, malformed response). Callers MUST handle the
// null case — silent fallback is intentional so a missing key downgrades
// gracefully instead of breaking the request that triggered the call.

const https = require('https');
const agentConfig = require('./agent-config');

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT_MS = 30000;

function callAnthropic({ system, userMessage, model = DEFAULT_MODEL, maxTokens = 200, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { providerId, apiKey: resolvedApiKey, baseUrl } = agentConfig.resolve();
  if (providerId === 'openai') {
    return callOpenAICompatible({ system, userMessage, model, maxTokens, timeoutMs, apiKey: resolvedApiKey, baseUrl });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Promise.resolve(null);
  if (!userMessage) return Promise.resolve(null);

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.error(`[anthropic] api error: ${parsed.error.type || ''} ${parsed.error.message || data.slice(0, 200)}`);
            return resolve(null);
          }
          const text = parsed.content && parsed.content[0] && parsed.content[0].text;
          resolve(text || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', (err) => {
      console.error(`[anthropic] request error: ${err.message}`);
      resolve(null);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function callOpenAICompatible({ system, userMessage, model, maxTokens, timeoutMs, apiKey, baseUrl }) {
  const effectiveBaseUrl = baseUrl || 'https://api.openai.com/v1';
  const effectiveModel = model || 'gpt-4o-mini';
  const effectiveMaxTokens = maxTokens || 200;
  const effectiveTimeout = timeoutMs || 30000;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    const body = {
      model: effectiveModel,
      max_tokens: effectiveMaxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: userMessage },
      ],
    };

    const response = await fetch(`${effectiveBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    return text || null;
  } catch (err) {
    return null;
  }
}

module.exports = { callAnthropic, callOpenAICompatible, DEFAULT_MODEL };
