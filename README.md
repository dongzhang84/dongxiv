# dongxiv

A personal arXiv-style archive for my vibe research papers. Built with [Astro](https://astro.build), deployed on Vercel as a static site (plus a small GitHub login function for the online admin).

- Plan: [docs/proposal.md](docs/proposal.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)

## 本地运行

```sh
npm install
npm run dev      # 开发预览：http://localhost:4321
npm run build    # 构建并校验全站，输出到 .vercel/output/
```

需要 Node 22 以上。

## 发布论文

两种方式，功能一样，写的是同一个仓库：

- **在线后台**：<https://dongxiv.org/admin/>，用 GitHub 登录，点"发布"直接上线。设置和说明见 [docs/online-admin.md](docs/online-admin.md)。
- **本地后台**：下面这个，先保存、预览，再一起发布。

### 本地后台

```sh
npm run admin    # 打开 http://localhost:4322 ，同时在 http://localhost:4321 启动网站预览
```

在网页上：

1. **+ 新论文**：拖入 PDF（自动读出页数、SHA-256，并预填标题、摘要、Comments），选日期，填信息，保存。编号按日期自动分配。
2. **发新版本**：给已有论文拖入新 PDF，写修改说明。已发布的 PDF 不能替换。
3. **修改信息**：只改文字信息；也可以在这里标记撤稿。
4. **预览**：看和线上一样的页面。
5. **发布**：构建检查 → `git commit`（只提交 `papers/`）→ `git push`。构建失败不会提交。

保存后、发布前，改动只在本地。未发布的论文和版本可以在后台删除，已发布的不能删除。
后台只监听本机，不会部署到线上。

## 目录

```
papers/<YYMM.NNNN>/   每篇论文一个文件夹
  meta.yaml           元数据（标题、作者、摘要、vibe 信息、各版本的日期和 SHA-256）
  v1.pdf, v2.pdf …    各版本 PDF，发布后不能替换
site.config.mjs       站点配置（名字、作者、域名、是否允许收录、首页简介）
src/lib/papers.ts     读取并校验所有论文；格式错误或哈希不一致时构建失败
src/pages/            页面：首页列表、/abs/<id>/、/pdf/<id>.pdf、about、feed.xml、sitemap.xml、admin（在线后台）
src/pages/api/auth/   在线后台的 GitHub 登录（只有这里在服务器上运行）
src/admin/            在线后台的界面和逻辑
src/styles/global.css 样式
admin/                本地发布后台（server.mjs + index.html）
```

字段说明见 [docs/proposal.md](docs/proposal.md) §5.2。学科名必须是 arXiv 分类表里的名字（`src/lib/arxiv-subjects.json`）。
`pdfs/` 是本地放原始 PDF 的地方，不进仓库。
