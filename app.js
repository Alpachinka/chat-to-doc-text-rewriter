/* ====================================================
   ChatToDoc — app.js  v3.0
   Robust fix: string-split annotation removal,
   marked v12 compatible, full error handling
   ==================================================== */

'use strict';

// ─── Wait for KaTeX ──────────────────────────────────────────────────────────
function waitForKatex(cb, tries = 0) {
  if (typeof window.katex !== 'undefined') { cb(); return; }
  if (tries > 60) { console.warn('[ChatToDoc] KaTeX timed out'); cb(); return; }
  setTimeout(() => waitForKatex(cb, tries + 1), 100);
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const inputEl       = document.getElementById('input-text');
const previewRender = document.getElementById('preview-rendered');
const previewWord   = document.getElementById('preview-word');
const previewRaw    = document.getElementById('preview-raw');
const statChars     = document.getElementById('stat-chars');
const statWords     = document.getElementById('stat-words');
const statEqs       = document.getElementById('stat-eqs');
const btnCopyWord   = document.getElementById('btn-copy-word');
const btnCopyLbl    = document.getElementById('btn-copy-label');
const btnDownload   = document.getElementById('btn-download');
const btnExample    = document.getElementById('btn-example');
const btnGuide      = document.getElementById('btn-guide');
const btnClear      = document.getElementById('btn-clear');
const btnPaste      = document.getElementById('btn-paste');
const btnTheme      = document.getElementById('btn-theme');
const settingFont    = document.getElementById('setting-font');
const settingSize    = document.getElementById('setting-size');
const settingSpacing = document.getElementById('setting-spacing');
const settingCols    = document.getElementById('setting-cols');
const tabs           = document.querySelectorAll('.tab');
const tabContents    = document.querySelectorAll('.tab-content');
const modalGuide     = document.getElementById('modal-guide');
const closeGuide     = document.getElementById('close-guide');
const toast          = document.getElementById('toast');
const toastMsg       = document.getElementById('toast-message');
const iconSun        = document.getElementById('icon-sun');
const iconMoon       = document.getElementById('icon-moon');

// ─── State ───────────────────────────────────────────────────────────────────
let processedHtml     = '';
let processedWordHtml = '';
let extractedMaths    = [];
let currentTheme      = localStorage.getItem('ctd-theme') || 'dark';
let debounceTimer     = null;

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);
  waitForKatex(() => {
    setupListeners();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    console.log('[ChatToDoc] Ready. KaTeX:', typeof katex, 'Marked:', typeof marked);
  });
});

// ─── LISTENERS ───────────────────────────────────────────────────────────────
function setupListeners() {
  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processInput, 350);
  });
  tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  btnCopyWord.addEventListener('click', copyForWord);
  btnDownload.addEventListener('click', downloadHtml);
  btnExample.addEventListener('click', loadExample);
  btnClear.addEventListener('click', () => { inputEl.value = ''; processInput(); });
  btnPaste.addEventListener('click', pasteClipboard);
  btnTheme.addEventListener('click', toggleTheme);
  btnGuide.addEventListener('click', () => { modalGuide.hidden = false; });
  closeGuide.addEventListener('click', () => { modalGuide.hidden = true; });
  modalGuide.addEventListener('click', e => { if (e.target === modalGuide) modalGuide.hidden = true; });
  [settingFont, settingSize, settingSpacing, settingCols].forEach(el => el.addEventListener('change', updateWordPreview));
  inputEl.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); copyForWord(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalGuide.hidden) modalGuide.hidden = true; });
}

// ─── THEME ───────────────────────────────────────────────────────────────────
function applyTheme(t) {
  currentTheme = t;
  document.body.setAttribute('data-theme', t);
  localStorage.setItem('ctd-theme', t);
  iconSun.style.display  = t === 'dark' ? '' : 'none';
  iconMoon.style.display = t === 'dark' ? 'none' : '';
}
function toggleTheme() { applyTheme(currentTheme === 'dark' ? 'light' : 'dark'); }

// ─── TABS ────────────────────────────────────────────────────────────────────
function switchTab(id) {
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
  tabContents.forEach(c => c.classList.toggle('active', c.id === `content-${id}`));
}

// ════════════════════════════════════════════════════════════
// MATH EXTRACTION
// ════════════════════════════════════════════════════════════

function inTable(text, index) {
  let start = text.lastIndexOf('\n', index);
  start = start === -1 ? 0 : start + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  const line = text.slice(start, end).trim();
  return line.startsWith('|') || (line.includes('|') && line.length > 3);
}

