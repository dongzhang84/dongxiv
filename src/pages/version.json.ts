// 当前线上版本对应的 commit。在线后台发布后靠它判断新内容是否已经上线。
import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null }), {
    headers: { 'Content-Type': 'application/json' },
  });
