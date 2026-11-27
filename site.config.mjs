// 站点配置。改完后重新运行 `npm run dev` 或 `npm run build` 生效。
export default {
  // 站点名，也是编号前缀：dongxiv:YYMM.NNNN。发布第一篇真实论文后不要再改。
  name: 'dongxiv',
  tagline: 'Vibe research papers',
  // 默认作者名（发布后台会自动填进新论文）
  author: 'Dong',
  // 部署后的根地址，不带结尾斜杠；用于 BibTeX、RSS、Google Scholar 标签。买了域名后改这里。
  baseUrl: 'https://dongxiv.vercel.app',
  // true：允许搜索引擎和 Google Scholar 收录；false：全站加 noindex
  indexable: true,
  defaultLicense: 'CC BY 4.0',
  repoUrl: 'https://github.com/dongzhang84/dongxiv',
  // 首页简介，支持 [文字](链接) 和 *斜体*
  intro:
    'A personal archive of research papers produced through *vibe research*: the problems, ideas and judgement are human; much of the exploration, computation and writing is done together with AI systems. Each paper has a permanent identifier and a public version history with the SHA-256 hash of every PDF.',
};
