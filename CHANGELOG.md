# Changelog

## 2026-11-26

- **撤稿的论文从网站上撤下**：不再出现在首页、学科页、Most recent、Atom 订阅和 sitemap 里，也不参与上一篇/下一篇；摘要页保留（旧链接和引用仍能打开），显示撤稿说明，加 noindex，去掉 Google Scholar 标签。
- **后台界面改为英文**：在线后台和本地后台（`npm run admin`）的所有页面、提示和报错，以及构建时的校验报错（格式、哈希、日期、编号、学科）。
- **在线后台** `https://dongxiv.vercel.app/admin/`：用 GitHub 登录（只限 dongzhang84）后，在网站上上传 PDF、发布新论文和新版本、修改信息。每次点"发布"就提交到 GitHub，Vercel 自动上线，页面显示上线进度。
  - PDF 在浏览器里读取（pdf.js）：页数、SHA-256、标题、摘要、图表数预填，和本地后台规则一致。
  - PDF 由浏览器直接传给 GitHub，不经过 Vercel，没有 4.5 MB 限制。
  - 令牌来自只装在 dongxiv 仓库上的 GitHub App，8 小时失效；服务器不保存令牌。
  - 网站顶栏的 Submit 按钮只在登录过后台的浏览器里显示。
  - 接入 `@astrojs/vercel`：页面仍全部静态生成，只有 `/api/auth/*` 两个登录接口在服务器上运行。新增 `/version.json`（线上版本对应的 commit）。
  - robots.txt 屏蔽 `/admin/` 和 `/api/`。
  - 设置步骤见 `docs/online-admin.md`。
- **KaTeX 升级到 0.16.47**（修复 0.16.11 的安全问题）。
- **网站已部署**：https://dongxiv.vercel.app/ ；发布两篇论文（dongxiv:2609.0001、dongxiv:2610.0001），删除示例论文。

- **阶段 2：发布后台** `npm run admin`（http://localhost:4322）
  - 新论文：拖入 PDF，自动读页数、SHA-256，预填标题、摘要和 "N pages, x figures, y tables"；选日期（补录旧论文只记日期，不编时刻），编号按 UTC 年月自动分配；学科从 arXiv 分类中选；AI 信息选填；摘要公式实时预览。
  - 发新版本、修改信息（含撤稿）、删除未发布的论文或版本；已发布的 PDF 和版本不能删除或替换。
  - 发布：先构建检查，再只提交 `papers/` 并推送；构建失败不提交，并显示具体原因。
  - 只监听本机，校验 Host 和 Origin；只接受 PDF，单个文件不超过 95 MB。
- **学科限定为 arXiv 分类**：`src/lib/arxiv-subjects.json`（155 个，取自 arxiv.org/category_taxonomy），构建时校验。
- **只写日期的版本**：补录时只填日期，页面上不显示时刻。
- **示例论文已删除**；网站作者名改为 Dong Zhang；`pdfs/` 不进仓库。
- **首页恢复 "Most recent" 模块**：最新 3 篇（编号、标题、作者、日期），放在按学科浏览下面、"All papers" 按时间列表上面。
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
