import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
function walk(path) {
  return readdirSync(path).flatMap(name => {
    const full = join(path, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const source = [...walk(join(ROOT, 'public', 'assets', 'js')), ...walk(join(ROOT, 'scripts'))]
  .filter(file => /\.m?js$/.test(file));
source.push(join(ROOT, 'public', 'sw.js'));
for (const file of source) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML IDs detected.');
if (!html.includes('lang="en-GB"') || !html.includes('Content-Security-Policy')) throw new Error('Document security/accessibility baseline missing.');
for (const href of ['assets/css/styles.css', 'assets/js/app.js', 'manifest.webmanifest', 'sw.js']) {
  if (!existsSync(join(ROOT, 'public', href))) throw new Error(`Missing publish asset ${href}`);
}
console.log(`SOURCE CHECK PASS — ${source.length} JavaScript files parsed, HTML IDs unique, basic assets present.`);