function extractMath(text) {
  const maths = [];
  let idx = 0;
  let cleaned = text;

  // Block patterns first ($$...$$  and  \[...\])
  cleaned = cleaned.replace(/\$\$([\s\S]*?)\$\$/g, (match, inner, offset) => {
    const ph = `%%MATH_${idx}_D%%`;
    maths.push({ placeholder: ph, raw: inner.trim(), display: true, inTable: inTable(text, offset) });
    idx++;
    return ph;
  });
  cleaned = cleaned.replace(/\\\[([\s\S]*?)\\\]/g, (match, inner, offset) => {
    const ph = `%%MATH_${idx}_D%%`;
    maths.push({ placeholder: ph, raw: inner.trim(), display: true, inTable: inTable(text, offset) });
    idx++;
    return ph;
  });

  // Inline \(...\)
  cleaned = cleaned.replace(/\\\(([\s\S]*?)\\\)/g, (match, inner, offset) => {
    const ph = `%%MATH_${idx}_I%%`;
    maths.push({ placeholder: ph, raw: inner.trim(), display: false, inTable: inTable(text, offset) });
    idx++;
    return ph;
  });

  // Inline $...$
  cleaned = parseSingleDollar(cleaned, maths, idx, text);

  return { cleaned, maths };
}

function parseSingleDollar(text, maths, startIdx, originalText) {
  let idx = startIdx;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\' && text[i+1] === '$') { out += '$'; i += 2; continue; }

    if (text[i] === '$') {
      // Inline math must not have space immediately after opening $
      if (i + 1 < text.length && /[ \t\n]/.test(text[i+1])) {
        out += '$'; i++; continue;
      }

      let j = i + 1;
      let inner = '';
      let found = false;
      while (j < text.length) {
        if (text[j] === '\\' && text[j+1] === '$') { inner += '$'; j += 2; continue; }
        if (text[j] === '$') {
          // Must not have space immediately before closing $
          if (/[ \t\n]/.test(text[j-1])) { inner += '$'; j++; continue; }
          // Must not be followed immediately by a digit (prevents "$5 and $10" matching)
          if (j + 1 < text.length && /\d/.test(text[j+1])) { inner += '$'; j++; continue; }
          
          found = true; 
          break; 
        }
        if (text[j] === '\n') break;
        inner += text[j];
        j++;
      }

      if (found && inner.length > 0) {
        const ph = `%%MATH_${idx}_I%%`;
        // We use 'i' to check table context in the current cleaned string
        maths.push({ placeholder: ph, raw: inner.trim(), display: false, inTable: inTable(text, i) });
        idx++;
        out += ph;
        i = j + 1;
        continue;
      }
    }
    out += text[i]; i++;
  }
  return out;
}

function isProbablyCurrency(s) { return /^\s*[\d,. ]+\s*$/.test(s); }

// ════════════════════════════════════════════════════════════
// MATH RENDERING
// ════════════════════════════════════════════════════════════

// Visual HTML (KaTeX HTML for screen preview)
function renderVisual(raw, display) {
  try {
    return katex.renderToString(raw, { displayMode: display, output: 'html', throwOnError: false });
  } catch(e) {
    return `<span class="math-error" title="${escapeHtml(String(e))}">${escapeHtml(raw)}</span>`;
  }
}

/**
 * Render MathML for Word clipboard.
 *
 * THE CORE BUG FIX:
 * KaTeX always wraps equations in:
 *   <math><semantics><mrow>…</mrow><annotation encoding="application/x-tex">RAW LATEX</annotation></semantics></math>
 *
 * Word reads the <annotation> text content as PLAIN TEXT next to the equation,
 * giving the garbled "PenaltyDisk=min...Penalty_{Disk} = \min..." output.
 *
 * We use string-splitting (not regex, not DOMParser) to reliably remove it.
 */
