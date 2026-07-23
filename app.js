/* ====================================================
   ChatToDoc — app.js
   LaTeX/Markdown parsing → MathML → Word clipboard
   ==================================================== */

'use strict';

// ─── Wait for KaTeX to load ──────────────────────────────────────────────────
function waitForKatex(cb, tries = 0) {
  if (typeof window.katex !== 'undefined') { cb(); return; }
  if (tries > 50) { console.warn('KaTeX not loaded'); cb(); return; }
  setTimeout(() => waitForKatex(cb, tries + 1), 100);
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const inputEl       = document.getElementById('input-text');
const previewRender = document.getElementById('preview-rendered');
const previewWord   = document.getElementById('preview-word');
const previewRaw    = document.getElementById('preview-raw');

const statChars  = document.getElementById('stat-chars');
const statWords  = document.getElementById('stat-words');
const statEqs    = document.getElementById('stat-eqs');

const btnCopyWord = document.getElementById('btn-copy-word');
const btnCopyLbl  = document.getElementById('btn-copy-label');
const btnDownload = document.getElementById('btn-download');
const btnExample  = document.getElementById('btn-example');
const btnGuide    = document.getElementById('btn-guide');
const btnClear    = document.getElementById('btn-clear');
const btnPaste    = document.getElementById('btn-paste');
const btnTheme    = document.getElementById('btn-theme');

const settingFont    = document.getElementById('setting-font');
const settingSize    = document.getElementById('setting-size');
const settingSpacing = document.getElementById('setting-spacing');
const settingCols    = document.getElementById('setting-cols');

const tabs       = document.querySelectorAll('.tab');
const tabContents= document.querySelectorAll('.tab-content');

const modalGuide = document.getElementById('modal-guide');
const closeGuide = document.getElementById('close-guide');

const toast      = document.getElementById('toast');
const toastMsg   = document.getElementById('toast-message');
const toastIcon  = document.getElementById('toast-icon');

const iconSun    = document.getElementById('icon-sun');
const iconMoon   = document.getElementById('icon-moon');

// ─── State ───────────────────────────────────────────────────────────────────
let processedHtml     = '';  // visual HTML for screen
let processedWordHtml = '';  // HTML with MathML for Word clipboard
let currentTheme      = localStorage.getItem('ctd-theme') || 'dark';
let debounceTimer     = null;

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  waitForKatex(() => {
    setupEventListeners();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });
});

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
function setupEventListeners() {
  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processInput, 300);
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Buttons
  btnCopyWord.addEventListener('click', copyForWord);
  btnDownload.addEventListener('click', downloadHtml);
  btnExample.addEventListener('click', loadExample);
  btnClear.addEventListener('click', () => { inputEl.value = ''; processInput(); });
  btnPaste.addEventListener('click', pasteFromClipboard);
  btnTheme.addEventListener('click', toggleTheme);
  btnGuide.addEventListener('click', () => { modalGuide.hidden = false; });
  closeGuide.addEventListener('click', () => { modalGuide.hidden = true; });
  modalGuide.addEventListener('click', e => { if (e.target === modalGuide) modalGuide.hidden = true; });

  // Settings change → re-render word preview
  [settingFont, settingSize, settingSpacing, settingCols].forEach(el => {
    el.addEventListener('change', updateWordPreview);
  });

  // Keyboard shortcut: Ctrl+Enter to copy
  inputEl.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      copyForWord();
    }
  });

  // Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modalGuide.hidden) modalGuide.hidden = true;
  });
}

// ─── THEME ───────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('ctd-theme', theme);
  if (theme === 'dark') {
    iconSun.style.display  = '';
    iconMoon.style.display = 'none';
  } else {
    iconSun.style.display  = 'none';
    iconMoon.style.display = '';
  }
}
function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

// ─── TAB SWITCHING ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  tabContents.forEach(c => {
    c.classList.toggle('active', c.id === `content-${tabId}`);
  });
}

