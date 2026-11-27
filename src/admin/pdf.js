// 在线后台：在浏览器里读 PDF（pdf.js），预填页数、标题、作者、摘要和图表数。只是预填，需要人看过。
// 规则和本地后台的 analyzePdf（pdfinfo/pdftotext）一致。

const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'as', 'via']);
/** 全大写的标题改成 Title Case */
const titleCase = (t) => t.toLowerCase().split(/\s+/).map((w, i) =>
  i > 0 && SMALL.has(w) ? w : w.split('-').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('-')).join(' ');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function pageText(doc, n) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    s += it.str;
    if (it.hasEOL) s += '\n';
  }
  // pdf.js 会把 LaTeX 的重音拆成单独的字符（Poincar´e），合回去
  const ACC = { '´': '\u0301', '¨': '\u0308', 'ˆ': '\u0302', '˜': '\u0303' };
  return s.replace(/([´¨ˆ˜])\s?([A-Za-z])/g, (_, a, c) => c + ACC[a]).normalize('NFC');
}

/** pdfjs：pdfjs-dist 模块；bytes：Uint8Array（会被复制，原数组不受影响） */
export async function analyzePdf(pdfjs, bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pages = doc.numPages || null;
    const info = (await doc.getMetadata().catch(() => null))?.info ?? {};
    const metaTitle = String(info.Title ?? '').trim();
    const metaAuthor = String(info.Author ?? '').trim();
    const texts = [];
    for (let i = 1; i <= doc.numPages; i++) texts.push(await pageText(doc, i));
    const first = texts.slice(0, 2).join('\n');
    const all = texts.join('\n');

    const lines = first.split('\n').map((l) => l.trim()).filter(Boolean);
    let title = metaTitle && !/^(untitled|microsoft word)/i.test(metaTitle) ? metaTitle : '';
    if (!title) title = lines.find((l) => l.length > 8 && !/^(preprint|draft|arxiv)/i.test(l)) ?? '';
    if (/[A-Z]/.test(title) && title === title.toUpperCase()) title = titleCase(title);

    const join = (s) => s.replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    let abstract = '';
    const m = /\bAbstract[.:—–-]?\s*([\s\S]{80,4000}?)\n\s*(?:1\.?\s+Introduction|I\.\s+Introduction|Introduction\n|Keywords|Key words|Contents\n)/i.exec(first);
    if (m) abstract = join(m[1]);

    const count = (re) => new Set([...all.matchAll(re)].map((x) => x[1])).size;
    const figures = count(/^\s*(?:Figure|FIGURE|Fig\.)\s+([A-Z]?\d+)[.:]/gm);
    const tables = count(/^\s*(?:Table|TABLE)\s+([A-Z]?\d+)[.:]/gm);
    const comments = [pages && plural(pages, 'page'), figures && plural(figures, 'figure'), tables && plural(tables, 'table')]
      .filter(Boolean).join(', ');
    return { pages, title, author: metaAuthor, abstract, comments, figures, tables };
  } finally {
    task.destroy();
  }
}
