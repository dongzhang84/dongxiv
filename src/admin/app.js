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
  show('warn', `已提交 ${esc(label)}，Vercel 正在构建，通常一两分钟后上线…`);
  clearInterval(watching);
  watching = setInterval(async () => {
    try {
      const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.commit === sha) {
        clearInterval(watching);
        show('ok', `✓ ${esc(label)} 已上线：<a href="${esc(url)}" target="_blank" rel="noopener">${esc(location.origin + url)}</a>`);
        return;
      }
    } catch {}
    if (Date.now() - started > 6 * 60 * 1000) {
      clearInterval(watching);
      show('err', `${esc(label)} 已提交到 GitHub，但 6 分钟后线上还没更新。可能构建失败了，去 Vercel 的 Deployments 页面看一下。构建失败时网站保持原样。`);
    }
  }, 6000);
}
let watchToken = 0;

// ---------- 登录 ----------
function viewLogin(msg) {
  $('#who').innerHTML = '';
  app().innerHTML = `<div class="card login">
    <h1>dongxiv 发布后台</h1>
    <p>用 GitHub 登录后，可以在这里上传 PDF 发布论文、发新版本、修改信息。只有仓库主人能登录。</p>
    ${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
    <a class="btn" href="/api/auth/login">用 GitHub 登录</a></div>`;
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
      return viewLogin(`${me.login} 没有 ${SITE.repo} 的写权限。请确认 GitHub App 已安装到这个仓库。`);
    }
    S = { me };
    flag(true);
    $('#who').innerHTML = `${esc(me.login)} · <button class="link light" id="logout">退出</button>`;
    $('#logout').onclick = () => { clearToken(); flag(false); location.href = '/admin/'; };
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    if (e.auth) { clearToken(); return viewLogin('登录已过期，请重新登录'); }
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
    if (p.error) return `<tr><td>${esc(p.id)}</td><td colspan="3" class="msg err">meta.yaml 读取失败：${esc(p.error)}</td></tr>`;
    const vs = p.meta.versions ?? [];
    return `<tr>
      <td><span class="idbox">${esc(SITE.name)}:${esc(p.id)}</span></td>
      <td><div class="t-title">${esc(p.meta.title)}</div><div class="muted">${esc((p.meta.authors || []).join(', '))} · ${esc(p.meta.primary_subject)}${p.meta.withdrawn ? ' · <b>已撤稿</b>' : ''}</div></td>
      <td class="vers">${vs.map((v, i) => `v${i + 1} <span class="muted">${esc(String(v.date).slice(0, 10))}</span>`).join('<br>')}</td>
      <td class="actions">
        <a href="/abs/${esc(p.id)}/" target="_blank" rel="noopener">查看</a>
        <a href="#/version/${esc(p.id)}">发新版本</a>
        <a href="#/edit/${esc(p.id)}">修改信息</a>
      </td></tr>`;
  }).join('');
  app().innerHTML = `
    <h1>论文</h1>
    ${S.papers.length ? `<table class="papers"><thead><tr><th>编号</th><th>标题</th><th>版本</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<div class="card">还没有论文。点右上角 <a href="#/new">+ 新论文</a> 开始。</div>'}
    <p class="muted">已发布的 PDF 不能替换或删除，只能发新版本；要撤稿，在"修改信息"里填撤稿说明。</p>`;
}

// ---------- 表单部件 ----------
function multiRows(name, values, kind) {
  const row = (v) => kind === 'link'
    ? `<div><input placeholder="名称，如 Code" data-k="label" value="${esc(v?.label)}"><input placeholder="https://…" data-k="url" value="${esc(v?.url)}"><button type="button" class="link danger" data-rm>删除</button></div>`
    : `<div><input list="subject-list" placeholder="输入关键字选择分类" value="${esc(v)}"><button type="button" class="link danger" data-rm>删除</button></div>`;
  return `<div class="multi" data-multi="${name}" data-kind="${kind}">${(values || []).map(row).join('')}<button type="button" class="link" data-add>+ 添加</button></div>`;
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
  ${[['', '未说明'], ['yes', '是'], ['partial', '部分'], ['no', '否']].map(([v, t]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;

function metaFields(m, { withdrawn = false } = {}) {
  const v = m.vibe || {};
  return `
  <div class="row"><label>标题</label><div><input name="title" value="${esc(m.title)}"><div class="preview" data-prev="title"></div></div></div>
  <div class="row"><label>作者</label><div><input name="authors" value="${esc((m.authors || [SITE.author]).join(', '))}"><div class="hint">多位作者用英文逗号分隔</div></div></div>
  <div class="row"><label>摘要</label><div><textarea name="abstract">${esc(m.abstract)}</textarea>
    <div class="hint">公式写成 $x^2$ 或 $$…$$；空一行分段。下面是预览：</div><div class="preview" data-prev="abstract"></div></div></div>
  <div class="row"><label>Comments</label><div><input name="comments" value="${esc(m.comments)}"><div class="hint" id="comments-hint">例如 9 pages, 2 figures, 3 tables。自动预填只统计带 “Figure N / Table N” 标题的图表，附录里没标题的表格要自己数一下。</div></div></div>
  <div class="row"><label>主学科</label><div><input name="primary_subject" list="subject-list" value="${esc(m.primary_subject)}" placeholder="输入关键字选择 arXiv 分类"></div></div>
  <div class="row"><label>交叉学科</label><div>${multiRows('subjects', m.subjects, 'subject')}</div></div>
  <div class="row"><label>关键词</label><div><input name="keywords" value="${esc((m.keywords || []).join(', '))}"><div class="hint">选填，英文逗号分隔</div></div></div>
  <div class="row"><label>许可证</label><div><input name="license" value="${esc(m.license || SITE.defaultLicense)}"></div></div>
  <div class="row"><label>链接</label><div>${multiRows('links', m.links, 'link')}<div class="hint">选填，例如代码仓库</div></div></div>
  <h2>AI 参与（选填，不填就不显示）</h2>
  <div class="row"><label>AI 工具</label><div><input name="agents" value="${esc((v.agents || []).join(', '))}" placeholder="例如 Claude Code"></div></div>
  <div class="row"><label>模型</label><div><input name="models" value="${esc((v.models || []).join(', '))}" placeholder="例如 Claude Opus 5.5"></div></div>
  <div class="row"><label>你的角色</label><div><input name="human_role" value="${esc(v.human_role)}" placeholder="例如 Problem, key ideas, checking of all derivations"></div></div>
  <div class="row"><label>Checking</label><div class="tri">
    <label>AI 检查 ${triSelect('machine_verified', v.machine_verified)}</label>
    <label>本人检查 ${triSelect('human_verified', v.human_verified)}</label>
    <label>形式化验证 ${triSelect('formal_verified', v.formal_verified)}</label></div></div>
  <div class="row"><label>材料</label><div>${multiRows('materials', v.materials, 'link')}<div class="hint">代码、数据、对话记录等</div></div></div>
  <div class="row"><label>AI 备注</label><div><input name="notes" value="${esc(v.notes)}"></div></div>
  ${withdrawn ? `<h2>撤稿</h2><div class="row"><label>撤稿说明</label><div><input name="withdrawn" value="${esc(m.withdrawn)}"><div class="hint">填了就表示撤稿；论文页面和编号保留</div></div></div>` : ''}`;
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
    vibe: { agents: list(val('agents')), models: list(val('models')), human_role: val('human_role'),
      machine_verified: val('machine_verified'), human_verified: val('human_verified'), formal_verified: val('formal_verified'),
      materials: readMulti(root, 'materials'), notes: val('notes') },
  };
}

// PDF 拖放区：在浏览器里读取，计算 SHA-256，自动提取信息。文件在点"发布"之前不会离开浏览器。
function dropZone(onDone) {
  const box = document.createElement('div');
  box.innerHTML = `<div class="drop"><div class="big">把 PDF 拖到这里，或点击选择文件</div><div class="muted">点"发布"之前，文件不会离开你的浏览器</div><input type="file" accept="application/pdf,.pdf" hidden></div><div class="pdfinfo"></div>`;
  const drop = box.querySelector('.drop'), input = box.querySelector('input'), info = box.querySelector('.pdfinfo');
  const handle = async (file) => {
    if (!file) return;
    info.innerHTML = `<span class="muted">正在读取 ${esc(file.name)}…</span>`;
    try {
      if (file.size > MAX_PDF) throw new Error(`文件太大（上限 ${MAX_PDF / 1024 / 1024} MB）`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('这不是 PDF 文件');
      const hash = await sha256(bytes);
      const dup = [];
      for (const p of S.papers) (p.meta?.versions ?? []).forEach((v, i) => { if (v.sha256 === hash) dup.push(`${p.id}v${i + 1}`); });
      let a = {};
      try { a = await analyzePdf(await pdfjs(), bytes); } catch (e) { console.warn('PDF 自动提取失败', e); }
      const r = { bytes, sha256: hash, size: bytes.length, ...a };
      info.innerHTML = `<div class="msg ok">✓ ${esc(file.name)} · ${r.pages ?? '?'} 页 · ${(r.size / 1024).toFixed(0)} KB<br><span class="muted">SHA-256</span> <code>${r.sha256}</code></div>
        ${dup.length ? `<div class="msg warn">这个 PDF 和已有的 ${esc(dup.join(', '))} 完全相同。</div>` : ''}`;
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
  btn.disabled = true; btn.textContent = '发布中…'; msgEl.innerHTML = '';
  try { await fn(); } catch (e) {
    if (e.auth) { clearToken(); return viewLogin('登录已过期，请重新登录（表单内容需要重新填写）'); }
    msgEl.innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
    btn.disabled = false; btn.textContent = label;
  }
}
const CONFIRM = '确定发布？仓库和网站都是公开的，提交后任何人都能看到，已发布的 PDF 不能撤回。';

// ---------- 新论文 ----------
function viewNew() {
  let upload = null;
  const today = todayUTC();
  app().innerHTML = `<h1>新论文</h1>
    <div class="card"><h2 style="margin-top:0">1. PDF（第一版）</h2><div id="dz"></div></div>
    <form class="card" id="f" autocomplete="off">
      <h2 style="margin-top:0">2. 发布日期和编号</h2>
      <div class="row"><label>发布日期</label><div><input type="date" name="date" value="${today}" max="${today}">
        <div class="hint">日期按 UTC 计算（编号也按 UTC 的年月）。默认今天，会记录精确时间；补录以前的论文就选当时的日期，页面上只显示日期。</div></div></div>
      <div class="row"><label>编号</label><div><span class="idbox" id="newid">…</span><div id="idwarn"></div></div></div>
      <h2>3. 论文信息</h2>
      ${metaFields({})}
      <div id="msg"></div>
      <button class="btn" id="save" type="submit">发布</button>
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
    if (!upload) throw new Error('请先在上面放入 PDF');
    const meta = buildMeta(readMeta(f), SITE.defaultLicense);
    const entry = versionEntry({ date: f.date.value, sha256: upload.sha256, pages: upload.pages }, 1);
    if (!confirm(CONFIRM)) throw new Error('已取消，没有发布');
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
  if (!p) return (app().innerHTML = '<div class="msg err">没有这篇论文</div>');
  const vs = p.meta.versions;
  const n = vs.length + 1;
  const prev = String(vs[n - 2].date);
  const today = todayUTC();
  let upload = null;
  app().innerHTML = `<h1>发新版本：${esc(SITE.name)}:${esc(id)}v${n}</h1>
    <p class="muted">${esc(p.meta.title)} · 当前最新 v${n - 1}（${esc(prev.slice(0, 10))}）。已发布的 PDF 不会被替换。</p>
    <div class="card"><h2 style="margin-top:0">1. 新 PDF</h2><div id="dz"></div></div>
    <form class="card" id="f" autocomplete="off">
      <h2 style="margin-top:0">2. 版本信息</h2>
      <div class="row"><label>发布日期</label><div><input type="date" name="date" value="${today}" max="${today}"><div class="hint">按 UTC 计算，必须晚于 v${n - 1}</div></div></div>
      <div class="row"><label>修改说明</label><div><input name="note" placeholder="例如 Added Section 4 and fixed a sign error in (3.2)"><div class="hint">选填，显示在版本历史里</div></div></div>
      <details id="metabox"><summary>同时修改论文信息（标题、摘要、Comments 等以最新版本为准）</summary>${metaFields(p.meta, { withdrawn: true })}</details>
      <div id="msg"></div>
      <button class="btn" id="save" type="submit">发布 v${n}</button>
    </form>`;
  const f = $('#f');
  wireMulti(f); wirePreviews(f);
  $('#dz').append(dropZone((r) => {
    upload = r;
    if (r.comments && r.comments !== f.comments.value) {
      $('#comments-hint').innerHTML = `新 PDF 读出来是 <b>${esc(r.comments)}</b> · <button type="button" class="link" id="usec">用这个</button>`;
      $('#usec').onclick = () => { f.comments.value = r.comments; $('#metabox').open = true; };
    }
  }));
  f.onsubmit = (e) => { e.preventDefault(); submit($('#save'), $('#msg'), async () => {
    if (!upload) throw new Error('请先在上面放入新 PDF');
    const meta = buildMeta(readMeta(f), SITE.defaultLicense);
    const entry = versionEntry({ date: f.date.value, sha256: upload.sha256, pages: upload.pages, note: f.note.value }, n);
    if (Date.parse(entry.date) <= Date.parse(prev)) throw new Error(`新版本的日期必须晚于 v${n - 1}（${prev.slice(0, 10)}）`);
    if (!confirm(CONFIRM)) throw new Error('已取消，没有发布');
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
  if (!p) return (app().innerHTML = '<div class="msg err">没有这篇论文</div>');
  app().innerHTML = `<h1>修改信息：${esc(SITE.name)}:${esc(id)}</h1>
    <p class="muted">只改文字信息，PDF 和版本历史不变。要换 PDF 请 <a href="#/version/${esc(id)}">发新版本</a>。</p>
    <form class="card" id="f" autocomplete="off">${metaFields(p.meta, { withdrawn: true })}
      <div id="msg"></div><button class="btn" id="save" type="submit">发布修改</button></form>`;
  const f = $('#f');
  wireMulti(f); wirePreviews(f);
  f.onsubmit = (e) => { e.preventDefault(); submit($('#save'), $('#msg'), async () => {
    const text = yaml({ ...buildMeta(readMeta(f), SITE.defaultLicense), versions: p.meta.versions });
    if (text === yaml(p.meta)) throw new Error('没有改动');
    if (!confirm(CONFIRM)) throw new Error('已取消，没有发布');
    const sha = await gh.commit(S.head, [{ path: `papers/${id}/meta.yaml`, text }], `Update ${SITE.name}:${id}`);
    watchDeploy(sha, `${SITE.name}:${id} 的修改`, `/abs/${id}/`);
    await refresh(); location.hash = '#/';
  }); };
}

// ---------- 路由 ----------
async function route() {
  try { await refresh(); } catch (e) {
    if (e.auth) { clearToken(); return viewLogin('登录已过期，请重新登录'); }
    app().innerHTML = `<div class="msg err">读取仓库失败：${esc(e.message)}</div>`; return;
  }
  const [, view, id] = location.hash.replace(/^#/, '').split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (view || 'list')));
  if (view === 'new') viewNew();
  else if (view === 'version') viewVersion(id);
  else if (view === 'edit') viewEdit(id);
  else viewList();
  window.scrollTo(0, 0);
}

document.getElementById('subject-list').innerHTML = SUBJECTS.map((s) => `<option value="${esc(s.name)}">${esc(s.code)}</option>`).join('');
boot();