// ─── MATH EXTRACTION ─────────────────────────────────────────────────────────
/**
 * Extracts LaTeX math segments from raw text before Markdown parsing.
 * Returns { cleaned: string, maths: [{placeholder, raw, display}] }
 * Supports: $$...$$, \[...\], $...$, \(...\)
 */
function extractMath(text) {
  const maths = [];
  let idx = 0;

  // Ordered patterns: display first, then inline
  const patterns = [
    { re: /\$\$([\s\S]*?)\$\$/g,         display: true  },
    { re: /\\\[([\s\S]*?)\\\]/g,          display: true  },
    { re: /\\\(([\s\S]*?)\\\)/g,          display: false },
  ];

  // Single $ — inline, but avoid currency ($5, $10) using look-around heuristics
  // Replaced in a second pass below after block patterns

  let cleaned = text;

  // Replace block and \(...\) patterns
  for (const { re, display } of patterns) {
    cleaned = cleaned.replace(re, (match, inner) => {
      const placeholder = `%%MATH_${idx}_${display ? 'D' : 'I'}%%`;
      maths.push({ placeholder, raw: inner.trim(), display });
      idx++;
      return placeholder;
    });
  }

  // Single $ inline — careful parser to avoid currency
  cleaned = parseSingleDollar(cleaned, maths, idx);

  return { cleaned, maths };
}

function parseSingleDollar(text, maths, startIdx) {
  let idx = startIdx;
  let result = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '$') {
      // Escaped dollar — keep as literal $
      result += '$';
      i += 2;
      continue;
    }

    if (text[i] === '$') {
      // Look for closing $
      let j = i + 1;
      // Skip if followed by space or digit right at start (likely currency)
      if (j < text.length && (/\s/.test(text[j]) || text[i - 1] === ' ') && /\d/.test(text[j])) {
        result += text[i];
        i++;
        continue;
      }

      // Find closing $
      let inner = '';
      let found = false;
      while (j < text.length) {
        if (text[j] === '\\' && text[j + 1] === '$') { inner += '$'; j += 2; continue; }
        if (text[j] === '$') { found = true; break; }
        inner += text[j];
        j++;
      }

      // Validate: must contain at least one LaTeX-ish character and not be pure currency
      if (found && inner.length > 0 && inner.trim().length > 0 && !isProbablyCurrency(inner)) {
        const placeholder = `%%MATH_${idx}_I%%`;
        maths.push({ placeholder, raw: inner.trim(), display: false });
        idx++;
        result += placeholder;
        i = j + 1;
        continue;
      }
    }

    result += text[i];
    i++;
  }

  return result;
}

function isProbablyCurrency(str) {
  // Pure number with optional commas/dots → likely currency
  return /^\d[\d,. ]*$/.test(str.trim());
}

// ─── RENDER MATH ─────────────────────────────────────────────────────────────
function renderMathVisual(raw, display) {
  try {
    const html = window.katex.renderToString(raw, {
      displayMode: display,
      output: 'html',
      throwOnError: false,
      trust: false,
    });
    return display ? `<div class="katex-display-wrap">${html}</div>` : html;
  } catch (e) {
    return `<span class="math-error" title="${escapeHtml(e.message)}">${escapeHtml(raw)}</span>`;
  }
}

function renderMathMathML(raw, display) {
  try {
    let ml = window.katex.renderToString(raw, {
      displayMode: display,
      output: 'mathml',
      throwOnError: false,
      trust: false,
    });
    // Inject required xmlns namespace so Word recognizes the equation
    ml = ml.replace(/<math\b([^>]*)>/, (match, attrs) => {
      if (!attrs.includes('xmlns')) {
        return `<math xmlns="http://www.w3.org/1998/Math/MathML"${attrs}>`;
      }
      return match;
    });
    return ml;
  } catch (e) {
    return `<span>${escapeHtml(raw)}</span>`;
  }
}

