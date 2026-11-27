import site from '../../site.config.mjs';
import type { Paper, PaperVersion, Tri } from './papers';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');

export const fmtDay = (d: Date) => `${DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const fmtShort = (d: Date) => `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const fmtMonth = (d: Date) => `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const fmtDateTime = (d: Date) =>
  `${fmtDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 转义后支持 [文字](链接) 和 *斜体*，用于 comments、notes 等短文本。 */
export function inline(s: string) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
}

/** 按空行分段。 */
export const paragraphs = (s: string) => s.trim().split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' '));

export const pid = (id: string, v?: number) => `${site.name}:${id}${v ? `v${v}` : ''}`;
export const absUrl = (id: string, v?: number) => `/abs/${id}${v ? `v${v}` : ''}/`;
export const pdfUrl = (id: string, v?: number) => `/pdf/${id}${v ? `v${v}` : ''}.pdf`;
export const full = (p: string) => new URL(p, site.baseUrl).href;

/** 把三项验证状态写成一句话，例如 "checked by AI; partly checked by the author; not formally verified"。 */
export function checkingText(vb: { machine_verified?: Tri; human_verified?: Tri; formal_verified?: Tri }) {
  const say = (t: Tri, yes: string, partial: string, no: string) => (t === 'yes' ? yes : t === 'partial' ? partial : t === 'no' ? no : '');
  return [
    say(vb.machine_verified, 'checked by AI', 'partly checked by AI', 'not checked by AI'),
    say(vb.human_verified, 'checked by the author', 'partly checked by the author', 'not yet checked by the author'),
    say(vb.formal_verified, 'formally verified', 'partly formally verified', 'not formally verified'),
  ].filter(Boolean).join('; ');
}

export function bibtex(p: Paper, v?: PaperVersion) {
  const lines = [
    `@misc{${pid(p.id)},`,
    `  title        = {{${p.title}}},`,
    `  author       = {${p.authors.join(' and ')}},`,
    `  year         = {${p.first.getUTCFullYear()}},`,
    `  month        = ${MON[p.first.getUTCMonth()].toLowerCase()},`,
    `  howpublished = {${pid(p.id, v?.v)}},`,
    `  url          = {${full(absUrl(p.id, v?.v))}},`,
  ];
  if (v) lines.push(`  note         = {Version ${v.v}, ${fmtShort(v.date)}},`);
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  return [...lines, '}'].join('\n');
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const subjectUrl = (s: string) => `/list/${slug(s)}/`;

/** 所有学科（主学科和交叉学科），按名字排序，带篇数。 */
export function subjectsOf(papers: Paper[]) {
  const m = new Map<string, { name: string; primary: number; total: number }>();
  for (const p of papers) {
    [p.primary_subject, ...p.subjects].forEach((s, i) => {
      const e = m.get(slug(s)) ?? { name: s, primary: 0, total: 0 };
      e.total++;
      if (i === 0) e.primary++;
      m.set(slug(s), e);
    });
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => a.name.localeCompare(b.name));
}