function renderMathML(raw, display) {
  try {
    let ml = katex.renderToString(raw, {
      displayMode: display,
      output: 'mathml',
      throwOnError: false,
    });

    // ── Step 1: Remove <annotation>...</annotation> by string splitting ──────
    // This is the most reliable method (regex can fail on complex LaTeX,
    // DOMParser produces dirty namespace attributes).
    const ANN_OPEN  = '<annotation';
    const ANN_CLOSE = '</annotation>';
    let cleaned = '';
    let pos = 0;
    while (pos < ml.length) {
      const openIdx = ml.indexOf(ANN_OPEN, pos);
      if (openIdx === -1) { cleaned += ml.slice(pos); break; }
      cleaned += ml.slice(pos, openIdx); // keep everything before <annotation
      const closeIdx = ml.indexOf(ANN_CLOSE, openIdx);
      if (closeIdx === -1) break; // malformed — stop
      pos = closeIdx + ANN_CLOSE.length; // skip past </annotation>
    }
    ml = cleaned;

    // ── Step 2: Simplify <semantics> wrapper ─────────────────────────────────
    // After removing annotation, semantics may wrap a lone <mrow>; unwrap it.
    ml = ml.replace(/<semantics>\s*(<mrow[\s\S]*?<\/mrow>)\s*<\/semantics>/g, '$1');

    // ── Step 3: Ensure xmlns so Word recognises <math> as an equation ────────
    if (!ml.includes('xmlns=')) {
      ml = ml.replace('<math', '<math xmlns="http://www.w3.org/1998/Math/MathML"');
    }

    // ── Step 4: Mark display equations ───────────────────────────────────────
    if (display && !ml.includes('display=')) {
      ml = ml.replace('<math', '<math display="block"');
    }

    // ── Step 5: Wrap block equations in a centered paragraph ─────────────────
    if (display) return `<p style="text-align:center;margin:6pt 0;">${ml}</p>`;
    return ml;

  } catch (e) {
    console.error('[ChatToDoc] MathML render error:', e);
    return `<span>${escapeHtml(raw)}</span>`;
  }
}

// Reinject rendered math back into HTML (replacing placeholders)
function reinject(html, maths, mode) {
  let out = html;
  for (const { placeholder, raw, display } of maths) {
    const rendered = mode === 'mathml' ? renderMathML(raw, display) : renderVisual(raw, display);
    // Escape placeholder characters for use in a RegExp
    const esc = placeholder.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'g'), rendered);
  }
  return out;
}

// ════════════════════════════════════════════════════════════
// MARKDOWN PARSER  (marked v12 compatible)
// ════════════════════════════════════════════════════════════
function parseMarkdown(text) {
  if (typeof window.marked === 'undefined') return `<p>${escapeHtml(text)}</p>`;
  try {
    // marked v12: pass options directly to parse(), don't use setOptions with deprecated keys
    const result = window.marked.parse(text, { gfm: true, breaks: true });
    // In very old or very new marked, parse might return a Promise — handle gracefully
    if (result && typeof result.then === 'function') {
      console.warn('[ChatToDoc] marked returned Promise — using plain text fallback');
      return `<p>${escapeHtml(text)}</p>`;
    }
    return result;
  } catch (e) {
    console.error('[ChatToDoc] marked error:', e);
    return `<p>${escapeHtml(text)}</p>`;
  }
}

// ════════════════════════════════════════════════════════════
// PROCESS INPUT  (main pipeline)
// ════════════════════════════════════════════════════════════
function processInput() {
  const raw = inputEl.value;
  updateStats(raw);

  if (!raw.trim()) {
    setEmpty();
    btnCopyWord.disabled = true;
    btnDownload.disabled = true;
    return;
  }

  if (typeof window.katex === 'undefined') { showToast('KaTeX ще завантажується…', 'info'); return; }

  try {
    const { cleaned, maths } = extractMath(raw);
    extractedMaths = maths;

    const mdHtml = parseMarkdown(cleaned);

    // Screen preview (KaTeX HTML)
    processedHtml = reinject(mdHtml, maths, 'visual');

    // Word clipboard (clean MathML, no annotations)
    const mdWordHtml = parseMarkdown(cleaned); // same markdown parse
    const wordInner  = mdWordHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    processedWordHtml = reinject(wordInner, maths, 'mathml');

    previewRender.innerHTML = processedHtml;
    updateWordPreview();
    previewRaw.textContent  = buildClipboardHtml(processedWordHtml);

    renderEquationsPanel(maths);

    btnCopyWord.disabled = false;
    btnDownload.disabled = false;

    if (typeof lucide !== 'undefined') lucide.createIcons();

  } catch (e) {
    console.error('[ChatToDoc] processInput error:', e);
    showToast('Помилка обробки тексту. Перевірте консоль браузера.', 'error');
  }
}

