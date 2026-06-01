let agentSdk;
try { agentSdk = require('@opencode-ai/agent-sdk'); } catch(e) { agentSdk = null; }

function _htmlToText(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[$1]');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text;
}

function createWebFetchTool(sessionId, workspaceDir) {
  if (!agentSdk) throw new Error('@opencode-ai/agent-sdk not installed');
  return agentSdk.tool({
    description:
      '- Fetches content from a specified URL\n- Takes a URL and optional format as input\n- Fetches the URL content, converts to requested format (markdown by default)\n- Returns the content in the specified format\n- Use this tool when you need to retrieve and analyze web content\n\nUsage notes:\n  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead.\n  - The URL must be a fully-formed valid URL\n  - HTTP URLs will be automatically upgraded to HTTPS\n  - Format options: "markdown" (default), "text", or "html"\n  - Results may be summarized if the content is very large',
    inputSchema: agentSdk.jsonSchema({
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch content from.' },
        format: { type: 'string', enum: ['text', 'markdown', 'html'], description: 'The format to return the content in. Defaults to "markdown".' },
        timeout: { type: 'number', description: 'Optional timeout in seconds (max 120). Defaults to 120.' },
      },
      required: ['url'],
    }),
    execute: async (input) => {
      const url = input.url;
      const format = input.format || 'markdown';
      const timeoutSec = Math.min(input.timeout || 120, 120);

      if (!/^https?:\/\//i.test(url)) {
        return 'Error: URL must start with http:// or https://';
      }

      const fetchUrl = url.replace(/^http:/i, 'https:');
      try {
        const response = await fetch(fetchUrl, {
          signal: AbortSignal.timeout(timeoutSec * 1000),
          headers: { 'User-Agent': 'myco-agent/1.0' },
        });
        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }
        const contentType = response.headers.get('content-type') || '';
        const raw = await response.text();

        if (format === 'html') return raw;
        if (format === 'text') {
          if (contentType.includes('html')) return _htmlToText(raw);
          return raw;
        }
        if (contentType.includes('html')) return _htmlToText(raw);
        return raw;
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { createWebFetchTool };