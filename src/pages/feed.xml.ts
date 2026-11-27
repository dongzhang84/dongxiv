// Atom 订阅：每篇论文一条，更新时间取最新版本的日期
import type { APIRoute } from 'astro';
import site from '../../site.config.mjs';
import { getPapers, latest } from '../lib/papers';
import { esc, full, absUrl, pid } from '../lib/format';

export const GET: APIRoute = () => {
  const papers = getPapers();
  const updated = papers.reduce((m, p) => (p.updated > m ? p.updated : m), new Date(0));
  const entries = papers
    .map((p) => {
      const v = latest(p);
      const url = full(absUrl(p.id));
      const title = `${pid(p.id)}${p.versions.length > 1 ? ` (v${v.v})` : ''}: ${p.title}`;
      return `  <entry>
    <id>${esc(url)}</id>
    <title>${esc(title)}</title>
    <link href="${esc(url)}"/>
    <published>${p.first.toISOString()}</published>
    <updated>${p.updated.toISOString()}</updated>
${p.authors.map((a) => `    <author><name>${esc(a)}</name></author>`).join('\n')}
    <category term="${esc(p.primary_subject)}"/>
    <summary>${esc(p.abstract.trim().replace(/\s+/g, ' '))}</summary>
  </entry>`;
    })
    .join('\n');
  const body = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(full('/'))}</id>
  <title>${esc(site.name)}</title>
  <subtitle>${esc(site.tagline)}</subtitle>
  <link href="${esc(full('/'))}"/>
  <link rel="self" href="${esc(full('/feed.xml'))}"/>
  <updated>${updated.toISOString()}</updated>
  <author><name>${esc(site.author)}</name></author>
${entries}
</feed>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' } });
};
