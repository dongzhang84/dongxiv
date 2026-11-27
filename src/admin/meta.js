// 在线后台：把表单整理成 meta.yaml、分配编号、处理日期。规则和本地后台（admin/server.mjs）一致，
// 最终还会在 Vercel 构建时由 src/lib/papers.ts 再校验一遍。
import SUBJECTS from '../lib/arxiv-subjects.json';

export { SUBJECTS };
const SUBJECT_NAMES = new Set(SUBJECTS.map((s) => s.name));
const TRI = new Set(['yes', 'no', 'partial']);
export const ID_RE = /^\d{4}\.\d{4}$/;

export class UserError extends Error {}
export const fail = (msg) => { throw new UserError(msg); };

export const todayUTC = () => new Date().toISOString().slice(0, 10);

/** 选今天就记下当前精确时间；选以前的日期（补录）就只记日期，不编造时刻。 */
export function normalizeDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '')) fail('Date must be in YYYY-MM-DD format.');
  if (Number.isNaN(Date.parse(d))) fail('Invalid date.');
  if (d > todayUTC()) fail('The date cannot be later than today.');
  return d === todayUTC() ? new Date().toISOString().replace(/\.\d+Z$/, 'Z') : d;
}

/** papers: [{ id, meta }]，date: YYYY-MM-DD */
export function nextId(papers, date) {
  const yymm = date.slice(2, 4) + date.slice(5, 7);
  const same = papers.filter((p) => p.id.startsWith(yymm + '.'));
  const n = same.reduce((m, p) => Math.max(m, Number(p.id.slice(5))), 0) + 1;
  if (n > 9999) fail('No identifiers left for this month.');
  const later = same.filter((p) => String(p.meta.versions?.[0]?.date ?? '').slice(0, 10) > date.slice(0, 10));
  const warning = later.length
    ? `This month already has papers with a later date (${later.map((p) => p.id).join(', ')}); the new paper will be numbered after them.`
    : '';
  return { id: `${yymm}.${String(n).padStart(4, '0')}`, warning };
}

const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const cleanList = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);
function cleanLinks(a, what) {
  return (Array.isArray(a) ? a : [])
    .map((l) => ({ label: clean(l?.label), url: clean(l?.url) }))
    .filter((l) => l.label || l.url)
    .map((l) => {
      if (!l.label || !/^https?:\/\/\S+$/.test(l.url)) fail(`${what}: each entry needs a label and a URL starting with http(s)://`);
      return l;
    });
}

/** 表单内容 → meta.yaml 的字段（不含 versions），顺序固定，空字段省略。 */
export function buildMeta(f, defaultLicense) {
  const m = {};
  m.title = clean(f.title) || fail('Title is required.');
  m.authors = cleanList(f.authors);
  if (!m.authors.length) fail('At least one author is required.');
  m.abstract = clean(f.abstract) || fail('Abstract is required.');
  if (clean(f.comments)) m.comments = clean(f.comments);
  m.primary_subject = clean(f.primary_subject);
  if (!SUBJECT_NAMES.has(m.primary_subject)) fail(`Primary subject "${m.primary_subject}" is not an arXiv category name. Pick one from the list.`);
  const subjects = [...new Set(cleanList(f.subjects))].filter((s) => s !== m.primary_subject);
  for (const s of subjects) if (!SUBJECT_NAMES.has(s)) fail(`Cross-list subject "${s}" is not an arXiv category name.`);
  if (subjects.length) m.subjects = subjects;
  const keywords = cleanList(f.keywords);
  if (keywords.length) m.keywords = keywords;
  if (clean(f.license) && clean(f.license) !== defaultLicense) m.license = clean(f.license);
  const links = cleanLinks(f.links, 'Links');
  if (links.length) m.links = links;
  const fo = f.formal ?? {};
  const formal = {};
  for (const k of ['system', 'scope', 'url', 'note']) if (clean(fo[k])) formal[k] = clean(fo[k]);
  if (Object.keys(formal).length) {
    if (!formal.system || !formal.url) fail('Formal proof: system and source URL are both required.');
    if (!/^https?:\/\/\S+$/.test(formal.url)) fail('Formal proof: the source URL must start with http(s)://');
    m.formal = formal;
  }
  if (clean(f.withdrawn)) m.withdrawn = clean(f.withdrawn);

  const v = f.vibe ?? {};
  const vibe = {};
  if (clean(v.human_role)) vibe.human_role = clean(v.human_role);
  if (cleanList(v.agents).length) vibe.agents = cleanList(v.agents);
  if (cleanList(v.models).length) vibe.models = cleanList(v.models);
  for (const k of ['machine_verified', 'human_verified', 'formal_verified']) if (TRI.has(v[k])) vibe[k] = v[k];
  const materials = cleanLinks(v.materials, 'Materials');
  if (materials.length) vibe.materials = materials;
  if (clean(v.notes)) vibe.notes = clean(v.notes);
  if (Object.keys(vibe).length) m.vibe = vibe;
  return m;
}

export function versionEntry({ date, sha256, pages, note }, v) {
  const e = { date: normalizeDate(date), file: `v${v}.pdf`, sha256 };
  if (pages) e.pages = pages;
  if (clean(note)) e.note = clean(note);
  return e;
}