// ─── WORD PREVIEW ────────────────────────────────────────────────────────────
function updateWordPreview() {
  if (!processedWordHtml) return;
  previewWord.innerHTML = `
    <div style="font-family:${settingFont.value},sans-serif;
                font-size:${settingSize.value};
                line-height:${settingSpacing.value};color:#000;">
      ${processedWordHtml}
    </div>`;
}

// ─── EQUATIONS PANEL ─────────────────────────────────────────────────────────
function renderEquationsPanel(maths) {
  const old = document.getElementById('eq-panel');
  if (old) old.remove();

  if (!maths.length) return;

  const mainMaths = maths.filter(m => !m.inTable);
  const tableMaths = maths.filter(m => m.inTable);

  const section = document.createElement('section');
  section.id = 'eq-panel';
  section.className = 'equations-panel';

  const renderCards = (list) => list.map(m => {
    // Find the original index for the copy button
    const originalIdx = maths.indexOf(m);
    return `
      <div class="eq-card">
        <div class="eq-card-preview" id="eqprev-${originalIdx}"></div>
        <div class="eq-card-footer">
          <span class="eq-card-type">${m.display ? 'Блочна' : 'Рядкова'}</span>
          <button class="btn-eq-copy" id="eqbtn-${originalIdx}" onclick="window.copyEqLatex(${originalIdx})">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" stroke-width="2">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            Скопіювати LaTeX
          </button>
        </div>
        <pre class="eq-latex-source">${escapeHtml(m.raw)}</pre>
      </div>
    `;
  }).join('');

  let html = '';

  if (mainMaths.length > 0) {
    html += `
      <div class="eq-panel-header">
        <div class="eq-panel-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span>Основні формули</span>
        </div>
        <div class="eq-panel-hint">
          Для вставки через Alt+= у Word (якщо Ctrl+V вставляє символи)
        </div>
      </div>
      <div class="eq-cards">${renderCards(mainMaths)}</div>
    `;
  }

  if (tableMaths.length > 0) {
    html += `
      <div class="eq-panel-header" style="${mainMaths.length > 0 ? 'margin-top: 32px;' : ''}">
        <div class="eq-panel-title">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
          <span>Формули з таблиць</span>
        </div>
        <div class="eq-panel-hint">
          Іноді в комірках таблиць бувають формули. Ви можете скопіювати їх окремо за потреби.
        </div>
      </div>
      <div class="eq-cards">${renderCards(tableMaths)}</div>
    `;
  }

  section.innerHTML = html;

  const mainLayout = document.querySelector('.main-layout');
  mainLayout.after(section);

  // Render visual equations
  maths.forEach((m, i) => {
    const el = document.getElementById(`eqprev-${i}`);
    if (!el) return;
    try {
      katex.render(m.raw, el, { displayMode: true, throwOnError: false, output: 'html' });
    } catch (e) {
      el.textContent = m.raw;
    }
  });
}

