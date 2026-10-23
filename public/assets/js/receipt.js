import { parsePence, parsePercentageBps } from './domain/money.js';

const LIMIT_LINES = 240;
const MAX_CHARS = 18000;
const MAX_OCR_WORDS = 4500;
const MAX_TSV_CHARS = 900000;
const MAX_CANDIDATES = 250;
const MODES = new Set(['receipt', 'menu']);
const SYMBOL_CURRENCY = { '£': 'GBP', '$': 'USD', '€': 'EUR' };
const TOTAL_RE = /^(?:grand\s+total|amount\s+(?:due|payable)|total\s*(?:due|to\s+pay)?|balance\s+due)\b/i;
const SUBTOTAL_RE = /^(?:sub\s*total|food\s+total|items\s+total)\b/i;
const SERVICE_RE = /\b(?:service\s*(?:charge|fee)?|gratuity|discretionary\s+service)\b/i;
const NON_ITEM_RE = /^(?:vat|tax|card|visa|mastercard|cash|change|paid|discount|saving|tip|table|receipt|invoice|date|time|order|server|thank\s+you|tel|www|http|subtotal|total|balance|amount\s+due|free\s+delivery)\b/i;
const CATEGORY_RE = /\b(?:main\s+course|starters?|soup\s*(?:&|and)\s*salad|beverages?|drinks?|desserts?|side\s+dishes|appeti[sz]ers?)\b/gi;
// Multiple name/price pairs and noisy trailing punctuation are expected on menus.
// Decimals are required: dates, phone numbers and quantities must not become prices.
const MONEY_RE = /(?<![\w.,])(?:(£|\$|€)\s*)?(\d{1,5}[.,]\d{2})(?![\d.,])/g;