// ─── PROCESS INPUT ───────────────────────────────────────────────────────────
function processInput() {
  const raw = inputEl.value;
  updateStats(raw);

  if (!raw.trim()) {
    setEmptyPreviews();
    btnCopyWord.disabled = true;
    btnDownload.disabled = true;
    return;
  }

  if (typeof window.katex === 'undefined') {
    showToast('KaTeX ще завантажується, зачекайте...', 'info');
    return;
  }

  const { cleaned, maths } = extractMath(raw);

  // ── Visual HTML (for screen preview) ──
  let visualHtml = parseMarkdown(cleaned);
  visualHtml = reinjMath(visualHtml, maths, 'visual');

  // ── Word HTML (MathML + namespaced HTML) ──
  let wordHtml = parseMarkdown(cleaned, true);
  wordHtml = reinjMath(wordHtml, maths, 'mathml');

  processedHtml     = visualHtml;
  processedWordHtml = wordHtml;

  // Update previews
  previewRender.innerHTML = visualHtml;
  updateWordPreview();
  previewRaw.innerHTML = '';
  previewRaw.textContent = buildWordClipboardHtml(processedWordHtml);

  btnCopyWord.disabled = false;
  btnDownload.disabled = false;

  // Re-run lucide icons (in case preview has none)
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function reinjMath(html, maths, mode) {
  let out = html;
  for (const { placeholder, raw, display } of maths) {
    const rendered = mode === 'mathml'
      ? renderMathMathML(raw, display)
      : renderMathVisual(raw, display);
    // Escape the placeholder for use in regex (% signs)
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), rendered);
  }
  return out;
}

// ─── MARKDOWN PARSER ─────────────────────────────────────────────────────────
function parseMarkdown(text, forWord = false) {
  if (typeof window.marked === 'undefined') {
    return `<p>${escapeHtml(text)}</p>`;
  }

  // Configure marked
  window.marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
  });

  let html = window.marked.parse(text);

  if (forWord) {
    // Strip script/style tags (safety)
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  }

  return html;
}

// ─── WORD PREVIEW ────────────────────────────────────────────────────────────
function updateWordPreview() {
  if (!processedWordHtml) return;
  const font    = settingFont.value;
  const size    = settingSize.value;
  const spacing = settingSpacing.value;

  previewWord.innerHTML = `
    <div style="font-family:${font}, sans-serif; font-size:${size};
                line-height:${spacing}; color:#000; max-width:100%;">
      ${processedWordHtml}
    </div>`;
}

// ─── CLIPBOARD HELPERS ───────────────────────────────────────────────────────
function buildWordClipboardHtml(bodyHtml) {
  const font    = settingFont.value;
  const size    = settingSize.value;
  const spacing = settingSpacing.value;
  const width   = settingCols.value === 'auto' ? '100%' : settingCols.value;

  return `<div xmlns="http://www.w3.org/1999/xhtml"
  style="font-family:${font}, Arial, sans-serif; font-size:${size};
         line-height:${spacing}; color:#000000; max-width:${width};
         margin:0; padding:0;">
${bodyHtml}
</div>`;
}

async function copyForWord() {
  if (!processedWordHtml) return;

  const clipHtml = buildWordClipboardHtml(processedWordHtml);
  const plainText = inputEl.value;

  // Try modern Clipboard API first
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        'text/html':  new Blob([clipHtml],  { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      showCopySuccess();
      return;
    } catch (err) {
      console.warn('Clipboard API failed:', err);
      // Fall through to legacy method
    }
  }

  // Legacy execCommand fallback
  try {
    const el = document.createElement('div');
    el.innerHTML = clipHtml;
    el.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0;';
    document.body.appendChild(el);
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(el);
    showCopySuccess();
  } catch (err2) {
    showToast('Помилка копіювання. Спробуйте ще раз.', 'error');
    console.error(err2);
  }
}

function showCopySuccess() {
  btnCopyLbl.textContent = 'Скопійовано! ✓';
  showToast('Текст скопійовано! Вставляйте у Word (Ctrl+V)', 'success');
  setTimeout(() => { btnCopyLbl.textContent = 'Скопіювати для MS Word'; }, 3000);
}