window.copyEqLatex = async function(idx) {
  const m = extractedMaths[idx];
  if (!m) return;
  const btn = document.getElementById(`eqbtn-${idx}`);
  try {
    await navigator.clipboard.writeText(m.raw);
    if (btn) {
      const orig = btn.innerHTML;
      btn.textContent = '✓ Скопійовано!';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
    showToast('LaTeX скопійовано! У Word: Alt+= → Ctrl+V → пробіл', 'success');
  } catch (e) {
    showToast('Скопіюйте LaTeX вручну з поля нижче кнопки.', 'error');
  }
};

// ─── CLIPBOARD HELPERS ───────────────────────────────────────────────────────
function buildClipboardHtml(bodyHtml) {
  const font    = settingFont.value;
  const size    = settingSize.value;
  const spacing = settingSpacing.value;
  const width   = settingCols.value === 'auto' ? '100%' : settingCols.value;

  // Word-compatible HTML with Office namespace declarations.
  // xmlns:m hints to Word that MathML content should be converted to equations.
  return `<html
  xmlns="http://www.w3.org/1999/xhtml"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<meta name="ProgId" content="Word.Document"/>
<meta name="Generator" content="Microsoft Word 15"/>
<style type="text/css">
body,p,div,li,td,th{font-family:${font},Arial,sans-serif;font-size:${size};line-height:${spacing};color:#000000;}
table{border-collapse:collapse;width:${width};}
td,th{border:1px solid #000;padding:4pt 8pt;}
th{background:#f2f2f2;font-weight:bold;}
h1{font-size:1.8em;}h2{font-size:1.4em;}h3{font-size:1.15em;}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

async function copyForWord() {
  if (!processedWordHtml) return;
  const html = buildClipboardHtml(processedWordHtml);
  const text = inputEl.value;

  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':  new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      showCopySuccess();
      return;
    } catch (err) {
      console.warn('[ChatToDoc] Clipboard API error:', err);
    }
  }

  // Legacy fallback
  try {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;';
    document.body.appendChild(tmp);
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(tmp);
    sel.removeAllRanges();
    sel.addRange(r);
    document.execCommand('copy');
    sel.removeAllRanges();
    document.body.removeChild(tmp);
    showCopySuccess();
  } catch (e2) {
    showToast('Не вдалось скопіювати. Використайте "HTML файл".', 'error');
  }
}

function showCopySuccess() {
  btnCopyLbl.textContent = '✓ Скопійовано!';
  showToast('Скопійовано! Вставте у Word (Ctrl+V). Формули не ті? — прокрутіть вниз, скористайтесь панеллю формул.', 'success');
  setTimeout(() => { btnCopyLbl.textContent = 'Скопіювати для MS Word'; }, 3000);
}

// ─── DOWNLOAD HTML ───────────────────────────────────────────────────────────
function downloadHtml() {
  if (!processedWordHtml) return;
  const blob = new Blob([buildClipboardHtml(processedWordHtml)], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'document.html' });
  a.click();
  URL.revokeObjectURL(url);
  showToast('HTML-файл завантажено', 'success');
}

// ─── PASTE ───────────────────────────────────────────────────────────────────
async function pasteClipboard() {
  try {
    const t = await navigator.clipboard.readText();
    inputEl.value = t;
    processInput();
  } catch {
    showToast('Вставте вручну (Ctrl+V у полі тексту).', 'error');
  }
}

// ─── EXAMPLE ─────────────────────────────────────────────────────────────────
function loadExample() {
  inputEl.value = `## Математичний аналіз — приклад

Корені квадратного рівняння $ax^2 + bx + c = 0$ визначаються за **формулою**:

$$x_{1,2} = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

де $D = b^2 - 4ac$ — дискримінант. Якщо $D > 0$ — два різних корені, якщо $D = 0$ — один.

### Ряд Тейлора

Функція $e^x$ розкладається у збіжний степеневий ряд:

$$e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!} = 1 + x + \\frac{x^2}{2!} + \\frac{x^3}{3!} + \\cdots$$

### Інтегральне числення

Основна теорема аналізу (формула Ньютона–Лейбніца):

$$\\int_a^b f(x)\\,dx = F(b) - F(a), \\quad \\text{де } F'(x) = f(x)$$

### Таблиця значень $\\sin(x)$

| $x$ | $0$ | $\\pi/6$ | $\\pi/4$ | $\\pi/3$ | $\\pi/2$ |
|-----|-----|---------|---------|---------|--------|
| $\\sin x$ | $0$ | $\\tfrac{1}{2}$ | $\\tfrac{\\sqrt{2}}{2}$ | $\\tfrac{\\sqrt{3}}{2}$ | $1$ |

Формула Ейлера: $e^{i\\pi} + 1 = 0$`;

  processInput();
  showToast('Приклад завантажено!', 'success');
}

// ─── STATS ───────────────────────────────────────────────────────────────────
function updateStats(text) {
  statChars.textContent = text.length;
  statWords.textContent = text.trim() ? text.trim().split(/\s+/).length : 0;
  const n =
    (text.match(/\$\$[\s\S]*?\$\$/g)    || []).length +
    (text.match(/\\\[[\s\S]*?\\\]/g)    || []).length +
    (text.match(/\\\([\s\S]*?\\\)/g)    || []).length +
    (text.match(/(?<!\$)\$(?!\$)[^$\n]+?\$(?!\$)/g) || []).length;
  statEqs.textContent = n;
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function setEmpty() {
  const ph = msg => `<div class="preview-placeholder">
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 18 6-6-6-6"/></svg>
    <p>${msg}</p></div>`;
  previewRender.innerHTML = ph('Вставте текст зліва');
  previewWord.innerHTML   = ph('Тут буде вигляд у Word');
  previewRaw.textContent  = 'HTML-код з\'явиться тут...';
  processedHtml = processedWordHtml = '';
  extractedMaths = [];
  const p = document.getElementById('eq-panel');
  if (p) p.remove();
}

// ─── TOAST ───────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  toastMsg.textContent = msg;
  toast.className = 'toast' + (type === 'error' ? ' error' : '');
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

// ─── ESCAPE ──────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
