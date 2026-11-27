# Changelog

## 2026-11-26

- **去掉搜索**：论文数量少，搜索页多余；删掉搜索页、`search.json` 和导航里的 Search，作者名不再链到搜索。
- **首页改为按时间排列的列表**：按首次发布日分组（例如 "Tue, 3 Nov 2026 (1 entry)"），每条是 `[1] dongxiv:YYMM.NNNN [abs, pdf]`、标题、作者、Comments、Subjects；上方一行按学科浏览。`/list/` 并入首页，学科页 `/list/<学科>/` 保留。
- **UI 改为贴近 arXiv 的版式**（原版和 liuxiv 太像）：
  - 顶栏改为全宽深蓝导航条：左边字标，右边 Search / Recent / About / Feed。
  - 首页改为 arXiv 首页的结构：简介、搜索框、按学科浏览（每个学科有 recent、search）、最新论文。去掉了编号说明和按月跳转。
  - 新增列表页 `/list/`（全部）和 `/list/<学科>/`："Authors and titles for recent submissions"、日期索引、按日分组，条目不显示摘要。
  - 摘要页改为左右两栏：学科条、Submitted on 日期行、标题、作者、摘要、元数据表、Submission history；右栏是 Access Paper、Current browse context、Export BibTeX Citation。
  - 去掉 ✓◐✗ 验证框：AI 信息并入元数据表（AI tools、Author's role、Checking 用一句话说明、Materials）；SHA-256 收进可折叠的 "SHA-256 checksums of the PDFs"。
  - 字体换成 IBM Plex Sans；去掉深色模式。
- **阶段 1：本地原型（Astro 7.4.7）**
  - 首页按首次发布日分组列出论文，顶部按月跳转；每条显示编号、[abs, pdf]、标题、作者、Comments、Subjects、摘要。
  - 摘要页 `/abs/<id>/`（最新版）和 `/abs/<id>vN/`（指定版本）：日期行、摘要（KaTeX 渲染公式）、"How this paper was made"、元数据表、版本历史（UTC 时间、页数、SHA-256）；侧栏有 PDF 下载、BibTeX 一键复制、哈希、上一篇/下一篇。旧版本页面有提示条，撤稿论文有撤稿说明。
  - PDF 原样输出到 `/pdf/<id>vN.pdf` 和 `/pdf/<id>.pdf`（最新版）。
  - 构建时校验每篇 `meta.yaml` 的格式和每个 PDF 的 SHA-256，对不上就构建失败。
  - About 页（vibe research、验证标记、编号规则、怎么核对哈希）、搜索页（浏览器端搜索，包括工具和模型）、Atom 订阅、sitemap、robots.txt、Google Scholar 的 `citation_*` 标签、404 页。
  - 主色深蓝 `#26456e`，自己的字标和 favicon，页脚注明与 arXiv 无关；手机端和深色模式适配。
  - 三篇示例论文（demo），正式上线前删除。
- **计划书更新**：技术栈定为 Astro，元数据改用 YAML，主色和 vibe 字段已定。
- **建仓库**：GitHub 公开仓库 `dongzhang84/dongxiv`，分支 `main`；本地文件夹从 `dong-arxiv` 改名为 `dongxiv`。
- **计划书**：`docs/proposal.md`，写了目标、架构（GitHub + Vercel，不用数据库）、编号规则 `dongxiv:YYMM.NNNN`、数据结构、页面、UI 原则、本地发布后台、可信度、实施阶段和待讨论清单。
  - 仓库改为公开后同步修改：TeX 源码和私人材料不放进本仓库。
- **基础文件**：`README.md`、`.gitignore`（排除 `.env`、`node_modules`、构建产物等）。
