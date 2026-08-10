/**
 * jsdom does not load the app's real stylesheet, so `getComputedStyle` would
 * return empty strings for every design token and createAppTheme() would throw.
 *
 * Injecting tokens.css verbatim keeps these tests honest: the theme is built
 * from the SAME values the browser uses, so a token that MUI cannot parse fails
 * here exactly as it would fail on screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, '../src/styles/tokens.css'), 'utf8');

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

/**
 * testing-library only auto-cleans when a global afterEach exists. Without
 * this, `screen` queries see every previous test's DOM still mounted, and
 * getByRole starts failing with "found multiple elements" — a confusing
 * symptom with nothing to do with the component under test.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
