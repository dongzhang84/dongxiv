# dongxiv

A personal arXiv-style archive for my vibe research papers. Built with [Astro](https://astro.build), deployed as a static site.

- Plan: [docs/proposal.md](docs/proposal.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)

## 本地运行

```sh
npm install
npm run dev      # 开发预览：http://localhost:4321
npm run build    # 生成静态网站到 dist/
```

需要 Node 22 以上。

## 目录

```
papers/<YYMM.NNNN>/   每篇论文一个文件夹
  meta.yaml           元数据（标题、作者、摘要、vibe 信息、各版本的日期和 SHA-256）
  v1.pdf, v2.pdf …    各版本 PDF，发布后不能替换
site.config.mjs       站点配置（名字、作者、域名、是否允许收录、首页简介）
src/lib/papers.ts     读取并校验所有论文；格式错误或哈希不一致时构建失败
src/pages/            页面：首页列表、/abs/<id>/、/pdf/<id>.pdf、about、search、feed.xml、sitemap.xml
src/styles/global.css 样式
```

字段说明见 [docs/proposal.md](docs/proposal.md) §5.2。发布后台（拖入 PDF、填表、一键发布）是下一阶段。

`papers/` 里现有的三篇都是示例（demo），正式上线前删除。
