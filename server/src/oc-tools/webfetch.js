'use strict';

async function executeWebFetch({ url, format, timeout }) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `Error: URL must start with http:// or https://`;
  }

  const upgraded = url.startsWith('http://') ? 'https://' + url.slice(7) : url;
  const timeoutSec = Math.min(timeout || 120, 120);
  const fmt = format || 'markdown';

  try {
    const response = await fetch(upgraded, {
      signal: AbortSignal.timeout(timeoutSec * 1000),
      headers: { 'User-Agent': 'myco-agent/1.0' },
    });
    if (!response.ok) {
      return `Error: HTTP ${response.status} ${response.statusText}`;
    }
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (fmt === 'html') return text;
    if (contentType.includes('html') && (fmt === 'markdown' || fmt === 'text')) {
      return htmlToText(text);
    }
    return text;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function htmlToText(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<h[1-6][^>]*>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n- ');
  text = text.replace(/<\/li>/gi, '');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

module.exports = { executeWebFetch };