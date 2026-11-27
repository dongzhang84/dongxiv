// dongxiv 在线后台（/admin/）。用 GitHub 登录后，上传 PDF、填信息、点"发布"即提交到仓库，Vercel 自动上线。
// 界面和本地后台（admin/index.html）基本一致；区别是这里每次保存就直接发布，没有"暂存再发布"这一步。
import YAML from 'yaml';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';
import { GitHub } from './github.js';
import { SUBJECTS, buildMeta, nextId, normalizeDate, todayUTC, versionEntry } from './meta.js';
import { analyzePdf } from './pdf.js';

const SITE = JSON.parse(document.getElementById('site-data').textContent);
const MAX_PDF = 95 * 1024 * 1024; // GitHub 单文件上限 100 MB
const TOKEN_COOKIE = 'dx_gh';
const FLAG = 'dongxiv-admin'; // 网站顶栏的 Submit 按钮只在登录过后台的浏览器里显示

let gh = null;
let S = null; // { me, head, papers }

// ---------- 工具 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = () => $('#app');
function toast(text) { const t = $('#toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); }
const math = (el) => renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }, { left: '$', right: '$', display: false }], throwOnError: false });
const yaml = (meta) => YAML.stringify(meta, { lineWidth: 0 });
const flag = (on) => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch {} };

const readCookie = (n) => document.cookie.split('; ').find((c) => c.startsWith(n + '='))?.slice(n.length + 1) ?? '';
const clearToken = () => { document.cookie = `${TOKEN_COOKIE}=; Path=/admin/; Max-Age=0; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`; };

async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let pdfjsP = null;
function pdfjs() {
  pdfjsP ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, w]) => {
    m.GlobalWorkerOptions.workerSrc = w.default;
    return m;
  });
  return pdfjsP;
}

// ---------- 上线进度 ----------
// 发布后轮询 /version.json，直到线上构建用的 commit 等于刚提交的 commit
let watching = null;
function watchDeploy(sha, label, url) {
  const bar = $('#deploy');
  const started = Date.now();
  const stamp = ++watchToken;
  const show = (cls, html) => { if (stamp === watchToken) { bar.className = `msg ${cls}`; bar.innerHTML = html; bar.hidden = false; } };
  show('warn', `Committed ${esc(label)}. Vercel is building; it is usually live within a minute or two…`);
  clearInterval(watching);
  watching = setInterval(async () => {
    try {
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.commit === sha) {
        clearInterval(watching);
        show('ok', `✓ ${esc(label)} is live: <a href="${esc(url)}" target="_blank" rel="noopener">${esc(location.origin + url)}</a>`);
        return;
      }
    } catch {}
    if (Date.now() - started > 6 * 60 * 1000) {
      clearInterval(watching);
      show('err', `${esc(label)} was committed to GitHub, but the site has not updated after 6 minutes. The build may have failed; check Deployments on Vercel. If a build fails, the site stays as it was.`);
    }
  }, 6000);
}
let watchToken = 0;

// ---------- 登录 ----------
function viewLogin(msg) {
  $('#who').innerHTML = '';
  app().innerHTML = `<div class="card login">
    <h1>dongxiv admin</h1>
    <p>Sign in with GitHub to upload PDFs, publish papers and new versions, and edit paper information. Only the repository owner can sign in.</p>
    ${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
    <a class="btn" href="/api/auth/login">Sign in with GitHub</a></div>`;
}

