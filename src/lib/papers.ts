// 读取 papers/<id>/meta.yaml，校验格式和 PDF 哈希，产出全站用的论文列表。
// 任何一篇格式不对、PDF 缺失或哈希对不上，都直接抛错，构建失败，拒绝发布。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { z } from 'astro/zod';
import ARXIV_SUBJECTS from './arxiv-subjects.json';

export const PAPERS_DIR = path.resolve('papers');
export const ID_RE = /^\d{4}\.\d{4}$/;

// 学科名只能用 arXiv 分类表里的名字（src/lib/arxiv-subjects.json，取自 arxiv.org/category_taxonomy）
const SUBJECTS = new Set(ARXIV_SUBJECTS.map((s) => s.name));
const Subject = z.string().refine((s) => SUBJECTS.has(s), {
  error: (iss) => `"${iss.input}" is not an arXiv category name (see src/lib/arxiv-subjects.json)`,
});

const Tri = z.enum(['yes', 'no', 'partial']).optional();
const Link = z.object({ label: z.string().min(1), url: z.url() }).strict();

// 形式化证明：所用系统、证明范围、源码的永久链接（应指向固定 commit）、局限说明
const Formal = z
  .object({ system: z.string().min(1), scope: z.string().optional(), url: z.url(), note: z.string().optional() })
  .strict();

const Version = z
  .object({
    date: z.coerce.date(),
    file: z.string().regex(/^v\d+\.pdf$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    pages: z.number().int().positive().optional(),
    note: z.string().optional(),
  })
  .strict();

const Meta = z
  .object({
    title: z.string().min(1),
    authors: z.array(z.string().min(1)).min(1),
    abstract: z.string().min(1),
    comments: z.string().optional(),
    primary_subject: Subject,
    subjects: z.array(Subject).default([]),
    keywords: z.array(z.string()).default([]),
    license: z.string().optional(),
    links: z.array(Link).default([]),
    formal: Formal.optional(),
    withdrawn: z.string().optional(),
    vibe: z
      .object({
        human_role: z.string().optional(),
        agents: z.array(z.string()).default([]),
        models: z.array(z.string()).default([]),
        machine_verified: Tri,
        human_verified: Tri,
        formal_verified: Tri,
        materials: z.array(Link).default([]),
        notes: z.string().optional(),
      })
      .strict()
      .prefault({}),
    versions: z.array(Version).min(1),
  })
  .strict();

export type Tri = z.infer<typeof Tri>;
export type PaperVersion = z.infer<typeof Version> & { v: number; pdfPath: string; dateOnly: boolean };
export type Paper = Omit<z.infer<typeof Meta>, 'versions'> & {
  id: string;
  versions: PaperVersion[];
  first: Date;
  updated: Date;
};

function sha256(file: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function loadOne(id: string): Paper {
  const dir = path.join(PAPERS_DIR, id);
  const metaFile = path.join(dir, 'meta.yaml');
  const where = `papers/${id}/meta.yaml`;
  const raw = YAML.parse(fs.readFileSync(metaFile, 'utf8'));
  const res = Meta.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`${where} is invalid:\n${issues}`);
  }
  const meta = res.data;

  const versions = meta.versions.map((v, i) => {
    const n = i + 1;
    if (v.file !== `v${n}.pdf`) throw new Error(`${where}: version ${n} should have file v${n}.pdf, found ${v.file}`);
    const pdfPath = path.join(dir, v.file);
    if (!fs.existsSync(pdfPath)) throw new Error(`${where}: ${v.file} not found`);
    const actual = sha256(pdfPath);
    if (actual !== v.sha256)
      throw new Error(`papers/${id}/${v.file}: SHA-256 does not match the record (a published PDF cannot be replaced; post a new version).\n  recorded: ${v.sha256}\n  actual:   ${actual}`);
    if (i > 0 && v.date <= meta.versions[i - 1].date) throw new Error(`${where}: the date of v${n} must be later than v${n - 1}`);
    // 只写了日期（如 2026-09-14）的版本，页面上只显示日期，不显示时刻
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.versions?.[i]?.date ?? ''));
    return { ...v, v: n, pdfPath, dateOnly };
  });

  const first = versions[0].date;
  const yymm = `${String(first.getUTCFullYear()).slice(2)}${String(first.getUTCMonth() + 1).padStart(2, '0')}`;
  if (!id.startsWith(yymm)) throw new Error(`${where}: identifier ${id} must match the year and month of v1 (${yymm})`);

  const { versions: _drop, ...rest } = meta;
  return { ...rest, id, versions, first, updated: versions[versions.length - 1].date };
}

let cache: Paper[] | null = null;

/** 所有论文，按首次发布时间从新到旧排列。 */
export function getPapers(): Paper[] {
  if (cache && !import.meta.env.DEV) return cache;
  const ids = fs.existsSync(PAPERS_DIR)
    ? fs.readdirSync(PAPERS_DIR).filter((d) => ID_RE.test(d) && fs.existsSync(path.join(PAPERS_DIR, d, 'meta.yaml')))
    : [];
  const papers = ids.map(loadOne);
  papers.sort((a, b) => b.first.getTime() - a.first.getTime() || b.id.localeCompare(a.id));
  cache = papers;
  return papers;
}

/** 网站上列出的论文：撤稿的不出现在首页、学科页、订阅和 sitemap 里，只保留摘要页供旧链接访问。 */
export const getListed = () => getPapers().filter((p) => !p.withdrawn);

export const latest = (p: Paper) => p.versions[p.versions.length - 1];
