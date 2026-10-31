import { createBill, addParticipant, removeParticipant, addItem, editItem, deleteItem, calculateBill, validateBill, MAX_ITEMS } from './domain/bill.js';
import { formatMoney, parsePence, parsePercentageBps, displayPercentage, CURRENCY_SYMBOLS } from './domain/money.js';
import { loadBill, saveBill, loadTemplates, saveTemplates, createTemplate, BILL_KEY, LEGACY_KEY } from './storage.js';
import { parseReceiptText, parseOcrResult, recogniseReceiptImage } from './receipt.js';
import { reviewedReceiptItem } from './domain/receipt-review.js';

const $ = id => document.getElementById(id);
const loaded = loadBill();
const state = {
  bill: loaded.bill,
  templates: loadTemplates(),
  selected: new Set(),
  editing: null,
  scanned: null,
  activeScanFill: null,
  blocked: Boolean(loaded.error),
  pendingUndo: null,
};
const formatBill = amount => formatMoney(amount, state.bill.currency);

function el(tag, { className, text, attrs = {} } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}
function button(label, className, handler, attrs = {}) {
  const element = el('button', { className, text: label, attrs: { type: 'button', ...attrs } });
  element.addEventListener('click', handler);
  return element;
}
function showError(message) {
  const box = $('app-alert');
  box.textContent = message;
  box.classList.remove('hidden');
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function clearError() { $('app-alert').classList.add('hidden'); $('app-alert').textContent = ''; }
let toastTimer;
function toast(message, undo = null) {
  clearTimeout(toastTimer);
  const node = $('toast');
  node.replaceChildren(el('span', { text: message }));
  if (undo) node.appendChild(button('Undo', 'toast-undo', undo));
  node.classList.remove('hidden');
  toastTimer = setTimeout(() => node.classList.add('hidden'), 6500);
}
function persist() {
  if (state.blocked) throw new Error('Saved data was unreadable. Export it first or explicitly start a new bill.');
  validateBill(state.bill);
  saveBill(state.bill);
}
function execute(action, successMessage = '') {
  if (state.blocked) { showError('Data recovery is required before editing. Please export your saved data or start a new bill.'); return false; }
  const snapshot = structuredClone(state.bill);
  try {
    clearError();
    action();
    persist();
    render();
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) {
    state.bill = snapshot;
    render();
    showError(error.message || 'Something went wrong.');
    return false;
  }
}

function render() {
  const bill = state.bill;
  const totals = calculateBill(bill);
  if (document.activeElement !== $('bill-title')) $('bill-title').value = bill.title;
  $('bill-currency').value = bill.currency;
  for (const prefix of document.querySelectorAll('.currency-prefix')) prefix.textContent = CURRENCY_SYMBOLS[bill.currency];
  for (const label of document.querySelectorAll('.scan-price-label')) {
    const currency = label.closest('.scan-row')?.dataset.scanCurrency || bill.currency;
    label.textContent = `Line price (${CURRENCY_SYMBOLS[currency]})`;
  }
  $('bill-currency-note').textContent = bill.items.length || bill.receiptTotalPence !== null
    ? 'Currency is locked after adding amounts. Start a new bill to change it; existing amounts are never converted.'
    : 'Choose the currency printed on the receipt or menu before adding items.';
  if (document.activeElement !== $('service-rate')) $('service-rate').value = displayPercentage(bill.serviceChargeBps);
  if (document.activeElement !== $('receipt-total')) $('receipt-total').value = bill.receiptTotalPence === null ? '' : (bill.receiptTotalPence / 100).toFixed(2);
  $('subtotal').textContent = formatBill(totals.subtotalPence);
  $('service-total').textContent = bill.requiresServiceReview ? 'To confirm' : formatBill(totals.servicePence);
  $('service-label').textContent = bill.requiresServiceReview ? 'Service (unconfirmed)' : `Service (${displayPercentage(bill.serviceChargeBps)}%)`;
  $('grand-total').textContent = bill.requiresServiceReview ? 'Pending review' : formatBill(totals.grandTotalPence);
  $('settings-total').textContent = bill.requiresServiceReview ? 'Pending review' : formatBill(totals.grandTotalPence);
  $('settings-service-info').textContent = bill.requiresServiceReview ? 'Confirm the service rate' : `Including ${formatBill(totals.servicePence)} service`;
  for (const control of document.querySelectorAll('.rate-preset[data-rate]')) {
    const active = parsePercentageBps(control.dataset.rate) === bill.serviceChargeBps;
    control.setAttribute('aria-pressed', String(active));
    control.classList.toggle('active', active);
  }
  renderReconciliation(totals);
  renderParticipants();
  renderSplits(totals);
  renderItems();
  renderQuickAdd();
  renderTemplates();
  renderMigration();
}

function renderReconciliation(totals) {
  const area = $('reconciliation');
  area.classList.toggle('hidden', state.bill.receiptTotalPence === null);
  if (state.bill.receiptTotalPence === null) return;
  if (state.bill.requiresServiceReview) {
    area.className = 'reconciliation recon-warn';
    area.textContent = 'Confirm the service rate before comparing totals.';
    return;
  }
  if (totals.differencePence === 0) {
    area.className = 'reconciliation recon-ok';
    area.textContent = '✓ Matches the printed receipt total.';
  } else {
    const abs = formatBill(Math.abs(totals.differencePence));
    area.className = 'reconciliation recon-warn';
    area.textContent = `Difference: ${abs} ${totals.differencePence > 0 ? 'over' : 'under'} the receipt total. Check items, discounts and service charge.`;
  }
}

function renderParticipants() {
  const area = $('participants'); area.replaceChildren();
  const people = state.bill.participants;
  for (const id of [...state.selected]) if (!people.some(p => p.id === id)) state.selected.delete(id);
  if (people.length === 0) area.appendChild(el('p', { className: 'empty-state', text: 'Start by adding a diner.' }));
  for (const person of people) {
    const shell = el('div', { className: 'chip-wrap' });
    const active = state.selected.has(person.id);
    const choice = button(person.name, `chip ${active ? 'selected' : ''}`, () => {
      active ? state.selected.delete(person.id) : state.selected.add(person.id);
      renderParticipants();
    }, { 'aria-pressed': String(active), 'aria-label': `Assign item to ${person.name}` });
    const remove = button('×', 'chip-remove', () => {
      if (!confirm(`Remove ${person.name} from this bill?`)) return;
      execute(() => { removeParticipant(state.bill, person.id); state.selected.delete(person.id); }, 'Diner removed.');
    }, { 'aria-label': `Remove ${person.name}` });
    shell.append(choice, remove);
    area.appendChild(shell);
  }
  $('selected-help').textContent = state.selected.size
    ? `${state.selected.size} selected for the next item. Tap names again to deselect.`
    : 'Select one or more diners before adding an item.';
  syncScanOwnerSelectors();
}

function renderSplits(totals) {
  const area = $('splits'); area.replaceChildren();
  if (!totals.shares.length) { area.appendChild(el('p', { className: 'empty-state', text: 'Add diners and items to see their totals.' })); return; }
  for (const person of totals.shares) {
    const row = el('div', { className: 'split' });
    const who = el('div');
    who.append(el('strong', { text: person.name }), el('small', { text: `${formatBill(person.subtotalPence)} + ${formatBill(person.servicePence)} service` }));
    row.append(who, el('strong', { className: 'split-amount', text: state.bill.requiresServiceReview ? 'Pending' : formatBill(person.totalPence) }));
    area.appendChild(row);
  }
}

function renderItems() {
  const area = $('items'); area.replaceChildren();
  const list = state.bill.items;
  $('item-count').textContent = `${list.length} ${list.length === 1 ? 'item' : 'items'}`;
  if (!list.length) { area.appendChild(el('p', { className: 'empty-state', text: 'Nothing added yet.' })); return; }
  const lookup = new Map(state.bill.participants.map(p => [p.id, p.name]));
  for (const item of list) {
    const row = el('article', { className: 'item-row' });
    const main = el('div', { className: 'item-main' });
    main.append(el('strong', { text: item.description }), el('small', {
      text: `${item.quantity} × ${formatBill(item.pricePence)} · ${item.participantIds.map(id => lookup.get(id)).join(', ')}`
    }));
    const actions = el('div', { className: 'item-actions' });
    actions.append(el('strong', { text: formatBill(item.pricePence * item.quantity) }),
      button('Edit', 'mini-button', () => startEditing(item), { 'aria-label': `Edit ${item.description}` }),
      button('Delete', 'mini-button delete-button', () => removeItemWithUndo(item), { 'aria-label': `Delete ${item.description}` }));
    row.append(main, actions); area.appendChild(row);
  }
}

function startEditing(item) {
  state.activeScanFill = null;
  $('scanned-item-picker').value = '';
  state.editing = item.id;
  state.selected = new Set(item.participantIds);
  $('item-description').value = item.description;
  $('item-price').value = (item.pricePence / 100).toFixed(2);
  $('item-quantity').value = item.quantity;
  $('save-item').textContent = 'Save changes';
  $('cancel-edit').classList.remove('hidden');
  renderParticipants();
  $('item-description').focus();
  $('item-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelEditing() {
  state.editing = null;
  state.activeScanFill = null;
  $('scanned-item-picker').value = '';
  $('item-form').reset();
  $('item-quantity').value = '1';
  $('save-item').textContent = '+ Add item';
  $('cancel-edit').classList.add('hidden');
}
function removeItemWithUndo(item) {
  const index = state.bill.items.findIndex(x => x.id === item.id);
  execute(() => deleteItem(state.bill, item.id));
  if (state.bill.items.some(x => x.id === item.id)) return;
  if (state.editing === item.id) cancelEditing();
  toast(`${item.description} removed.`, () => {
    execute(() => {
      if (state.bill.items.length >= MAX_ITEMS) throw new Error('Item limit reached.');
      if (state.bill.items.some(x => x.id === item.id)) throw new Error('Item is already restored.');
      // If the diner was subsequently removed, the item must not be restored invalidly.
      if (item.participantIds.some(id => !state.bill.participants.some(p => p.id === id))) throw new Error('Restore the diner first.');
      state.bill.items.splice(index, 0, item);
    }, 'Item restored.');
  });
}

function renderQuickAdd() {
  const area = $('quick-add');
  const list = $('item-suggestions');
  area.replaceChildren(); list.replaceChildren();
  const recent = [];
  const seenItems = new Set();
  const seenNames = new Set();
  function suggestName(name) {
    const clean = String(name ?? '').trim();
    const key = clean.toLocaleLowerCase('en-GB');
    if (!clean || seenNames.has(key)) return;
    seenNames.add(key);
    list.appendChild(el('option', { attrs: { value: clean } }));
  }
  for (const item of [...state.bill.items].reverse()) {
    suggestName(item.description);
    const key = `${item.description.toLocaleLowerCase('en-GB')}:${item.pricePence}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key); recent.push(item);
  }
  // OCR names are suggestions only. A suggestion never creates a bill item.
  for (const row of $('receipt-lines').querySelectorAll('.scan-row[data-status="pending"]')) {
    suggestName(row.querySelector('.scan-description').value);
  }
  $('quick-add-wrap').classList.toggle('hidden', recent.length === 0);
  for (const item of recent.slice(0, 5)) {
    area.appendChild(button(`${item.description} · ${formatBill(item.pricePence)}`, 'quick-button', () => {
      execute(() => {
        addItem(state.bill, { description: item.description, pricePence: item.pricePence,
          quantity: 1, participantIds: [...state.selected] });
      }, 'Quick item added.');
    }));
  }
}

function renderTemplates() {
  const area = $('templates'); area.replaceChildren();
  for (const template of state.templates) {
    const row = el('div', { className: 'template-row' });
    const text = el('div'); text.append(el('strong', { text: template.name }), el('small', {
      text: `${template.participantNames.length} diners · ${template.currency || 'GBP'} · ${displayPercentage(template.serviceChargeBps)}% service`
    }));
    row.append(text, button('Use', 'mini-button', () => useTemplate(template), { 'aria-label': `Start bill from ${template.name}` }),
      button('×', 'mini-button delete-button', () => {
        if (!confirm(`Delete template "${template.name}"?`)) return;
        try {
          state.templates = state.templates.filter(x => x !== template);
          saveTemplates(state.templates); renderTemplates(); toast('Template deleted.');
        } catch (error) { showError(error.message); }
      }, { 'aria-label': `Delete template ${template.name}` }));
    area.appendChild(row);
  }
  if (!state.templates.length) area.appendChild(el('p', { className: 'empty-state', text: 'No templates saved yet.' }));
}

function useTemplate(template) {
  if (!confirm('Start a new bill from this template? The current bill will be replaced.')) return;
  execute(() => {
    const bill = createBill(template.name);
    bill.serviceChargeBps = template.serviceChargeBps;
    bill.currency = template.currency || 'GBP';
    for (const name of template.participantNames) addParticipant(bill, name);
    state.bill = bill;
    state.selected = new Set(bill.participants.slice(0, 1).map(p => p.id));
    cancelEditing(); discardScan();
  }, 'New bill created from template.');
}

function renderMigration() {
  const migration = $('migration-notice');
  migration.classList.toggle('hidden', !state.bill.requiresServiceReview);
  const options = $('legacy-rate-choices'); options.replaceChildren();
  if (!state.bill.requiresServiceReview) return;
  for (const bps of state.bill.legacyRatesBps) {
    options.appendChild(button(`Use ${displayPercentage(bps)}%`, 'legacy-rate-button', () => {
      execute(() => { state.bill.serviceChargeBps = bps; });
      $('service-rate').value = displayPercentage(bps);
    }));
  }
}

function discardScan() {
  state.scanned = null;
  state.activeScanFill = null;
  $('receipt-review').classList.add('hidden');
  $('receipt-lines').replaceChildren();
  $('receipt-suggestions').replaceChildren();
  $('scanned-item-picker').replaceChildren(el('option', { text: 'Choose an item to fill name and price…', attrs: { value: '' } }));
  $('scan-picker-wrap').classList.add('hidden');
  $('receipt-image').value = '';
  $('receipt-text').value = '';
  $('ocr-status').textContent = 'Scans stay on this device. Choose a receipt or menu to recognise names and prices.';
  renderQuickAdd();
}

function buildScanOwnerChoices(select, selected = '@all') {
  select.replaceChildren(el('option', { text: 'Split between all diners', attrs: { value: '@all' } }),
    el('option', { text: 'Currently selected diners', attrs: { value: '@selected' } }));
  for (const person of state.bill.participants) {
    select.appendChild(el('option', { text: person.name, attrs: { value: person.id } }));
  }
  select.value = [...select.options].some(option => option.value === selected) ? selected : '@all';
}

function syncScanOwnerSelectors() {
  for (const row of $('receipt-lines').querySelectorAll('.scan-row[data-status="pending"]')) {
    const select = row.querySelector('.scan-owner');
    buildScanOwnerChoices(select, select.value);
  }
}

function getScanRow(index) {
  return [...$('receipt-lines').querySelectorAll('.scan-row')].find(row => row.dataset.scanIndex === String(index));
}

function scanOwnerIds(row) {
  const owner = row.querySelector('.scan-owner').value;
  if (owner === '@all') return state.bill.participants.map(person => person.id);
  if (owner === '@selected') {
    return [...state.selected].filter(id => state.bill.participants.some(person => person.id === id));
  }
  return [owner];
}

function scanItemInput(row) {
  const itemCurrency = row.dataset.scanCurrency;
  if (itemCurrency && itemCurrency !== state.bill.currency) {
    throw new Error(`This item is priced in ${itemCurrency}, but the bill uses ${state.bill.currency}. Change the bill currency before importing; amounts are never converted.`);
  }
  if (!itemCurrency && state.scanned?.currenciesFound.length > 1) {
    throw new Error('Multiple currencies were recognised and this line has no clear symbol. Recheck the source before adding.');
  }
  return reviewedReceiptItem({
    description: row.querySelector('.scan-description').value,
    price: row.querySelector('.scan-price').value,
    participantIds: scanOwnerIds(row),
  });
}

function updateScanPicker() {
  const picker = $('scanned-item-picker');
  const previous = picker.value;
  picker.replaceChildren(el('option', { text: 'Choose an item to fill name and price…', attrs: { value: '' } }));
  const pending = $('receipt-lines').querySelectorAll('.scan-row[data-status="pending"]');
  for (const row of pending) {
    const name = row.querySelector('.scan-description').value.trim() || 'Unnamed item';
    const price = row.querySelector('.scan-price').value.trim();
    picker.appendChild(el('option', {
      text: `${Number(row.dataset.scanIndex) + 1}. ${name} · ${CURRENCY_SYMBOLS[row.dataset.scanCurrency] || CURRENCY_SYMBOLS[state.bill.currency]}${price}`,
      attrs: { value: row.dataset.scanIndex },
    }));
  }
  $('scan-picker-wrap').classList.toggle('hidden', pending.length === 0);
  picker.value = [...pending].some(row => row.dataset.scanIndex === previous) ? previous : '';
  if (!picker.value) state.activeScanFill = null;
  const added = $('receipt-lines').querySelectorAll('.scan-row[data-status="added"]').length;
  const skipped = $('receipt-lines').querySelectorAll('.scan-row[data-status="skipped"]').length;
  $('scan-progress').textContent = `${added} added · ${pending.length} awaiting review · ${skipped} skipped`;
  renderQuickAdd();
}

function clearScanRowError(row) {
  const feedback = row.querySelector('.scan-row-error');
  feedback.textContent = '';
  feedback.classList.add('hidden');
}

function showScanRowError(row, message) {
  const feedback = row.querySelector('.scan-row-error');
  feedback.textContent = message;
  feedback.classList.remove('hidden');
  if (/price/i.test(message)) row.querySelector('.scan-price').focus();
  else if (/name/i.test(message)) row.querySelector('.scan-description').focus();
}

function fillManualFormFromScan(row) {
  if (row.dataset.status !== 'pending') return;
  if (state.editing) return showError('Finish editing the current bill item before filling the form from your scan.');
  try {
    clearError();
    clearScanRowError(row);
    const candidate = scanItemInput(row);
    $('item-description').value = candidate.description;
    $('item-price').value = (candidate.pricePence / 100).toFixed(2);
    $('item-quantity').value = '1';
    state.selected = new Set(candidate.participantIds);
    renderParticipants();
    state.activeScanFill = row.dataset.scanIndex;
    $('scanned-item-picker').value = row.dataset.scanIndex;
    $('item-description').focus();
    $('item-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Name and price filled in. Check the details, then press Add item in section 03.');
  } catch (error) { showScanRowError(row, error.message); }
}

function markScanAdded(row) {
  row.dataset.status = 'added';
  row.classList.add('scan-row-added');
  row.querySelector('.scan-state').textContent = '✓ Added to bill';
  for (const field of row.querySelectorAll('input, select')) field.disabled = true;
  for (const action of row.querySelectorAll('.scan-actions button')) action.disabled = true;
  if (state.activeScanFill === row.dataset.scanIndex) state.activeScanFill = null;
  updateScanPicker();
}

function addScanRow(row) {
  if (row.dataset.status !== 'pending') return;
  let input;
  try { clearScanRowError(row); input = scanItemInput(row); }
  catch (error) { showScanRowError(row, error.message); return; }
  const ok = execute(() => addItem(state.bill, input), 'Recognised item added to the bill.');
  if (ok) {
    if (state.activeScanFill === row.dataset.scanIndex && !state.editing) {
      cancelEditing(); // Prevent the prefilled manual form from adding the same candidate twice.
    }
    markScanAdded(row);
  }
}

function toggleScanSkipped(row) {
  if (row.dataset.status === 'added') return;
  const skip = row.dataset.status === 'pending';
  row.dataset.status = skip ? 'skipped' : 'pending';
  row.classList.toggle('scan-row-skipped', skip);
  row.querySelector('.scan-state').textContent = skip ? 'Skipped — not added' : 'Awaiting review';
  row.querySelector('.scan-skip').textContent = skip ? 'Restore item' : 'Skip';
  if (!skip) syncScanOwnerSelectors();
  if (skip && state.activeScanFill === row.dataset.scanIndex) {
    cancelEditing();
  }
  updateScanPicker();
}

function renderScan(parsed) {
  state.scanned = parsed;
  state.activeScanFill = null;
  $('review-title').textContent = parsed.mode === 'menu' ? 'Review menu suggestions' : 'Review recognised receipt items';
  const lines = $('receipt-lines'); lines.replaceChildren();
  const suggestions = $('receipt-suggestions'); suggestions.replaceChildren();
  for (const warning of parsed.warnings) suggestions.appendChild(el('p', { className: 'hint scan-warning', text: warning }));
  if (parsed.detectedCurrency && parsed.detectedCurrency !== state.bill.currency) {
    suggestions.appendChild(el('p', { className: 'scan-currency-alert', text: `Detected ${parsed.detectedCurrency} prices. Your bill currently uses ${state.bill.currency}. No conversion will occur.` }));
    const currencyAction = button(`Set bill currency to ${parsed.detectedCurrency}`, 'button button-secondary', () => {
      if (state.bill.items.length || state.bill.receiptTotalPence !== null) {
        showError('The bill already contains money amounts. Start a new bill to change currency safely.');
        return;
      }
      if (execute(() => { state.bill.currency = parsed.detectedCurrency; }, 'Currency updated. No prices were converted.')) {
        // Refresh the picker while preserving all uncommitted scan candidates.
        updateScanPicker();
        suggestions.querySelector('.scan-currency-alert')?.remove();
        currencyAction.remove();
      }
    });
    suggestions.appendChild(currencyAction);
  }
  if (parsed.receiptTotalPence !== null) {
    const totalCurrency = parsed.detectedCurrency || state.bill.currency;
    suggestions.appendChild(button(`Use printed receipt total ${formatMoney(parsed.receiptTotalPence, totalCurrency)}`, 'button button-quiet', () => {
      if (totalCurrency !== state.bill.currency || parsed.currenciesFound.length > 1) {
        showError('Printed total currency differs from the bill or the scan has mixed currencies. Confirm and match the currency first.');
        return;
      }
      execute(() => { state.bill.receiptTotalPence = parsed.receiptTotalPence; }, 'Receipt comparison enabled.');
    }));
  }
  if (parsed.suggestedServiceBps !== null) {
    suggestions.appendChild(button(`Use detected service ${displayPercentage(parsed.suggestedServiceBps)}%`, 'button button-quiet', () => {
      execute(() => { state.bill.serviceChargeBps = parsed.suggestedServiceBps; }, 'Service rate updated for all items.');
    }));
  }
  for (const [index, item] of parsed.items.entries()) {
    const card = el('article', { className: 'scan-row', attrs: { 'data-scan-index': String(index), 'data-status': 'pending',
      'data-scan-currency': item.currency || '' } });
    const heading = el('div', { className: 'scan-row-heading' });
    heading.append(el('strong', { text: `Recognised item ${index + 1}` }), el('span', { className: 'scan-state', text: 'Awaiting review' }));
    if (item.confidence === 'review') heading.appendChild(el('span', { className: 'scan-confidence', text: 'Check OCR' }));
    if (item.currency) heading.appendChild(el('span', { className: 'scan-currency', text: item.currency }));
    const editors = el('div', { className: 'scan-editors' });
    const descLabel = el('label', { className: 'field' }); descLabel.append(el('span', { text: 'Item name' }));
    const desc = el('input', { className: 'scan-description', attrs: { type: 'text', maxlength: '120', autocomplete: 'off' } });
    desc.value = item.description; descLabel.append(desc);
    const priceLabel = el('label', { className: 'field' }); priceLabel.append(el('span', { className: 'scan-price-label', text: `Line price (${CURRENCY_SYMBOLS[item.currency] || CURRENCY_SYMBOLS[state.bill.currency]})` }));
    const price = el('input', { className: 'scan-price', attrs: { type: 'text', inputmode: 'decimal' } });
    price.value = (item.pricePence / 100).toFixed(2); priceLabel.append(price);
    const ownerLabel = el('label', { className: 'field scan-owner-label' }); ownerLabel.append(el('span', { text: 'Who ordered it?' }));
    const owner = el('select', { className: 'scan-owner' });
    buildScanOwnerChoices(owner, state.selected.size ? '@selected' : '@all');
    ownerLabel.append(owner); editors.append(descLabel, priceLabel, ownerLabel);
    const actions = el('div', { className: 'scan-actions' });
    actions.append(
      button('Add to bill', 'button button-primary scan-add', () => addScanRow(card)),
      button('Use in Add an item', 'button button-secondary scan-use', () => fillManualFormFromScan(card)),
      button('Skip', 'button button-quiet scan-skip', () => toggleScanSkipped(card)),
    );
    const error = el('p', { className: 'scan-row-error hidden', attrs: { role: 'alert' } });
    desc.addEventListener('input', () => { clearScanRowError(card); updateScanPicker(); });
    price.addEventListener('input', () => { clearScanRowError(card); updateScanPicker(); });
    owner.addEventListener('change', () => clearScanRowError(card));
    card.append(heading, editors, error, actions);
    lines.appendChild(card);
  }
  $('receipt-review').classList.remove('hidden');
  updateScanPicker();
  $('receipt-review').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function attachEvents() {
  $('participant-form').addEventListener('submit', event => {
    event.preventDefault();
    let person;
    execute(() => { person = addParticipant(state.bill, $('participant-name').value); state.selected = new Set([person.id]); }, 'Diner added.');
    if (person) $('participant-name').value = '';
  });
  $('item-form').addEventListener('submit', event => {
    event.preventDefault();
    const editing = Boolean(state.editing);
    const scanIndex = !editing ? state.activeScanFill : null;
    const worked = execute(() => {
      const input = { description: $('item-description').value, pricePence: parsePence($('item-price').value),
        quantity: Number($('item-quantity').value), participantIds: [...state.selected] };
      if (editing) editItem(state.bill, state.editing, input);
      else addItem(state.bill, input);
    }, editing ? 'Item updated.' : 'Item added.');
    if (worked) {
      const scanRow = scanIndex === null ? null : getScanRow(scanIndex);
      if (scanRow?.dataset.status === 'pending') markScanAdded(scanRow);
      cancelEditing(); $('item-description').focus();
    }
  });
  $('cancel-edit').addEventListener('click', cancelEditing);
  $('scanned-item-picker').addEventListener('change', () => {
    const row = getScanRow($('scanned-item-picker').value);
    if (row) fillManualFormFromScan(row);
  });
  $('bill-currency').addEventListener('change', () => {
    const requested = $('bill-currency').value;
    if (requested === state.bill.currency) return;
    if (!Object.hasOwn(CURRENCY_SYMBOLS, requested) || state.bill.items.length || state.bill.receiptTotalPence !== null) {
      $('bill-currency').value = state.bill.currency;
      showError('Currency cannot be changed once amounts exist. Start a new bill to avoid relabelling money without converting it.');
      return;
    }
    execute(() => { state.bill.currency = requested; }, `Currency set to ${requested}; no conversion performed.`);
    updateScanPicker();
  });
  $('scan-mode').addEventListener('change', () => {
    $('scan-mode-help').textContent = $('scan-mode').value === 'menu'
      ? 'Menu mode reads available dishes. Add only what was ordered; menu prices are not receipt totals.'
      : 'Receipt mode recognises purchased items and may suggest a printed total and service charge.';
    if (state.scanned) $('ocr-status').textContent = 'Scan mode updated. Review pasted text again or choose a new photo to refresh the suggestions.';
  });
  // Use 'input', not 'change': virtual keyboards on mobile should not need Enter.
  // Preserve the previous valid value while the user is editing an incomplete one.
  $('bill-title').addEventListener('input', () => {
    const title = $('bill-title').value.trim();
    if (title && title.length <= 100 && title !== state.bill.title) execute(() => { state.bill.title = title; });
  });
  $('bill-title').addEventListener('blur', () => { $('bill-title').value = state.bill.title; });
  $('service-rate').addEventListener('input', () => {
    const input = $('service-rate');
    try {
      let value = input.value.trim();
      if (/^\d{1,3}[.,]$/.test(value)) value = value.slice(0, -1);
      const bps = parsePercentageBps(value);
      input.removeAttribute('aria-invalid');
      $('service-feedback').textContent = '';
      if (bps !== state.bill.serviceChargeBps) execute(() => { state.bill.serviceChargeBps = bps; });
    } catch {
      input.setAttribute('aria-invalid', 'true');
      $('service-feedback').textContent = 'Enter a percentage from 0 to 100 (up to two decimal places). Totals show the last valid rate.';
    }
  });
  $('service-rate').addEventListener('blur', () => {
    $('service-rate').value = displayPercentage(state.bill.serviceChargeBps);
    $('service-rate').removeAttribute('aria-invalid');
    $('service-feedback').textContent = '';
  });
  for (const preset of document.querySelectorAll('.rate-preset[data-rate]')) {
    preset.addEventListener('click', () => {
      if (!execute(() => { state.bill.serviceChargeBps = parsePercentageBps(preset.dataset.rate); })) return;
      $('service-rate').removeAttribute('aria-invalid');
      $('service-feedback').textContent = '';
      $('service-rate').value = displayPercentage(state.bill.serviceChargeBps);
    });
  }
  $('receipt-total').addEventListener('input', () => {
    const field = $('receipt-total');
    try {
      let value = field.value.trim();
      if (/^\d{1,5}[.,]$/.test(value)) value = value.slice(0, -1);
      const amount = value ? parsePence(value) : null;
      field.removeAttribute('aria-invalid');
      $('receipt-feedback').textContent = '';
      if (amount !== state.bill.receiptTotalPence) execute(() => { state.bill.receiptTotalPence = amount; });
    } catch {
      field.setAttribute('aria-invalid', 'true');
      $('receipt-feedback').textContent = 'Enter a valid total, or leave the field empty. The last valid total remains in use.';
    }
  });
  $('receipt-total').addEventListener('blur', () => {
    const pence = state.bill.receiptTotalPence;
    $('receipt-total').value = pence === null ? '' : (pence / 100).toFixed(2);
    $('receipt-total').removeAttribute('aria-invalid');
    $('receipt-feedback').textContent = '';
  });
  $('confirm-legacy-btn').addEventListener('click', () => execute(() => {
    state.bill.requiresServiceReview = false;
  }, 'A single service rate now applies to every item.'));
  $('new-bill-btn').addEventListener('click', () => {
    if (!confirm('Start a new bill? This replaces the current saved bill. Save your summary first if you need it.')) return;
    state.blocked = false;
    execute(() => { state.bill = createBill(); state.selected.clear(); cancelEditing(); discardScan(); }, 'Fresh bill ready.');
  });
  $('share-btn').addEventListener('click', shareSummary);
  $('template-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      clearError();
      const item = createTemplate(state.bill, $('template-name').value);
      if (state.templates.some(t => t.name.toLocaleLowerCase('en-GB') === item.name.toLocaleLowerCase('en-GB'))) {
        throw new Error('A template with this name already exists.');
      }
      if (state.templates.length >= 20) throw new Error('Maximum 20 templates. Delete an old one first.');
      saveTemplates([...state.templates, item]); state.templates.push(item); renderTemplates();
      $('template-name').value = ''; toast('Table template saved.');
    } catch (error) { showError(error.message); }
  });
  $('receipt-image').addEventListener('change', async () => {
    const file = $('receipt-image').files?.[0];
    if (!file) return;
    $('ocr-status').textContent = 'Preparing on-device text recognition…';
    $('receipt-image').disabled = true;
    try {
      const ocr = await recogniseReceiptImage(file, progress => {
        $('ocr-status').textContent = `Recognising receipt locally: ${progress}%`;
      });
      const parsed = parseOcrResult(ocr, { mode: $('scan-mode').value });
      $('receipt-text').value = ocr.text; // Still only held in this browser tab's memory.
      renderScan(parsed);
      $('ocr-status').textContent = `Recognition finished. ${parsed.items.length} ${parsed.mode === 'menu' ? 'menu suggestions' : 'receipt candidates'} detected. Review before adding.`;
    } catch (error) {
      showError(`Receipt scanning failed: ${error.message}`);
      $('ocr-status').textContent = 'You can add items manually or paste receipt text instead.';
    } finally { $('receipt-image').disabled = false; $('receipt-image').value = ''; }
  });
  $('parse-text-btn').addEventListener('click', () => {
    try { clearError(); renderScan(parseReceiptText($('receipt-text').value, { mode: $('scan-mode').value })); }
    catch (error) { showError(error.message); }
  });
  $('discard-scan-btn').addEventListener('click', () => { discardScan(); toast('Receipt scan discarded.'); });

}

async function shareSummary() {
  const totals = calculateBill(state.bill);
  if (state.bill.requiresServiceReview) return showError('Confirm the imported service charge before sharing final totals.');
  const lines = [state.bill.title, `Currency: ${state.bill.currency}`, `Food and drink: ${formatBill(totals.subtotalPence)}`,
    `Service (${displayPercentage(state.bill.serviceChargeBps)}%): ${formatBill(totals.servicePence)}`,
    `Grand total: ${formatBill(totals.grandTotalPence)}`, '',
    ...totals.shares.map(p => `${p.name}: ${formatBill(p.totalPence)}`)];
  if (state.bill.receiptTotalPence !== null) {
    lines.push('', `Printed receipt: ${formatBill(state.bill.receiptTotalPence)}`,
      `Difference: ${formatBill(Math.abs(totals.differencePence))}${totals.differencePence ? ' (check before paying)' : ' (matched)'}`);
  }
  const text = lines.join('\n');
  try {
    if (navigator.share) await navigator.share({ title: state.bill.title, text });
    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); toast('Bill summary copied.'); }
    else { // Users can still select the text themselves where clipboard API is unavailable.
      const content = prompt('Copy your bill summary:', text);
      if (content !== null) toast('Summary ready to copy.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showError('Unable to share the bill. Try copying it manually.');
  }
}

function setupRecovery() {
  if (!loaded.error) return;
  showError(loaded.error);
  const box = $('app-alert');
  box.appendChild(el('p', { text: 'Existing browser storage is preserved. Download a backup before choosing New bill.' }));
  box.appendChild(button('Download saved-data backup', 'button button-outline', () => {
    const contents = { v2: localStorage.getItem(BILL_KEY), legacy: localStorage.getItem(LEGACY_KEY) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' }));
    const link = el('a', { attrs: { href: url, download: 'dining-data-recovery.json' } });
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }));
}

async function initPWA() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try { await navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url)); }
  catch (error) { console.warn('Offline shell unavailable:', error.message); }
}

$('year').textContent = String(new Date().getFullYear());
if (loaded.migrated && !loaded.error) {
  try { saveBill(state.bill); } catch (error) { showError(`Could not persist imported data: ${error.message}`); }
}
attachEvents();
render();
setupRecovery();
void initPWA();