function scanMode(mode) {
  if (!MODES.has(mode)) throw new RangeError('Choose either receipt or menu scan mode.');
  return mode;
}
function normaliseLine(text) {
  return String(text).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanName(raw) {
  let value = raw.replace(CATEGORY_RE, ' ').replace(/^[^\p{L}\p{N}<]+/u, '').trim();
  // OCR sometimes joins a heading or image ornament before the dish name.
  if (/[;:]/.test(value) && value.split(/[;:]/).length > 1) {
    const end = value.split(/[;:]/).at(-1).trim();
    if (end.length >= 3 && /\p{L}/u.test(end)) value = end;
  }
  value = value.replace(/^\d{1,2}\s*(?:[-–—]+\s*)?/, '')
    .replace(/^[^\p{L}\p{N}<]+/u, '')
    .replace(/[\s.\-–—:_~*“”‘’]+$/u, '')
    .replace(/\s+/g, ' ').trim();
  return value;
}
function moneyMatches(line) {
  return [...line.matchAll(MONEY_RE)].map(match => ({
    index: match.index, end: match.index + match[0].length,
    symbol: match[1] || null, amount: match[2],
  }));
}
function parseLine(line, options) {
  const matches = moneyMatches(line);
  if (!matches.length) return [];
  if (SERVICE_RE.test(line) || SUBTOTAL_RE.test(line) || TOTAL_RE.test(line)) return [];
  if (NON_ITEM_RE.test(line)) return [];
  const items = [];
  let start = 0;
  for (const match of matches) {
    const raw = line.slice(start, match.index);
    start = match.end;
    const description = cleanName(raw);
    if (description.length < 2 || description.length > 120 || !/\p{L}/u.test(description) ||
        NON_ITEM_RE.test(description) || !/^.{0,120}$/.test(description)) continue;
    try {
      const pricePence = parsePence(match.amount);
      const noisy = /[<>;:{}]|\b(?:Sapa|Lbs|oe|APRS|gals|TER)\b|\b[a-z]\s+[A-Z]{2,5}\b/i.test(raw) ||
        raw.replace(CATEGORY_RE, '').trim().length > description.length + 7;
      items.push({ description, pricePence, quantity: 1, currency: SYMBOL_CURRENCY[match.symbol] || null,
        confidence: (noisy || matches.length > 1 || options.confidence < 70) ? 'review' : 'normal' });
    } catch { /* Invalid prices never become candidates. */ }
  }
  return items;
}
function finishParsing(source, mode, context = {}) {
  const lines = source.slice(0, LIMIT_LINES).map(row => typeof row === 'string'
    ? { text: normaliseLine(row), confidence: 100 }
    : { text: normaliseLine(row.text), confidence: Number(row.confidence ?? 100) }).filter(row => row.text);
  const result = {
    mode, items: [], receiptTotalPence: null, printedSubtotalPence: null,
    printedServicePence: null, suggestedServiceBps: null, detectedCurrency: null,
    currenciesFound: [], usedLayout: Boolean(context.usedLayout),
    warnings: ['Every recognised name and price must be checked before it is added.'],
  };
  if (mode === 'menu') result.warnings.push('A menu lists available dishes, not purchases. Only add items someone actually ordered.');
  for (const line of lines) {
    const amounts = moneyMatches(line.text);
    if (!amounts.length) continue;
    if (mode === 'receipt') {
      const last = amounts.at(-1);
      let amount = null;
      try { amount = parsePence(last.amount); } catch { /* Unusable total */ }
      if (amount !== null) {
        if (SERVICE_RE.test(line.text)) {
          result.printedServicePence = amount;
          const percent = line.text.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
          if (percent) {
            try { result.suggestedServiceBps = parsePercentageBps(percent[1]); } catch { /* Advisory below */ }
          }
          continue;
        }
        if (SUBTOTAL_RE.test(line.text)) { result.printedSubtotalPence = amount; continue; }
        if (TOTAL_RE.test(line.text)) { result.receiptTotalPence = amount; continue; }
      }
    }
    for (const item of parseLine(line.text, { mode, confidence: line.confidence })) {
      if (result.items.length >= MAX_CANDIDATES) break;
      result.items.push(item);
    }
  }
  // Infer unmarked entries only when the document has one explicit currency.
  const currencies = new Set(result.items.map(i => i.currency).filter(Boolean));
  for (const row of lines) {
    for (const token of moneyMatches(row.text)) if (token.symbol) currencies.add(SYMBOL_CURRENCY[token.symbol]);
  }
  result.currenciesFound = [...currencies].sort();
  if (currencies.size === 1) {
    result.detectedCurrency = result.currenciesFound[0];
    for (const item of result.items) if (!item.currency) item.currency = result.detectedCurrency;
  }
  if (currencies.size > 1) result.warnings.push('Mixed currencies were recognised. Review each item; amounts must not be converted or silently relabelled.');
  if (currencies.size === 0 && result.items.length) result.warnings.push('No currency symbol was recognised. Confirm your bill currency before adding amounts.');
  if (result.items.length === 0) result.warnings.push('No priced items were found; try a clearer image or enter items manually.');
  if (result.items.some(i => i.confidence === 'review')) result.warnings.push('Some item names or prices may contain OCR noise or merged text. Edit them before approving.');
  if (mode === 'receipt') {
    if (result.suggestedServiceBps === null && result.printedServicePence !== null && result.printedSubtotalPence > 0) {
      const bps = Math.round(result.printedServicePence * 10000 / result.printedSubtotalPence);
      if (bps >= 0 && bps <= 10000) {
        result.suggestedServiceBps = bps;
        result.warnings.push('Service percentage was estimated from printed amounts; verify before applying.');
      }
    }
    const recognisedSum = result.items.reduce((sum, item) => sum + item.pricePence, 0);
    if (result.printedSubtotalPence !== null && recognisedSum !== result.printedSubtotalPence) {
      result.warnings.push('Recognised item prices do not match the printed subtotal. Check for missing or duplicated lines.');
    }
    if (result.printedServicePence !== null && result.suggestedServiceBps === null) {
      result.warnings.push('Service charge detected, but enter its percentage manually.');
    }
  }
  if (source.length > LIMIT_LINES) result.warnings.push('Only the first 240 text lines were processed.');
  if (result.items.length >= MAX_CANDIDATES) result.warnings.push('Only the first 250 candidates were shown; use a smaller scan.');
  if (context.usedLayout) result.warnings.unshift(`Layout-aware recognition: ${context.columns} column${context.columns === 1 ? '' : 's'} separated.`);
  return result;
}

/** Pasted text fallback. Neither OCR nor parser output mutates the bill. */
export function parseReceiptText(input, { mode = 'receipt' } = {}) {
  scanMode(mode);
  if (typeof input !== 'string' || input.length > MAX_CHARS) throw new Error('Scan text must be 18,000 characters or fewer.');
  return finishParsing(input.replace(/\r/g, '').split('\n'), mode);
}

/** Parse bounded Tesseract TSV word positions; ignore malformed coordinates and TSV metadata. */
export function tsvToPositionedLines(tsv, imageWidth, { maxWords = MAX_OCR_WORDS } = {}) {
  if (typeof tsv !== 'string' || !tsv || tsv.length > MAX_TSV_CHARS ||
      !Number.isFinite(imageWidth) || imageWidth <= 0 || imageWidth > 12000) return null;
  const rows = tsv.split('\n');
  const keys = rows[0]?.trim().split('\t');
  if (!keys || !['level', 'left', 'top', 'width', 'height', 'text'].every(k => keys.includes(k))) return null;
  const cols = Object.fromEntries(keys.map((k, i) => [k, i]));
  const words = [];
  for (const row of rows.slice(1, maxWords * 2 + 1)) {
    const fields = row.replace(/\r$/, '').split('\t');
    if (fields[cols.level] !== '5') continue;
    const text = String(fields.slice(cols.text).join('\t') || '').trim();
    const left = Number(fields[cols.left]), top = Number(fields[cols.top]);
    const width = Number(fields[cols.width]), height = Number(fields[cols.height]);
    const conf = cols.conf === undefined ? 100 : Number(fields[cols.conf]);
    if (!text || text.length > 100 || ![left, top, width, height, conf].every(Number.isFinite) ||
        left < 0 || top < 0 || width <= 0 || height <= 0 || left > imageWidth ||
        left + width > imageWidth * 1.02 || top > 12000 || height > 500) continue;
    words.push({ text, left, top, width, height, middleX: left + width / 2,
      middleY: top + height / 2, confidence: conf });
    if (words.length >= maxWords) break;
  }
  if (!words.length) return null;
  const priceTokens = words.filter(w => /^(?:£|\$|€)?\s*\d{1,5}[.,]\d{2}$/.test(w.text)).map(w => w.middleX);
  // One-column receipts often align all prices at right. Split only when BOTH
  // halves independently contain priced lines, not a name/price receipt pair.
  const leftPrices = priceTokens.filter(x => x < imageWidth * 0.5);
  const rightPrices = priceTokens.filter(x => x >= imageWidth * 0.5);
  const priceGap = priceTokens.length >= 4 && (Math.min(...rightPrices) - Math.max(...leftPrices) > imageWidth * 0.13);
  const hasColumns = leftPrices.length >= 2 && rightPrices.length >= 2 && priceGap;
  let divider = imageWidth * 0.5;
  if (hasColumns) {
    // Find an unoccupied central gutter, avoiding the text of the second column.
    const candidates = [];
    for (let ratio = 0.37; ratio <= 0.63; ratio += 0.01) {
      const x = imageWidth * ratio;
      if (!priceTokens.some(p => p < x) || !priceTokens.some(p => p >= x)) continue;
      const crossing = words.filter(w => w.left < x && w.left + w.width > x).length;
      const near = words.filter(w => Math.abs(w.middleX - x) < imageWidth * 0.015).length;
      candidates.push({ x, score: crossing * 100 + near * 3 + Math.abs(ratio - 0.5) * 10 });
    }
    divider = candidates.sort((a, b) => a.score - b.score)[0]?.x ?? divider;
  }
  const columns = hasColumns ? 2 : 1;
  const arranged = [];
  for (let c = 0; c < columns; c++) {
    const groupWords = words.filter(w => columns === 1 || (c === 0 ? w.middleX < divider : w.middleX >= divider));
    groupWords.sort((a, b) => a.middleY - b.middleY || a.middleX - b.middleX);
    const rowsInColumn = [];
    for (const word of groupWords) {
      let best = null; let nearest = Number.POSITIVE_INFINITY;
      for (const current of rowsInColumn.slice(-5)) {
        const dist = Math.abs(current.centerY - word.middleY);
        if (dist <= Math.max(5, Math.min(current.height, word.height) * 0.52) && dist < nearest) {
          best = current; nearest = dist;
        }
      }
      if (!best) {
        best = { words: [], centerY: word.middleY, height: word.height };
        rowsInColumn.push(best);
      }
      const n = best.words.length;
      best.centerY = (best.centerY * n + word.middleY) / (n + 1);
      best.height = Math.max(best.height, word.height);
      best.words.push(word);
    }
    for (const row of rowsInColumn) {
      row.words.sort((a, b) => a.left - b.left);
      arranged.push({ column: c, y: row.centerY,
        text: row.words.map(w => w.text).join(' '),
        confidence: row.words.reduce((sum, w) => sum + w.confidence, 0) / row.words.length });
    }
  }
  arranged.sort((a, b) => a.column - b.column || a.y - b.y);
  return { columns, lines: arranged };
}

/** Prefer spatial TSV to prevent joining dishes across menu columns; fall back to pasted-style text. */
export function parseOcrResult(ocr, { mode = 'receipt' } = {}) {
  scanMode(mode);
  if (!ocr || typeof ocr.text !== 'string') throw new Error('The OCR engine did not return recognised text.');
  const plain = parseReceiptText(ocr.text, { mode });
  const positioned = tsvToPositionedLines(ocr.tsv, ocr.width);
  if (!positioned) {
    plain.warnings.unshift('No word-position data was available. Multi-column images may need manual corrections.');
    return plain;
  }
  const layout = finishParsing(positioned.lines, mode, { usedLayout: true, columns: positioned.columns });
  if (plain.items.length > 2 && layout.items.length < Math.ceil(plain.items.length * 0.65)) {
    plain.warnings.unshift('Too few items were recovered from word positions; using text fallback. Check for merged or incorrectly paired columns.');
    return plain;
  }
  if (!layout.items.length && plain.items.length) {
    plain.warnings.unshift('Positioned text was incomplete; using text fallback. Check multi-column item associations.');
    return plain;
  }
  if (!layout.currenciesFound.length && plain.detectedCurrency) {
    layout.detectedCurrency = plain.detectedCurrency;
    layout.currenciesFound = [...plain.currenciesFound];
    for (const item of layout.items) if (!item.currency) item.currency = plain.detectedCurrency;
  }
  if (mode === 'receipt') {
    for (const key of ['receiptTotalPence', 'printedSubtotalPence', 'printedServicePence', 'suggestedServiceBps']) {
      if (layout[key] === null) layout[key] = plain[key];
    }
  }
  // With spatial OCR preferred, always show uncertainty about incomplete recognition.
  if (plain.items.length > layout.items.length + 1) {
    layout.warnings.push('Some text candidates were not recovered by layout analysis. Check the image for missing dishes.');
  }
  return layout;
}

export const OCR_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
let scriptPromise;
function loadTesseract() {
  if (globalThis.Tesseract?.createWorker) return Promise.resolve(globalThis.Tesseract);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = OCR_SCRIPT_URL;
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.Tesseract?.createWorker
      ? resolve(globalThis.Tesseract) : reject(new Error('OCR library was not available after loading.'));
    script.onerror = () => reject(new Error('Could not load OCR engine. Check your internet connection and try again.'));
    document.head.appendChild(script);
  }).catch(error => { scriptPromise = null; throw error; });
  return scriptPromise;
}
async function compressImage(file) {
  if (!file || !/^image\//i.test(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    throw new Error('Select a valid image smaller than 10 MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error('Image resolution is too large (40 MP limit).');
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const width = canvas.width;
    const height = canvas.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image preparation failed.')), 'image/jpeg', 0.88));
    canvas.width = 0; canvas.height = 0;
    return { blob, width, height };
  } finally { bitmap.close(); }
}
export async function recogniseReceiptImage(file, onProgress = () => {}) {
  const prepared = await compressImage(file);
  const tesseract = await loadTesseract();
  let worker;
  try {
    worker = await tesseract.createWorker('eng', 1, {
      logger(message) {
        if (message?.status === 'recognizing text' && Number.isFinite(message.progress)) {
          onProgress(Math.round(message.progress * 100));
        }
      }
    });
    // v6/v7 disable TSV by default. Ask for word bounding boxes explicitly.
    const response = await worker.recognize(prepared.blob, {}, { text: true, tsv: true });
    return { text: String(response?.data?.text ?? ''), tsv: response?.data?.tsv ?? null,
      width: prepared.width, height: prepared.height };
  } finally { if (worker) await worker.terminate(); }
}
