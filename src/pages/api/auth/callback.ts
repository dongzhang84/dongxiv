// 在线后台登录第二步：用 GitHub 返回的 code 换取令牌，确认是仓库主人后交给 /admin/ 页面。
// 令牌来自只装在 dongxiv 仓库上的 GitHub App，只能改这一个仓库，8 小时后失效。
import type { APIRoute } from 'astro';
import site from '../../../../site.config.mjs';

export const prerender = false;

const OWNER = new URL(site.repoUrl).pathname.split('/')[1].toLowerCase();

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const back = (why: string) => redirect(`/admin/#login-failed=${encodeURIComponent(why)}`, 302);
  const state = cookies.get('dx_oauth_state')?.value;
  cookies.delete('dx_oauth_state', { path: '/api/auth/' });
  const code = url.searchParams.get('code');
  if (!code || !state || url.searchParams.get('state') !== state) return back('登录已过期，请重试');

  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/auth/callback`,
    }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!tok.access_token) return back(`GitHub 没有给出令牌：${tok.error_description || tok.error || r.status}`);

  const u = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dongxiv-admin' },
  });
  const user = await u.json().catch(() => ({}));
  if (String(user.login ?? '').toLowerCase() !== OWNER) return back(`只有 ${OWNER} 可以使用后台`);

  // 不设 httpOnly：后台页面要在浏览器里直接调用 GitHub API（PDF 不经过 Vercel，没有 4.5 MB 限制）
  cookies.set('dx_gh', tok.access_token, {
    path: '/admin/', secure: url.protocol === 'https:', sameSite: 'strict',
    maxAge: Math.min(Number(tok.expires_in) || 28800, 28800),
  });
  return redirect('/admin/', 302);
};