// ─── DOWNLOAD HTML ───────────────────────────────────────────────────────────
function downloadHtml() {
  if (!processedWordHtml) return;
  const content = `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Документ</title>
  <style>
    body { font-family: ${settingFont.value}, Arial, sans-serif;
           font-size: ${settingSize.value}; line-height: ${settingSpacing.value};
           color: #000; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; }
    th { background: #f0f0f0; }
    .katex-display { margin: 16px 0; }
  </style>
</head>
<body>
${buildWordClipboardHtml(processedWordHtml)}
</body>
</html>`;

  const blob = new Blob([content], { type: 'text/html; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'document.html';
  a.click();
  URL.revokeObjectURL(url);
  showToast('HTML-файл завантажено', 'success');
}

// ─── PASTE FROM CLIPBOARD ────────────────────────────────────────────────────
async function pasteFromClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      inputEl.value = text;
      processInput();
    }
  } catch (err) {
    showToast('Немає доступу до буферу. Вставте вручну (Ctrl+V).', 'error');
  }
}

// ─── EXAMPLE TEXT ────────────────────────────────────────────────────────────
function loadExample() {
  inputEl.value = `## Транспортна задача

Мета задачі — мінімізувати **загальні витрати на перевезення**:

$$Z = \\sum_{i=1}^{m} \\sum_{j=1}^{n} \\left( n_{ij} \\cdot t_{ij} \\cdot C_{ij} \\right) \\tag{5.2}$$

де:
- $n_{ij}$ — кількість рейсів на маршруті $i \\to j$
- $t_{ij}$ — тривалість одного рейсу (год)
- $C_{ij}$ — вартість одного рейсо-часу (грн/год)

### Обмеження

Баланс попиту та пропозиції:

$$\\sum_{j=1}^{n} n_{ij} \\leq S_i, \\quad i = 1, \\ldots, m$$

$$\\sum_{i=1}^{m} n_{ij} \\geq D_j, \\quad j = 1, \\ldots, n$$

### Вхідні дані

| Маршрут | $n_{ij}$ | $t_{ij}$ (год) | $C_{ij}$ (грн/год) |
|---------|----------|----------------|---------------------|
| A → B   | 5        | 2.5            | 120                 |
| A → C   | 3        | 4.0            | 95                  |
| B → C   | 7        | 1.8            | 110                 |

### Формула ефективності

Ефективність маршруту визначається як відношення корисного вантажу до витрат:

$$\\eta = \\frac{Q_{\\text{корисний}}}{Z} = \\frac{\\sum_{ij} q_{ij}}{\\sum_{ij} n_{ij} \\cdot t_{ij} \\cdot C_{ij}}$$

Рівняння Ейлера для перевірки: $e^{i\\pi} + 1 = 0$`;

  processInput();
  showToast('Приклад завантажено!', 'success');
}

// ─── STATS ───────────────────────────────────────────────────────────────────
function updateStats(text) {
  statChars.textContent = text.length;
  statWords.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;

  // Count math blocks
  const eqCount =
    (text.match(/\$\$[\s\S]*?\$\$/g) || []).length +
    (text.match(/\\\[[\s\S]*?\\\]/g) || []).length +
    (text.match(/\\\([\s\S]*?\\\)/g) || []).length +
    (text.match(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g) || []).length;
  statEqs.textContent = eqCount;
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function setEmptyPreviews() {
  const ph = (msg) => `
    <div class="preview-placeholder">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="m9 18 6-6-6-6"/>
      </svg>
      <p>${msg}</p>
    </div>`;

  previewRender.innerHTML = ph('Вставте текст зліва — тут з\'явиться попередній перегляд');
  previewWord.innerHTML   = ph('Тут ви побачите, як текст виглядатиме у Word');
  previewRaw.textContent  = 'HTML-код з\'явиться тут після введення тексту...';
  processedHtml     = '';
  processedWordHtml = '';
  updateStats('');
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'success') {
  toastMsg.textContent = message;
  toast.className = 'toast ' + (type === 'error' ? 'error' : '');

  // Icon
  const icons = { success: 'check-circle-2', error: 'alert-circle', info: 'info' };
  toastIcon.setAttribute('data-lucide', icons[type] || 'check-circle-2');
  if (typeof lucide !== 'undefined') lucide.createIcons();

  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
