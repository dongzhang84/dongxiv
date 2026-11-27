#!/usr/bin/env node
// dongxiv 本地发布后台。运行：npm run admin，然后打开 http://localhost:4322
// 只监听本机（127.0.0.1），不会部署到线上。所有改动只写进 papers/，点"发布"时才 commit 和 push。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAPERS = path.join(ROOT, 'papers');
const PORT = Number(process.env.ADMIN_PORT) || 4322;
const SITE_PORT = Number(process.env.SITE_PORT) || 4321;
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const MAX_PDF = 95 * 1024 * 1024; // GitHub 单文件上限是 100 MB
const ID_RE = /^\d{4}\.\d{4}$/;
const TRI = new Set(['yes', 'no', 'partial']);

const site = (await import(pathToFileURL(path.join(ROOT, 'site.config.mjs')).href)).default;
const SUBJECTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/arxiv-subjects.json'), 'utf8'));
const SUBJECT_NAMES = new Set(SUBJECTS.map((s) => s.name));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dongxiv-admin-'));

class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

// ---------- 小工具 ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function tool(cmd, args) {
  try {
    const { stdout } = await execFileP(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch {
    return null; // 没装 poppler 时，自动提取的字段留空
  }
}

async function git(args) {
  const { stdout } = await execFileP('git', args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

const todayUTC = () => new Date().toISOString().slice(0, 10);

/** 表单里的日期：选今天就记下当前精确时间；选以前的日期（补录）就只记日期，不编造时刻。 */
function normalizeDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '')) fail('Date must be in YYYY-MM-DD format.');
  if (Number.isNaN(Date.parse(d))) fail('Invalid date.');
  if (d > todayUTC()) fail('The date cannot be later than today.');
  return d === todayUTC() ? new Date().toISOString().replace(/\.\d+Z$/, 'Z') : d;
}

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'as', 'via']);
/** 全大写的标题（如 A SEVEN-POINT SPHERE OF THE TETRAHEDRON）改成 A Seven-Point Sphere of the Tetrahedron */
const titleCase = (t) => t.toLowerCase().split(/\s+/).map((w, i) =>
  i > 0 && SMALL.has(w) ? w : w.split('-').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('-')).join(' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- PDF 自动提取（只是预填，需要人看过） ----------
async function analyzePdf(file) {
  const info = (await tool('pdfinfo', [file])) ?? '';
  const pages = Number(/^Pages:[ \t]*(\d+)/m.exec(info)?.[1]) || null;
  const metaTitle = /^Title:[ \t]*([^\n]*)$/m.exec(info)?.[1]?.trim() ?? '';
  const metaAuthor = /^Author:[ \t]*([^\n]*)$/m.exec(info)?.[1]?.trim() ?? '';
  const first = (await tool('pdftotext', ['-l', '2', file, '-'])) ?? '';
  const all = (await tool('pdftotext', [file, '-'])) ?? '';

  const lines = first.split('\n').map((l) => l.trim()).filter(Boolean);
  let title = metaTitle && !/^(untitled|microsoft word)/i.test(metaTitle) ? metaTitle : '';
  if (!title) title = lines.find((l) => l.length > 8 && !/^(preprint|draft|arxiv)/i.test(l)) ?? '';
  if (/[A-Z]/.test(title) && title === title.toUpperCase()) title = titleCase(title);

  const join = (s) => s.replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  let abstract = '';
  const m = /\bAbstract[.:—–-]?\s*([\s\S]{80,4000}?)\n\s*(?:1\.?\s+Introduction|I\.\s+Introduction|Introduction\n|Keywords|Key words|Contents\n)/i.exec(first);
  if (m) abstract = join(m[1]);

  const count = (re) => new Set([...all.matchAll(re)].map((x) => x[1])).size;
  const figures = count(/^(?:Figure|FIGURE|Fig\.)\s+([A-Z]?\d+)[.:]/gm);
  const tables = count(/^(?:Table|TABLE)\s+([A-Z]?\d+)[.:]/gm);
  const comments = [pages && plural(pages, 'page'), figures && plural(figures, 'figure'), tables && plural(tables, 'table')]
    .filter(Boolean).join(', ');
  return { pages, title, author: metaAuthor, abstract, comments, figures, tables };
}

// ---------- 论文读写 ----------
const paperDir = (id) => {
  if (!ID_RE.test(id)) fail('Invalid identifier.');
  return path.join(PAPERS, id);
};
const readMeta = (id) => YAML.parse(fs.readFileSync(path.join(paperDir(id), 'meta.yaml'), 'utf8'));
const writeMeta = (id, meta) =>
  fsp.writeFile(path.join(paperDir(id), 'meta.yaml'), YAML.stringify(meta, { lineWidth: 0 }));
const allIds = () => (fs.existsSync(PAPERS) ? fs.readdirSync(PAPERS).filter((d) => ID_RE.test(d)).sort() : []);
const firstDate = (meta) => String(meta.versions?.[0]?.date ?? '');

function nextId(date) {
  const yymm = date.slice(2, 4) + date.slice(5, 7);
  const same = allIds().filter((id) => id.startsWith(yymm + '.'));
  const n = same.reduce((m, id) => Math.max(m, Number(id.slice(5))), 0) + 1;
  if (n > 9999) fail('No identifiers left for this month.');
  const later = same.filter((id) => firstDate(readMeta(id)).slice(0, 10) > date.slice(0, 10));
  const warning = later.length
    ? `This month already has papers with a later date (${later.join(', ')}); the new paper will be numbered after them.`
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

/** 把表单内容整理成 meta.yaml 的字段（不含 versions），顺序固定，空字段省略。 */
function buildMeta(f) {
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
  if (clean(f.license) && clean(f.license) !== site.defaultLicense) m.license = clean(f.license);
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

function takeUpload(token) {
  if (!/^[0-9a-f]{32}$/.test(token ?? '')) fail('Upload a PDF first.');
  const file = path.join(TMP, `${token}.pdf`);
  if (!fs.existsSync(file)) fail('The uploaded PDF has expired; please upload it again.');
  return file;
}

async function versionEntry(file, date, note, v) {
  const buf = await fsp.readFile(file);
  const { pages } = await analyzePdf(file);
  const e = { date: normalizeDate(date), file: `v${v}.pdf`, sha256: sha256(buf) };
  if (pages) e.pages = pages;
  if (clean(note)) e.note = clean(note);
  return e;
}

// ---------- git 状态 ----------
async function gitState() {
  const tracked = new Set((await git(['ls-files', '--', 'papers'])).split('\n').filter(Boolean));
  const changes = (await git(['status', '--porcelain=v1', '-uall', '--', 'papers']))
    .split('\n').filter(Boolean)
    .map((l) => ({ code: l.slice(0, 2).trim(), file: l.slice(3) }));
  return { tracked, changes };
}

async function state() {
  const { tracked, changes } = await gitState();
  const papers = allIds().reverse().map((id) => {
    let meta;
    try { meta = readMeta(id); } catch (e) { return { id, error: String(e.message) }; }
    const isNew = ![...tracked].some((f) => f.startsWith(`papers/${id}/`));
    const changed = changes.some((c) => c.file.startsWith(`papers/${id}/`));
    return {
      id, meta,
      status: isNew ? 'new' : changed ? 'changed' : 'published',
      versions: (meta.versions ?? []).map((v, i) => ({ ...v, v: i + 1, published: tracked.has(`papers/${id}/v${i + 1}.pdf`) })),
    };
  });
  return {
    site: { name: site.name, author: site.author, defaultLicense: site.defaultLicense, baseUrl: site.baseUrl },
    sitePort: SITE_PORT, today: todayUTC(), subjects: SUBJECTS, papers, changes,
  };
}

// ---------- 发布 ----------
async function publish() {
  const log = [];
  const { changes } = await gitState();
  if (!changes.length) fail('Nothing to publish.');
  log.push('$ npm run build');
  try {
    const { stdout } = await execFileP('npm', ['run', 'build'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    log.push(stdout.split('\n').filter((l) => /Complete|page\(s\)/.test(l)).join('\n'));
  } catch (e) {
    const out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.split('\n');
    // 优先显示我们自己的校验信息（格式、学科、哈希、日期），其次是最后几行
    const i = out.findIndex((l) => /is invalid|SHA-256|not found|identifier|must be later|arXiv category/.test(l));
    log.push((i >= 0 ? out.slice(i, i + 6) : out.slice(-25)).join('\n').trim());
    return { ok: false, log: log.join('\n') + '\n\nBuild failed; nothing was committed or pushed.' };
  }
  const added = changes.filter((c) => /\/v\d+\.pdf$/.test(c.file) && c.code !== 'D')
    .map((c) => { const [, id, v] = /^papers\/([^/]+)\/v(\d+)\.pdf$/.exec(c.file); return `${site.name}:${id}v${v}`; });
  const edited = [...new Set(changes.filter((c) => c.file.endsWith('meta.yaml')).map((c) => c.file.split('/')[1]))]
    .filter((id) => !added.some((a) => a.includes(id)));
  const parts = [];
  if (added.length) parts.push(`Publish ${added.join(', ')}`);
  if (edited.length) parts.push(`Update ${edited.map((id) => `${site.name}:${id}`).join(', ')}`);
  const msg = parts.join('; ') || 'Update papers';
  await git(['add', '-A', '--', 'papers']);
  log.push(`$ git commit -m "${msg}"`);
  log.push((await git(['commit', '-m', msg, '--', 'papers'])).trim());
  log.push('$ git push');
  try {
    const { stdout, stderr } = await execFileP('git', ['push'], { cwd: ROOT });
    log.push(`${stdout}${stderr}`.trim() || 'ok');
  } catch (e) {
    log.push(`${e.stdout ?? ''}${e.stderr ?? ''}`.trim());
    return { ok: false, log: log.join('\n') + '\n\nCommitted locally, but the push failed. Check your network or GitHub access, then run git push in a terminal.' };
  }
  return { ok: true, log: log.join('\n') };
}

// ---------- HTTP ----------
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail(`File too large (limit ${Math.round(limit / 1024 / 1024)} MB)`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const readJson = async (req) => {
  try { return JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}'); } catch (e) {
    if (e instanceof UserError) throw e;
    fail('Malformed request.');
  }
};
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

let busy = false; // 同一时间只处理一个写操作

const routes = {
  'GET /': async (req, res) => send(res, 200, await fsp.readFile(path.join(ROOT, 'admin/index.html')), 'text/html; charset=utf-8'),
  'GET /api/state': async () => state(),
  'GET /api/next-id': async (req, res, url) => {
    const d = url.searchParams.get('date') ?? '';
    normalizeDate(d);
    return nextId(d);
  },
  'POST /api/upload': async (req) => {
    const buf = await readBody(req, MAX_PDF);
    if (buf.subarray(0, 5).toString() !== '%PDF-') fail('This is not a PDF file.');
    const token = crypto.randomBytes(16).toString('hex');
    const file = path.join(TMP, `${token}.pdf`);
    await fsp.writeFile(file, buf);
    const hash = sha256(buf);
    const dup = [];
    for (const id of allIds()) {
      (readMeta(id).versions ?? []).forEach((v, i) => { if (v.sha256 === hash) dup.push(`${id}v${i + 1}`); });
    }
    return { token, sha256: hash, size: buf.length, duplicateOf: dup, ...(await analyzePdf(file)) };
  },
  'POST /api/papers': async (req) => {
    const b = await readJson(req);
    const file = takeUpload(b.token);
    const meta = buildMeta(b.meta);
    const date = normalizeDate(b.date);
    const { id } = nextId(date.slice(0, 10));
    const dir = paperDir(id);
    await fsp.mkdir(dir, { recursive: false });
    const entry = await versionEntry(file, b.date, b.note, 1);
    await fsp.copyFile(file, path.join(dir, 'v1.pdf'));
    await writeMeta(id, { ...meta, versions: [entry] });
    await fsp.rm(file, { force: true });
    return { id };
  },
  'PUT /api/paper': async (req, res, url) => {
    const id = url.searchParams.get('id');
    const old = readMeta(id);
    const meta = buildMeta((await readJson(req)).meta);
    await writeMeta(id, { ...meta, versions: old.versions });
    return { id };
  },
  'POST /api/paper/version': async (req, res, url) => {
    const id = url.searchParams.get('id');
    const old = readMeta(id);
    const b = await readJson(req);
    const file = takeUpload(b.token);
    const n = old.versions.length + 1;
    const entry = await versionEntry(file, b.date, b.note, n);
    const prev = String(old.versions[n - 2].date);
    if (Date.parse(entry.date) <= Date.parse(prev)) fail(`The new version's date must be later than v${n - 1} (${prev.slice(0, 10)})`);
    const meta = b.meta ? buildMeta(b.meta) : (({ versions, ...rest }) => rest)(old);
    await fsp.copyFile(file, path.join(paperDir(id), `v${n}.pdf`), fs.constants.COPYFILE_EXCL);
    await writeMeta(id, { ...meta, versions: [...old.versions, entry] });
    await fsp.rm(file, { force: true });
    return { id, v: n };
  },
  'DELETE /api/paper': async (req, res, url) => {
    const id = url.searchParams.get('id');
    const { tracked } = await gitState();
    if ([...tracked].some((f) => f.startsWith(`papers/${id}/`))) fail('A published paper cannot be deleted (you can withdraw it under "Edit info").');
    await fsp.rm(paperDir(id), { recursive: true });
    return { id };
  },
  'DELETE /api/paper/version': async (req, res, url) => {
    const id = url.searchParams.get('id');
    const meta = readMeta(id);
    const n = meta.versions.length;
    const { tracked } = await gitState();
    if (n < 2) fail('With only one version, delete the whole paper instead.');
    if (tracked.has(`papers/${id}/v${n}.pdf`)) fail('A published version cannot be deleted.');
    await fsp.rm(path.join(paperDir(id), `v${n}.pdf`));
    await writeMeta(id, { ...meta, versions: meta.versions.slice(0, -1) });
    return { id };
  },
  'POST /api/publish': async () => publish(),
};

const server = http.createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && !ORIGINS.has(req.headers.origin ?? '')) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(res, 404, { error: 'Not found' });
    const write = req.method !== 'GET';
    if (write && busy) return send(res, 409, { error: 'The previous operation is still running; please wait.' });
    if (write) busy = true;
    try {
      const out = await route(req, res, url);
      if (!res.headersSent) send(res, 200, out);
    } finally {
      if (write) busy = false;
    }
  } catch (e) {
    const known = e instanceof UserError;
    if (!known) console.error(e);
    if (!res.headersSent) send(res, known ? 400 : 500, { error: known ? e.message : `Something went wrong: ${e.message}` });
  }
});

// 预览用的网站开发服务器（和线上同一套页面）
async function ensureSiteServer() {
  try {
    await fetch(`http://127.0.0.1:${SITE_PORT}/`);
    return null; // 已经在运行
  } catch {
    const child = spawn('npx', ['astro', 'dev', '--port', String(SITE_PORT), '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    return child;
  }
}

const siteChild = await ensureSiteServer();
const cleanup = () => {
  siteChild?.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  dongxiv admin: ${url}`);
  console.log(`  Site preview: http://localhost:${SITE_PORT}`);
  console.log('  Press Ctrl+C to quit\n');
  if (process.platform === 'darwin' && !process.env.NO_OPEN) execFile('open', [url]);
});
