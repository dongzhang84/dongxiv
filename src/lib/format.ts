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
export const searchUrl = (q: string) => `/search/?q=${encodeURIComponent(q)}`;

export const triMark = (t: Tri) =>
  t === 'yes' ? { sym: '✓', text: 'yes', cls: 'yes' }
  : t === 'no' ? { sym: '✗', text: 'no', cls: 'no' }
  : t === 'partial' ? { sym: '◐', text: 'partial', cls: 'partial' }
  : { sym: '–', text: 'not stated', cls: 'na' };

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
