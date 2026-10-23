import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..');

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    if (['node_modules', '.git', '__pycache__'].includes(name)) return [];
    const file = join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

const sourceFiles = [...walk(join(ROOT, 'public')), ...walk(join(ROOT, 'scripts'))]
  .filter(file => /\.(?:js|mjs|html)$/.test(file));
const unsafeDomPatterns = [
  /\.innerHTML\s*=/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bdocument\.write\s*\(/,
  /["']https?:\/\/[^"']+["']\s*,\s*\{\s*method:\s*["']POST/
];
for (const file of sourceFiles) {
  const contents = readFileSync(file, 'utf8');
  for (const pattern of unsafeDomPatterns) {
    if (pattern.test(contents)) throw new Error(`Unsafe source pattern in ${relative(ROOT, file)}: ${pattern}`);
  }
}

// Limited first-line hard-coded secret detection. Not a substitute for
// dedicated secret scanners or the GitHub repository's secret protection.
const secretPatterns = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:password|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_+./=-]{20,}["']/i
];
const textFiles = walk(ROOT).filter(file => /\.(?:js|mjs|html|css|json|md|yml|yaml|webmanifest)$/.test(file));
for (const file of textFiles) {
  const contents = readFileSync(file, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.test(contents)) throw new Error(`Possible hard-coded credential in ${relative(ROOT, file)}; investigate before release.`);
  }
}

const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
for (const rule of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"]) {
  if (!html.includes(rule)) throw new Error(`Missing CSP rule: ${rule}`);
}
if (existsSync(join(ROOT, '.github/workflows/static.yml'))) {
  throw new Error('Legacy auto-deploy workflow bypasses verified release gate.');
}
const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
if (!/static_analysis:/.test(ci) || !/github\/codeql-action\/init@/.test(ci) ||
    !/needs:\s*\[quality, browser, static_analysis\]/.test(ci) ||
    !/npm run security:check/.test(ci) || !/github.event_name == 'workflow_dispatch'/.test(ci)) {
  throw new Error('CI must gate deployment on quality, security analysis and browser tests.');
}
console.log(`SECURITY CHECK PASS — ${sourceFiles.length} source files checked for dangerous DOM patterns, ` +
  `${textFiles.length} text files screened for common literal secrets; CSP and CI gates inspected. ` +
  'Targeted checks only, not a full SAST/secret audit.');
