// 在线后台登录第一步：跳到 GitHub 授权页。只在 Vercel 上按需运行。
import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = ({ url, cookies, redirect }) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return new Response('GITHUB_CLIENT_ID is not set on the server.', { status: 500 });
  const state = crypto.randomUUID();
  cookies.set('dx_oauth_state', state, {
    path: '/api/auth/', httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', maxAge: 600,
  });
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${url.origin}/api/auth/callback`);
  auth.searchParams.set('state', state);
  return redirect(auth.toString(), 302);
};
