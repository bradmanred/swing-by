// Combines the yearly full accessibility scan's results (reports/a11y-full-*.json, from tests/a11y-full.mjs) into one
// report, reports/a11y-full.md, grouped by problem so a fault in a shared template shows once with its page count.
//
//   node scripts/a11y-report.mjs        prints "problems=<number>" for the workflow
import { readdir, readFile, writeFile } from 'node:fs/promises';

const MAX_PAGES = 10; // example pages listed per problem; the full list is in the run's artifact

export function report(parts, today = new Date().toISOString().slice(0, 10)) {
  const scanned = parts.reduce((n, p) => n + p.pages, 0);
  const total = parts[0]?.total ?? 0;
  const groups = new Map();
  const add = (key, title, page, width, detail) => {
    const g = groups.get(key) ?? { title, pages: new Map(), detail };
    const w = g.pages.get(page) ?? new Set();
    w.add(width);
    g.pages.set(page, w);
    groups.set(key, g);
  };
  for (const p of parts) {
    for (const f of p.found) add(`axe:${f.rule}`, `${f.help} (\`${f.rule}\`, ${f.impact ?? 'unknown'} impact)`, f.page, f.width, f.example ? `e.g. \`${f.example}\`` : '');
    for (const x of p.problems) add(`other:${x.problem.replace(/:.*/, '')}:${x.problem.startsWith('script error') ? x.problem : ''}`, x.problem, x.page, x.width, '');
  }
  const sorted = [...groups.values()].sort((a, b) => b.pages.size - a.pages.size);
  const lines = [
    `# Yearly full accessibility scan, ${today}`,
    '',
    `Every page of the built site (${scanned} of ${total} pages, the content editor and moderation page left out) was checked at 1280px and 375px wide with axe, against WCAG 2.2 AA, plus sideways scrolling and script errors. Nothing has been changed.`,
    '',
  ];
  if (scanned < total) lines.push(`⚠️ Only ${scanned} of ${total} pages were scanned: a job didn't finish. Re-run the workflow for a full scan.`, '');
  if (!sorted.length) lines.push('No problems found.');
  else {
    lines.push(`## ${sorted.length} problem${sorted.length === 1 ? '' : 's'}, most widespread first`, '');
    for (const g of sorted) {
      const ex = [...g.pages].slice(0, MAX_PAGES).map(([page, w]) => `\`${page}\` (${[...w].sort((a, b) => b - a).join(', ')}px)`);
      lines.push(`- **${g.title}**: ${g.pages.size} page${g.pages.size === 1 ? '' : 's'}${g.detail ? `, ${g.detail}` : ''}. ${ex.join(', ')}${g.pages.size > MAX_PAGES ? ', …' : ''}`);
    }
  }
  return { markdown: lines.join('\n') + '\n', problems: sorted.length, scanned, total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = (await readdir('reports')).filter((f) => /^a11y-full-\d+\.json$/.test(f));
  const parts = await Promise.all(files.map(async (f) => JSON.parse(await readFile(`reports/${f}`, 'utf8'))));
  const r = report(parts);
  await writeFile('reports/a11y-full.md', r.markdown);
  console.log(`problems=${r.problems}`);
  console.log(`scanned=${r.scanned}`);
  console.log(`total=${r.total}`);
}
