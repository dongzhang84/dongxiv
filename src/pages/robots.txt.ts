import type { APIRoute } from 'astro';
import site from '../../site.config.mjs';
import { full } from '../lib/format';

export const GET: APIRoute = () =>
  new Response(
    site.indexable ? `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${full('/sitemap.xml')}\n` : 'User-agent: *\nDisallow: /\n',
    { headers: { 'Content-Type': 'text/plain' } },
  );
