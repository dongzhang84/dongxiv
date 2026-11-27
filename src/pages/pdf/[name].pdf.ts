// /pdf/<id>vN.pdf 是指定版本，/pdf/<id>.pdf 是最新版本。文件原样输出，不做任何改动。
import fs from 'node:fs';
import type { APIRoute } from 'astro';
import { getPapers, latest, type PaperVersion } from '../../lib/papers';

export function getStaticPaths() {
  return getPapers().flatMap((p) => [
    { params: { name: p.id }, props: { version: latest(p) } },
    ...p.versions.map((version) => ({ params: { name: `${p.id}v${version.v}` }, props: { version } })),
  ]);
}

export const GET: APIRoute = ({ props }) => {
  const { version } = props as { version: PaperVersion };
  return new Response(fs.readFileSync(version.pdfPath), { headers: { 'Content-Type': 'application/pdf' } });
};
