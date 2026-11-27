// 只列最新版摘要页（版本页是 noindex），加首页和 About
import type { APIRoute } from 'astro';
import { getPapers } from '../lib/papers';
import { full, absUrl, esc } from '../lib/format';

export const GET: APIRoute = () => {
  const urls = [
    { loc: full('/') },
    { loc: full('/about/') },
    { loc: full('/list/') },
    ...getPapers().map((p) => ({ loc: full(absUrl(p.id)), lastmod: p.updated.toISOString().slice(0, 10) })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
