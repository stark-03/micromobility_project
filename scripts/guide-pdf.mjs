#!/usr/bin/env node
/**
 * Renders docs/viva-run-of-show.html to Viva-Run-of-Show.pdf.
 *
 * Headless Chrome rather than a PDF library: the guide is a real stylesheet
 * with @media print rules, and Chrome is the only renderer on this machine
 * that honours them. The HTML is the source of truth and is committed; the
 * PDF is a build output and is gitignored.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** Both documents render the same way; `npm run guide:pdf -- manual` picks one. */
const DOCS = {
  viva: { src: 'docs/viva-run-of-show.html', out: 'Viva-Run-of-Show.pdf' },
  manual: { src: 'docs/user-manual.html', out: 'User-Manual.pdf' },
};

const which = process.argv[2];
const targets = which ? [DOCS[which]] : Object.values(DOCS);

if (targets.some((t) => !t)) {
  console.error(`Unknown document "${which}". Use one of: ${Object.keys(DOCS).join(', ')}`);
  process.exit(1);
}

const CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'brave-browser',
];

function findChrome() {
  for (const bin of CANDIDATES) {
    try {
      execFileSync('command', ['-v', bin], { shell: '/bin/bash', stdio: 'pipe' });
      return bin;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error(
    `No Chrome-family browser found. Tried: ${CANDIDATES.join(', ')}.\n` +
      'Install one, or open docs/viva-run-of-show.html in any browser and use Print to PDF.',
  );
  process.exit(1);
}

for (const doc of targets) {
  const src = path.join(root, doc.src);
  const out = path.join(root, doc.out);

  if (!existsSync(src)) {
    console.error(`Source not found: ${src}`);
    process.exitCode = 1;
    continue;
  }

  // virtual-time-budget gives the Google Fonts stylesheet time to land; without
  // it the PDF renders in the fallback stack and the type looks wrong.
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=20000',
      `--print-to-pdf=${out}`,
      `file://${src}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const kb = Math.round(statSync(out).size / 1024);
  console.log(`Wrote ${doc.out} (${kb} KB) using ${chrome}`);
}
