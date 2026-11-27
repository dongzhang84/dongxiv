// 在线后台：在浏览器里直接读写 GitHub 仓库（Git Data API）。
// 每次发布 = 一个 commit，直接推到 main；Vercel 看到新 commit 会自动重新构建。
import YAML from 'yaml';
import { ID_RE, fail } from './meta.js';

export class GitHub {
  constructor({ token, repo, branch = 'main', api = 'https://api.github.com' }) {
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.api = api;
  }

  async req(method, path, body, accept = 'application/vnd.github+json') {
    const r = await fetch(`${this.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (r.status === 401) { const e = new Error('登录已过期，请重新登录'); e.auth = true; throw e; }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const e = new Error(`GitHub 返回 ${r.status}：${j.message || r.statusText}`);
      e.status = r.status;
      throw e;
    }
    return accept.includes('raw') ? r.text() : r.json();
  }

  user() { return this.req('GET', '/user'); }
  repoInfo() { return this.req('GET', `/repos/${this.repo}`); }

  /** 读取 main 最新 commit 下的全部论文 */
  async load() {
    const ref = await this.req('GET', `/repos/${this.repo}/git/ref/heads/${this.branch}`);
    const head = ref.object.sha;
    const tree = await this.req('GET', `/repos/${this.repo}/git/trees/${head}?recursive=1`);
    if (tree.truncated) fail('仓库文件太多，GitHub 没有返回完整列表');
    const ids = [...new Set(tree.tree
      .map((e) => /^papers\/([^/]+)\/meta\.yaml$/.exec(e.path)?.[1])
      .filter((id) => id && ID_RE.test(id)))];
    const papers = await Promise.all(ids.map(async (id) => {
      try {
        const text = await this.req('GET', `/repos/${this.repo}/contents/papers/${id}/meta.yaml?ref=${head}`, null, 'application/vnd.github.raw+json');
        return { id, meta: YAML.parse(text) };
      } catch (e) {
        if (e.auth) throw e;
        return { id, error: e.message };
      }
    }));
    papers.sort((a, b) => b.id.localeCompare(a.id));
    return { head, papers };
  }

  /**
   * 一次提交多个文件。files: [{ path, text } | { path, bytes: Uint8Array }]
   * parent 是读取时的 commit；如果期间仓库被别处改过，GitHub 会拒绝（不会覆盖别人的改动）。
   */
  async commit(parent, files, message) {
    const base = await this.req('GET', `/repos/${this.repo}/git/commits/${parent}`);
    const entries = [];
    for (const f of files) {
      const blob = f.bytes
        ? await this.req('POST', `/repos/${this.repo}/git/blobs`, { content: toBase64(f.bytes), encoding: 'base64' })
        : await this.req('POST', `/repos/${this.repo}/git/blobs`, { content: f.text, encoding: 'utf-8' });
      entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await this.req('POST', `/repos/${this.repo}/git/trees`, { base_tree: base.tree.sha, tree: entries });
    const c = await this.req('POST', `/repos/${this.repo}/git/commits`, { message, tree: tree.sha, parents: [parent] });
    try {
      await this.req('PATCH', `/repos/${this.repo}/git/refs/heads/${this.branch}`, { sha: c.sha, force: false });
    } catch (e) {
      if (e.status === 422) fail('仓库在这期间被别处改过（比如本地后台刚发布过）。刷新页面后再试一次。');
      throw e;
    }
    return c.sha;
  }
}

function toBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}
