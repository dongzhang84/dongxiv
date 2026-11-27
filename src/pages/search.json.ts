import type { APIRoute } from 'astro';
import { getPapers } from '../lib/papers';
import { dayKey } from '../lib/format';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      getPapers().map((p) => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        abstract: p.abstract.trim().replace(/\s+/g, ' '),
        subjects: [p.primary_subject, ...p.subjects],
        keywords: p.keywords,
        tools: [...p.vibe.agents, ...p.vibe.models],
        date: dayKey(p.first),
        v: p.versions.length,
      })),
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
