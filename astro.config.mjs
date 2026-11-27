import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import site from './site.config.mjs';

// 网站本身全部是静态页面；只有在线后台的 GitHub 登录（src/pages/api/auth/*）在 Vercel 上按需运行。
export default defineConfig({
  site: site.baseUrl,
  build: { format: 'directory' },
  adapter: vercel(),
});