async function boot() {
  const failed = /^#login-failed=(.*)$/.exec(location.hash);
  if (failed) { history.replaceState(null, '', '/admin/'); return viewLogin(decodeURIComponent(failed[1])); }
  const token = readCookie(TOKEN_COOKIE);
  if (!token) return viewLogin();
  gh = new GitHub({ token, repo: SITE.repo, branch: SITE.branch, api: (import.meta.env.DEV && localStorage.getItem('dx-api')) || undefined });
  try {
    const [me, repo] = await Promise.all([gh.user(), gh.repoInfo()]);
    if (!repo.permissions?.push) {
      clearToken();
      return viewLogin(`${me.login} does not have write access to ${SITE.repo}. Make sure the GitHub App is installed on this repository.`);
    }
    S = { me };
    flag(true);
    $('#who').innerHTML = `${esc(me.login)} · <button class="link light" id="logout">Sign out</button>`;
    $('#logout').onclick = () => { clearToken(); flag(false); location.href = '/admin/'; };
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    if (e.auth) { clearToken(); return viewLogin('Your session has expired. Please sign in again.'); }
    app().innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
  }
}

async function refresh() {
  const { head, papers } = await gh.load();
  S.head = head;
  S.papers = papers;
}

// ---------- 论文列表 ----------
function viewList() {
  const rows = S.papers.map((p) => {
    if (p.error) return `<tr><td>${esc(p.id)}</td><td colspan="3" class="msg err">Could not read meta.yaml: ${esc(p.error)}</td></tr>`;
    const vs = p.meta.versions ?? [];
    return `<tr>
      <td><span class="idbox">${esc(SITE.name)}:${esc(p.id)}</span></td>
      <td><div class="t-title">${esc(p.meta.title)}</div><div class="muted">${esc((p.meta.authors || []).join(', '))} · ${esc(p.meta.primary_subject)}${p.meta.withdrawn ? ' · <b>withdrawn</b>' : ''}</div></td>
      <td class="vers">${vs.map((v, i) => `v${i + 1} <span class="muted">${esc(String(v.date).slice(0, 10))}</span>`).join('<br>')}</td>
      <td class="actions">
        <a href="/abs/${esc(p.id)}/" target="_blank" rel="noopener">View</a>
        <a href="#/version/${esc(p.id)}">New version</a>
        <a href="#/edit/${esc(p.id)}">Edit info</a>
        ${p.meta.withdrawn ? `<a href="#/withdraw/${esc(p.id)}">Restore</a>` : `<a href="#/withdraw/${esc(p.id)}">Withdraw</a>`}
      </td></tr>`;
  }).join('');
  app().innerHTML = `
    <h1>Papers</h1>
    ${S.papers.length ? `<table class="papers"><thead><tr><th>Identifier</th><th>Title</th><th>Versions</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="card">No papers yet. Click <a href="#/new">+ New paper</a> to start.</div>'}
    <p class="muted">Published PDFs cannot be replaced or deleted; post a new version instead. Use "Withdraw" to take a paper off the site; its identifier is kept.</p>`;
}

// ---------- 表单部件 ----------
function multiRows(name, values, kind) {
  const row = (v) => kind === 'link'
    ? `<div><input placeholder="Label, e.g. Code" data-k="label" value="${esc(v?.label)}"><input placeholder="https://…" data-k="url" value="${esc(v?.url)}"><button type="button" class="link danger" data-rm>Remove</button></div>`
    : `<div><input list="subject-list" placeholder="Type to pick a category" value="${esc(v)}"><button type="button" class="link danger" data-rm>Remove</button></div>`;
  return `<div class="multi" data-multi="${name}" data-kind="${kind}">${(values || []).map(row).join('')}<button type="button" class="link" data-add>+ Add</button></div>`;
}
function wireMulti(root) {
  root.querySelectorAll('[data-multi]').forEach((box) => {
    box.addEventListener('click', (e) => {
      if (e.target.matches('[data-rm]')) e.target.parentElement.remove();
      if (e.target.matches('[data-add]')) {
        const tmp = document.createElement('div');
        tmp.innerHTML = multiRows('x', [box.dataset.kind === 'link' ? {} : ''], box.dataset.kind);
        e.target.before(tmp.querySelector('.multi > div'));
      }
    });
  });
}
function readMulti(root, name) {
  const box = root.querySelector(`[data-multi="${name}"]`);
  return [...box.querySelectorAll(':scope > div')].map((d) => box.dataset.kind === 'link'
    ? { label: d.querySelector('[data-k=label]').value, url: d.querySelector('[data-k=url]').value }
    : d.querySelector('input').value).filter((v) => typeof v === 'string' ? v.trim() : (v.label.trim() || v.url.trim()));
}
const triSelect = (name, val) => `<select name="${name}">
  ${[['', 'Not stated'], ['yes', 'Yes'], ['partial', 'Partly'], ['no', 'No']].map(([v, t]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

function metaFields(m, { withdrawn = false } = {}) {
  const v = m.vibe || {};
  const fm = m.formal || {};
  return `
  <div class="row"><label>Title</label><div><input name="title" value="${esc(m.title)}"><div class="preview" data-prev="title"></div></div></div>
  <div class="row"><label>Authors</label><div><input name="authors" value="${esc((m.authors || [SITE.author]).join(', '))}"><div class="hint">Separate multiple authors with commas</div></div></div>
  <div class="row"><label>Abstract</label><div><textarea name="abstract">${esc(m.abstract)}</textarea>
    <div class="hint">Write math as $x^2$ or $$…$$; leave a blank line between paragraphs. Preview:</div><div class="preview" data-prev="abstract"></div></div></div>
  <div class="row"><label>Comments</label><div><input name="comments" value="${esc(m.comments)}"><div class="hint" id="comments-hint">e.g. 9 pages, 2 figures, 3 tables. The prefill only counts figures and tables with a “Figure N / Table N” caption; count uncaptioned ones yourself.</div></div></div>
  <div class="row"><label>Primary subject</label><div><input name="primary_subject" list="subject-list" value="${esc(m.primary_subject)}" placeholder="Type to pick an arXiv category"></div></div>
  <div class="row"><label>Cross-lists</label><div>${multiRows('subjects', m.subjects, 'subject')}</div></div>
  <div class="row"><label>Keywords</label><div><input name="keywords" value="${esc((m.keywords || []).join(', '))}"><div class="hint">Optional, comma-separated</div></div></div>
  <div class="row"><label>License</label><div><input name="license" value="${esc(m.license || SITE.defaultLicense)}"></div></div>
  <div class="row"><label>Links</label><div>${multiRows('links', m.links, 'link')}<div class="hint">Optional, e.g. a code repository</div></div></div>
  <h2>Formal proof (optional)</h2>
  <div class="row"><label>System</label><div><input name="formal_system" value="${esc(fm.system)}" placeholder="e.g. Lean 4 + Mathlib"></div></div>
  <div class="row"><label>Scope</label><div><input name="formal_scope" value="${esc(fm.scope)}" placeholder="e.g. all 5 main theorems (16 formal statements)"></div></div>
  <div class="row"><label>Source URL</label><div><input name="formal_url" value="${esc(fm.url)}" placeholder="https://github.com/…/tree/main/…"><div class="hint">Link to the Lean code, e.g. https://github.com/…/tree/main/…; a link to a fixed commit (on GitHub, press y) also works</div></div></div>
  <div class="row"><label>Note</label><div><input name="formal_note" value="${esc(fm.note)}" placeholder="Optional, e.g. what is not formalized"></div></div>
  <h2>AI involvement (optional; hidden if empty)</h2>
  <div class="row"><label>AI tools</label><div><input name="agents" value="${esc((v.agents || []).join(', '))}" placeholder="e.g. Claude Code"></div></div>
  <div class="row"><label>Models</label><div><input name="models" value="${esc((v.models || []).join(', '))}" placeholder="e.g. Claude Opus 5.5"></div></div>
  <div class="row"><label>Author's role</label><div><input name="human_role" value="${esc(v.human_role)}" placeholder="e.g. Problem, key ideas, checking of all derivations"></div></div>
  <div class="row"><label>Checking</label><div class="tri">
    <label>Checked by AI ${triSelect('machine_verified', v.machine_verified)}</label>
    <label>Checked by author ${triSelect('human_verified', v.human_verified)}</label>
    <label>Formally verified ${triSelect('formal_verified', v.formal_verified)}</label></div></div>
  <div class="row"><label>Materials</label><div>${multiRows('materials', v.materials, 'link')}<div class="hint">Code, data, AI session logs, etc.</div></div></div>
  <div class="row"><label>AI notes</label><div><input name="notes" value="${esc(v.notes)}"></div></div>
  ${withdrawn ? `<h2>Withdrawal</h2><div class="row"><label>Withdrawal note</label><div><input name="withdrawn" value="${esc(m.withdrawn)}"><div class="hint">Filling this in withdraws the paper: it disappears from the listings, feed and search engines; its abstract page stays reachable by direct link, with this note</div></div></div>` : ''}`;
}
function wirePreviews(root) {
  root.querySelectorAll('[data-prev]').forEach((p) => {
    const input = root.querySelector(`[name="${p.dataset.prev}"]`);
    let t;
    const upd = () => { p.textContent = input.value; math(p); };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(upd, 250); });
    upd();
  });
}
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
function readMeta(root) {
  const val = (n) => root.querySelector(`[name="${n}"]`)?.value ?? '';
  return {
    title: val('title'), authors: list(val('authors')), abstract: val('abstract'), comments: val('comments'),
    primary_subject: val('primary_subject'), subjects: readMulti(root, 'subjects'), keywords: list(val('keywords')),
    license: val('license'), links: readMulti(root, 'links'), withdrawn: val('withdrawn'),
    formal: { system: val('formal_system'), scope: val('formal_scope'), url: val('formal_url'), note: val('formal_note') },
    vibe: { agents: list(val('agents')), models: list(val('models')), human_role: val('human_role'),
      machine_verified: val('machine_verified'), human_verified: val('human_verified'), formal_verified: val('formal_verified'),
      materials: readMulti(root, 'materials'), notes: val('notes') },
  };
}

// PDF 拖放区：在浏览器里读取，计算 SHA-256，自动提取信息。文件在点"发布"之前不会离开浏览器。
function dropZone(onDone) {
  const box = document.createElement('div');
  box.innerHTML = `<div class="drop"><div class="big">Drop a PDF here, or click to choose a file</div><div class="muted">The file stays in your browser until you click Publish</div><input type="file" accept="application/pdf,.pdf" hidden></div><div class="pdfinfo"></div>`;
  const drop = box.querySelector('.drop'), input = box.querySelector('input'), info = box.querySelector('.pdfinfo');
  const handle = async (file) => {
    if (!file) return;
    info.innerHTML = `<span class="muted">Reading ${esc(file.name)}…</span>`;
    try {
      if (file.size > MAX_PDF) throw new Error(`File too large (limit ${MAX_PDF / 1024 / 1024} MB)`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('This is not a PDF file');
      const hash = await sha256(bytes);
      const dup = [];
      for (const p of S.papers) (p.meta?.versions ?? []).forEach((v, i) => { if (v.sha256 === hash) dup.push(`${p.id}v${i + 1}`); });
      let a = {};
      try { a = await analyzePdf(await pdfjs(), bytes); } catch (e) { console.warn('PDF auto-extraction failed', e); }
      const r = { bytes, sha256: hash, size: bytes.length, ...a };
      info.innerHTML = `<div class="msg ok">✓ ${esc(file.name)} · ${r.pages ?? '?'} pages · ${(r.size / 1024).toFixed(0)} KB<br><span class="muted">SHA-256</span> <code>${r.sha256}</code></div>
        ${dup.length ? `<div class="msg warn">This PDF is identical to ${esc(dup.join(', '))}.</div>` : ''}`;
      onDone(r);
    } catch (e) { info.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  drop.onclick = () => input.click();
  input.onchange = () => handle(input.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
  return box;
}

async function submit(btn, msgEl, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Publishing…'; msgEl.innerHTML = '';
  try { await fn(); } catch (e) {
    if (e.auth) { clearToken(); return viewLogin('Your session has expired. Please sign in again (the form will need to be filled in again).'); }
    msgEl.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    btn.disabled = false; btn.textContent = label;
  }
}
const CONFIRM = 'Publish now? The repository and the site are public: anyone will see this, and a published PDF cannot be taken back.';

// ---------- 新论文 ----------
function viewNew() {
  let upload = null;
  const today = todayUTC();
  app().innerHTML = `<h1>New paper</h1>
    <div class="card"><h2 style="margin-top:0">1. PDF (first version)</h2><div id="dz"></div></div>
    <form class="card" id="f" autocomplete="off">
      <h2 style="margin-top:0">2. Date and identifier</h2>
      <div class="row"><label>Date</label><div><input type="date" name="date" value="${today}" max="${today}">
        <div class="hint">Dates are in UTC (the identifier uses the UTC year and month). Today records the exact time; for an older paper, pick its original date and only the date is shown.</div></div></div>
      <div class="row"><label>Identifier</label><div><span class="idbox" id="newid">…</span><div id="idwarn"></div></div></div>
      <h2>3. Paper information</h2>
      ${metaFields({})}
      <div id="msg"></div>
      <button class="btn" id="save" type="submit">Publish</button>
    </form>`;
  const f = $('#f');
  wireMulti(f); wirePreviews(f);
  $('#dz').append(dropZone((r) => {
    upload = r;
    const set = (n, v) => { const el = f.querySelector(`[name="${n}"]`); if (v && !el.value.trim()) { el.value = v; el.dispatchEvent(new Event('input')); } };
    set('title', r.title); set('abstract', r.abstract); set('comments', r.comments);
    if (r.author && f.authors.value === SITE.author) f.authors.value = r.author;
  }));
  const updId = () => {
    try {
      normalizeDate(f.date.value);
      const r = nextId(S.papers.filter((p) => p.meta), f.date.value);
      $('#newid').textContent = `${SITE.name}:${r.id}`;
      $('#idwarn').innerHTML = r.warning ? `<div class="msg warn">${esc(r.warning)}</div>` : '';
    } catch (e) { $('#newid').textContent = '—'; $('#idwarn').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  };
  f.date.onchange = updId; updId();
  f.onsubmit = (e) => { e.preventDefault(); submit($('#save'), $('#msg'), async () => {
    if (!upload) throw new Error('Add a PDF above first');
    const meta = buildMeta(readMeta(f), SITE.defaultLicense);
    const entry = versionEntry({ date: f.date.value, sha256: upload.sha256, pages: upload.pages }, 1);
    if (!confirm(CONFIRM)) throw new Error('Cancelled; nothing was published');
    await refresh(); // 用最新的仓库状态分配编号
    const { id } = nextId(S.papers.filter((p) => p.meta), entry.date.slice(0, 10));
    const sha = await gh.commit(S.head, [
      { path: `papers/${id}/v1.pdf`, bytes: upload.bytes },
      { path: `papers/${id}/meta.yaml`, text: yaml({ ...meta, versions: [entry] }) },
    ], `Publish ${SITE.name}:${id}v1`);
    watchDeploy(sha, `${SITE.name}:${id}v1`, `/abs/${id}/`);
    await refresh(); location.hash = '#/';
  }); };
}

// ---------- 新版本 ----------
function viewVersion(id) {
  const p = S.papers.find((x) => x.id === id && x.meta);
  if (!p) return (app().innerHTML = '<div class="msg err">No such paper</div>');
  const vs = p.meta.versions;
  const n = vs.length + 1;
  const prev = String(vs[n - 2].date);
  const today = todayUTC();
  let upload = null;
  app().innerHTML = `<h1>New version: ${esc(SITE.name)}:${esc(id)}v${n}</h1>
    <p class="muted">${esc(p.meta.title)} · latest is v${n - 1} (${esc(prev.slice(0, 10))}). Published PDFs are never replaced.</p>
    <div class="card"><h2 style="margin-top:0">1. New PDF</h2><div id="dz"></div></div>
    <form class="card" id="f" autocomplete="off">
      <h2 style="margin-top:0">2. Version details</h2>
      <div class="row"><label>Date</label><div><input type="date" name="date" value="${today}" max="${today}"><div class="hint">In UTC; must be later than v${n - 1}</div></div></div>
      <div class="row"><label>Change note</label><div><input name="note" placeholder="e.g. Added Section 4 and fixed a sign error in (3.2)"><div class="hint">Optional; shown in the version history</div></div></div>
      <details id="metabox"><summary>Also edit paper information (title, abstract, Comments, etc. follow the latest version)</summary>${metaFields(p.meta, { withdrawn: true })}</details>
      <div id="msg"></div>
      <button class="btn" id="save" type="submit">Publish v${n}</button>
    </form>`;
  const f = $('#f');
  wireMulti(f); wirePreviews(f);
  $('#dz').append(dropZone((r) => {
    upload = r;
    if (r.comments && r.comments !== f.comments.value) {
      $('#comments-hint').innerHTML = `The new PDF reads as <b>${esc(r.comments)}</b> · <button type="button" class="link" id="usec">Use this</button>`;
      $('#usec').onclick = () => { f.comments.value = r.comments; $('#metabox').open = true; };
    }
  }));
  f.onsubmit = (e) => { e.preventDefault(); submit($('#save'), $('#msg'), async () => {
    if (!upload) throw new Error('Add the new PDF above first');
    const meta = buildMeta(readMeta(f), SITE.defaultLicense);
    const entry = versionEntry({ date: f.date.value, sha256: upload.sha256, pages: upload.pages, note: f.note.value }, n);
    if (Date.parse(entry.date) <= Date.parse(prev)) throw new Error(`The new version's date must be later than v${n - 1} (${prev.slice(0, 10)})`);
    if (!confirm(CONFIRM)) throw new Error('Cancelled; nothing was published');
    const sha = await gh.commit(S.head, [
      { path: `papers/${id}/v${n}.pdf`, bytes: upload.bytes },
      { path: `papers/${id}/meta.yaml`, text: yaml({ ...meta, versions: [...vs, entry] }) },
    ], `Publish ${SITE.name}:${id}v${n}`);
    watchDeploy(sha, `${SITE.name}:${id}v${n}`, `/abs/${id}v${n}/`);
    await refresh(); location.hash = '#/';
  }); };
}

// ---------- 修改信息 ----------
function viewEdit(id) {
  const p = S.papers.find((x) => x.id === id && x.meta);
  if (!p) return (app().innerHTML = '<div class="msg err">No such paper</div>');
  app().innerHTML = `<h1>Edit info: ${esc(SITE.name)}:${esc(id)}</h1>
    <p class="muted">Changes text information only; PDFs and version history stay the same. To change the PDF, post a <a href="#/version/${esc(id)}">new version</a>.</p>
    <form class="card" id="f" autocomplete="off">${metaFields(p.meta, { withdrawn: true })}
      <div id="msg"></div><button class="btn" id="save" type="submit">Publish changes</button></form>`;
  const f = $('#f');
  wireMulti(f); wirePreviews(f);
  f.onsubmit = (e) => { e.preventDefault(); submit($('#save'), $('#msg'), async () => {
    const text = yaml({ ...buildMeta(readMeta(f), SITE.defaultLicense), versions: p.meta.versions });
    if (text === yaml(p.meta)) throw new Error('Nothing has changed');
    if (!confirm(CONFIRM)) throw new Error('Cancelled; nothing was published');
    const sha = await gh.commit(S.head, [{ path: `papers/${id}/meta.yaml`, text }], `Update ${SITE.name}:${id}`);
    watchDeploy(sha, `changes to ${SITE.name}:${id}`, `/abs/${id}/`);
    await refresh(); location.hash = '#/';
  }); };
}

// ---------- 撤稿 / 恢复 ----------
// 撤稿：论文从网站列表、订阅和搜索引擎中撤下；摘要页保留（显示撤稿说明），编号不再分配给别的论文
function withMeta(meta, note) {
  const { versions, withdrawn, ...rest } = meta;
  return { ...rest, ...(note ? { withdrawn: note } : {}), versions };
}
function viewWithdraw(id) {
  const p = S.papers.find((x) => x.id === id && x.meta);
  if (!p) return (app().innerHTML = '<div class="msg err">No such paper</div>');
  const restoring = !!p.meta.withdrawn;
  app().innerHTML = restoring ? `<h1>Restore ${esc(SITE.name)}:${esc(id)}</h1>
    <div class="card"><p class="t-title">${esc(p.meta.title)}</p>
      <p>This paper is withdrawn: <i>${esc(p.meta.withdrawn)}</i></p>
      <p class="muted">Restoring removes the withdrawal note and lists the paper on the site again.</p>
      <div id="msg"></div><button class="btn" id="save">Restore paper</button></div>`
    : `<h1>Withdraw ${esc(SITE.name)}:${esc(id)}</h1>
    <form class="card" id="f" autocomplete="off"><p class="t-title">${esc(p.meta.title)}</p>
      <p class="muted">The paper disappears from the listings, the feed and search engines. Its abstract page stays reachable by direct link and shows the note below, so existing links and citations still work. The identifier is never reused. You can restore it later.</p>
      <div class="row"><label>Withdrawal note</label><div><input name="note" placeholder="e.g. The proof of Theorem 3 contains an error."><div class="hint">Required; shown on the abstract page</div></div></div>
      <div id="msg"></div><button class="btn" id="save" type="submit">Withdraw paper</button></form>`;
  const go = () => submit($('#save'), $('#msg'), async () => {
    const note = restoring ? '' : $('#f').note.value.trim();
    if (!restoring && !note) throw new Error('Write a short withdrawal note first');
    if (!confirm(restoring ? 'Restore this paper on the site?' : 'Withdraw this paper from the site?')) throw new Error('Cancelled; nothing was published');
    const sha = await gh.commit(S.head, [{ path: `papers/${id}/meta.yaml`, text: yaml(withMeta(p.meta, note)) }],
      `${restoring ? 'Restore' : 'Withdraw'} ${SITE.name}:${id}`);
    watchDeploy(sha, `${restoring ? 'restore' : 'withdrawal'} of ${SITE.name}:${id}`, `/abs/${id}/`);
    await refresh(); location.hash = '#/';
  });
  if (restoring) $('#save').onclick = go;
  else $('#f').onsubmit = (e) => { e.preventDefault(); go(); };
}

// ---------- 路由 ----------
async function route() {
  try { await refresh(); } catch (e) {
    if (e.auth) { clearToken(); return viewLogin('Your session has expired. Please sign in again.'); }
    app().innerHTML = `<div class="msg err">Could not read the repository: ${esc(e.message)}</div>`; return;
  }
  const [, view, id] = location.hash.replace(/^#/, '').split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (view || 'list')));
  if (view === 'new') viewNew();
  else if (view === 'version') viewVersion(id);
  else if (view === 'edit') viewEdit(id);
  else if (view === 'withdraw') viewWithdraw(id);
  else viewList();
  window.scrollTo(0, 0);
}

document.getElementById('subject-list').innerHTML = SUBJECTS.map((s) => `<option value="${esc(s.name)}">${esc(s.code)}</option>`).join('');
boot();
