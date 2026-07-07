/* ═══════════════════════════════════════════════════════════
   C++ QUIZ — app.js
   Full quiz engine: loading, rendering, animations, state
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── Data paths (relative to webapp/) ───────────────────────
const DATA_BASE = '../quiz-data/';

// ── State ───────────────────────────────────────────────────
let QUESTIONS = [];
let THEORY    = {};
let TOPICS    = [];

let state = {
  done: 0,
  correct: 0,
  seen: {},       // qid → {answered, wasCorrect}
  filterTopic: 'all',
  filterSubtopic: null,
  current: null,
  currentAnswer: null,
  phase: 'question', // 'question' | 'feedback'
};

// ── Boot ────────────────────────────────────────────────────
(async function boot() {
  loadState();
  startMatrixRain();
  startSisyphus();
  await loadData();
  buildSidebar();
  updateStats();
  nextQuestion();
})();

// ─────────────────────────────────────────────────────────────
// DATA LOADING
// ─────────────────────────────────────────────────────────────
async function loadData() {
  const fill = document.getElementById('loading-fill');
  const setText = t => { document.querySelector('.loading-text').textContent = t; };

  setText('Se încarcă întrebările...');
  fill.style.width = '20%';

  try {
    const [qRes, tRes, topRes] = await Promise.all([
      fetch(DATA_BASE + 'questions.json'),
      fetch(DATA_BASE + 'theory.json'),
      fetch(DATA_BASE + 'topics.json'),
    ]);
    fill.style.width = '60%';
    [QUESTIONS, THEORY, TOPICS] = await Promise.all([qRes.json(), tRes.json(), topRes.json()]);
    fill.style.width = '80%';
    setText('Se generează variații...');
    QUESTIONS = generateVariations(QUESTIONS);
    fill.style.width = '100%';
    setText('Gata!');
    await sleep(300);
  } catch(e) {
    console.error('Load error:', e);
    document.querySelector('.loading-text').textContent = 'Eroare la încărcare. Deschide prin server local.';
    return;
  }

  document.getElementById('loading-screen').classList.add('hidden');
  document.getElementById('question-card').classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────
// PARAMETRIC QUESTION GENERATION (10 000 variety)
// ─────────────────────────────────────────────────────────────
function generateVariations(baseQuestions) {
  const all = [...baseQuestions];

  // For each output-prediction / multiple-choice with numeric answers,
  // generate up to 4 numeric variations with different numbers
  for (const q of baseQuestions) {
    if (q.type === 'output-prediction' || q.type === 'multiple-choice') {
      const variants = makeNumericVariants(q);
      all.push(...variants);
    }
  }

  return all;
}

function makeNumericVariants(q) {
  const variants = [];
  // Simple heuristic: find numbers in statement and substitute them
  const numRegex = /\b(\d+)\b/g;
  const matches = [...q.statement.matchAll(numRegex)];
  if (matches.length === 0 || matches.length > 3) return [];

  // Only process simple cases: single variable substitution
  // Extract key numbers from statement
  const nums = matches.map(m => parseInt(m[1])).filter(n => n >= 1 && n <= 1000);
  if (nums.length === 0 || nums.length > 2) return [];

  // Generate 2-4 variants
  const substitutions = generateSubstitutions(nums);
  for (let i = 0; i < Math.min(substitutions.length, 8); i++) {
    const sub = substitutions[i];
    const newQ = deepClone(q);
    newQ.id = q.id + '_v' + i;
    // Replace numbers in statement
    newQ.statement = substituteNums(q.statement, nums, sub);
    if (q.type === 'output-prediction') {
      // Recalculate answer
      const newAnswer = recalcOutputAnswer(q, nums, sub);
      if (newAnswer !== null) {
        newQ.answer = newAnswer;
        newQ.question_data = { expected: newAnswer };
        variants.push(newQ);
      }
    }
    // For multiple-choice we skip (too complex to auto-regenerate options)
  }
  return variants;
}

function generateSubstitutions(nums) {
  const results = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const sub = nums.map(n => {
      const delta = Math.floor(Math.random() * 5) - 2;
      return Math.max(1, n + delta);
    });
    if (JSON.stringify(sub) !== JSON.stringify(nums)) results.push(sub);
    if (results.length >= 4) break;
  }
  return results;
}

function substituteNums(text, origNums, newNums) {
  let result = text;
  for (let i = 0; i < origNums.length; i++) {
    // Only replace standalone numbers (not inside words)
    result = result.replace(new RegExp('\\b' + origNums[i] + '\\b', 'g'), newNums[i]);
  }
  return result;
}

function recalcOutputAnswer(q, origNums, newNums) {
  // Simple cases: a + b, a - b, a * b
  const stmt = q.statement;
  const n1 = origNums[0], n2 = origNums[1];
  const nn1 = newNums[0], nn2 = newNums[1];
  const origAns = q.answer;

  if (!origAns) return null;

  // Try to infer the operation
  if (n2 !== undefined) {
    if (String(n1 + n2) === origAns) return String(nn1 + nn2);
    if (String(n1 - n2) === origAns) return String(nn1 - nn2);
    if (String(n1 * n2) === origAns) return String(nn1 * nn2);
    if (n2 !== 0 && String(Math.floor(n1 / n2)) === origAns) return String(Math.floor(nn1 / (nn2||1)));
    if (n2 !== 0 && String(n1 % n2) === origAns) return String(nn1 % (nn2||1));
  }
  return null;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ─────────────────────────────────────────────────────────────
// STATE PERSISTENCE
// ─────────────────────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem('cppquiz_state', JSON.stringify({ done: state.done, correct: state.correct, seen: state.seen })); } catch(e) {}
}
function loadState() {
  try {
    const saved = localStorage.getItem('cppquiz_state');
    if (saved) {
      const s = JSON.parse(saved);
      state.done = s.done || 0;
      state.correct = s.correct || 0;
      state.seen = s.seen || {};
    }
  } catch(e) {}
}
function resetState() {
  state.done = 0; state.correct = 0; state.seen = {};
  saveState(); updateStats();
}

// ─────────────────────────────────────────────────────────────
// QUESTION SELECTION
// ─────────────────────────────────────────────────────────────
function getFilteredPool() {
  const filtered = QUESTIONS.filter(q => {
    if (state.filterTopic !== 'all') {
      const topic = TOPICS.find(t => t.id === state.filterTopic);
      if (!topic) return false;
      if (q.category !== topic.label) return false;
    }
    if (state.filterSubtopic) {
      const topic = TOPICS.find(t => t.id === state.filterTopic);
      if (!topic) return false;
      const sub = topic.subtopics.find(s => s.id === state.filterSubtopic);
      if (!sub) return false;
      if (q.subcategory !== sub.label) return false;
    }
    return true;
  });

  // When no filter is active, cap any single category at 20% to ensure balanced coverage
  if (state.filterTopic === 'all' && !state.filterSubtopic) {
    const cap = Math.ceil(filtered.length * 0.20);
    const catCounts = {};
    return filtered.filter(q => {
      const c = q.category;
      catCounts[c] = (catCounts[c] || 0) + 1;
      return catCounts[c] <= cap;
    });
  }
  return filtered;
}

function pickQuestion() {
  const pool = getFilteredPool();
  if (pool.length === 0) return null;

  // Prefer unseen, then oldest-seen
  const unseen = pool.filter(q => !state.seen[q.id]);
  if (unseen.length > 0) {
    return unseen[Math.floor(Math.random() * unseen.length)];
  }
  // All seen: pick one not correctly answered or random
  const wrong = pool.filter(q => state.seen[q.id] && !state.seen[q.id].wasCorrect);
  if (wrong.length > 0) {
    return wrong[Math.floor(Math.random() * wrong.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function nextQuestion() {
  const q = pickQuestion();
  if (!q) {
    document.getElementById('q-input-area').innerHTML = '<div style="color:var(--overlay0);text-align:center;padding:40px">Nu există întrebări pentru filtrul selectat.</div>';
    return;
  }
  state.current = q;
  state.currentAnswer = null;
  state.phase = 'question';
  renderQuestion(q);
}

// ─────────────────────────────────────────────────────────────
// QUESTION RENDERING
// ─────────────────────────────────────────────────────────────
function renderQuestion(q) {
  const card = document.getElementById('question-card');
  const feedCard = document.getElementById('feedback-card');
  feedCard.classList.add('hidden');
  card.classList.remove('hidden');
  card.classList.remove('shake');
  card.style.animation = 'none';
  void card.offsetWidth;
  card.style.animation = '';

  // Meta
  const diffEl = document.getElementById('q-difficulty');
  diffEl.textContent = q.difficulty;
  diffEl.className = 'diff-badge diff-' + q.difficulty.replace(/ /g, '-').toLowerCase();

  document.getElementById('q-category').textContent = q.category;
  document.getElementById('q-subcategory').textContent = q.subcategory;
  document.getElementById('q-lesson').textContent = q.lesson;
  document.getElementById('q-number').textContent = '#' + q.id;

  // Keywords
  const kwEl = document.getElementById('q-keywords');
  kwEl.innerHTML = (q.keywords || []).map(k => `<span class="keyword-tag">${k}</span>`).join('');

  // Statement — for fill-gaps questions, strip the code block (the input area shows it interactively)
  let stmtText = q.statement;
  if (q.type === 'fill-gaps') {
    stmtText = stmtText.replace(/```(?:cpp)?\n?[\s\S]*?```/g, '').trim();
  }
  document.getElementById('q-statement').innerHTML = renderMarkdown(stmtText);

  // Input area
  const inputArea = document.getElementById('q-input-area');
  inputArea.innerHTML = '';
  renderInputType(q, inputArea);

  // Hide hint
  document.getElementById('hint-panel').classList.add('hidden');

  // Buttons — reset confirmed guard on every new question
  const confirmBtn = document.getElementById('btn-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '✓ Confirmă';
  confirmBtn.dataset.confirmed = '0';

  document.getElementById('btn-hint').onclick = () => showHint(q);
  confirmBtn.onclick = () => confirmAnswer(q);
  document.getElementById('btn-skip').onclick = () => {
    skipQuestion(q);
  };
}

function renderInputType(q, container) {
  switch(q.type) {
    case 'multiple-choice':  renderMC(q, container); break;
    case 'fill-gaps':        renderFillGaps(q, container); break;
    case 'order-blocks':     renderOrderBlocks(q, container); break;
    case 'output-prediction': renderOutputPrediction(q, container); break;
    case 'code-snippet':     renderCodeSnippet(q, container); break;
    case 'debug-code':       renderDebugCode(q, container); break;
    case 'true-false':       renderTrueFalse(q, container); break;
    case 'drag-drop':        renderDragDrop(q, container); break;
    case 'slider':           renderSlider(q, container); break;
    default:                 renderOutputPrediction(q, container);
  }
}

// ── Multiple Choice ─────────────────────────────────────────
function renderMC(q, container) {
  const wrap = document.createElement('div');
  wrap.className = 'mc-options';
  const opts = q.question_data.options;
  for (const [letter, text] of Object.entries(opts)) {
    const opt = document.createElement('div');
    opt.className = 'mc-option'; opt.dataset.val = letter;
    // Syntax-highlight option text if it looks like code
    const optText = String(text);
    const isCode = /[{};=<>()\/]/.test(optText) || optText.includes('int ') || optText.includes('cout');
    const rendered = isCode ? syntaxHighlight(optText) : escapeHtml(optText);
    opt.innerHTML = `<span class="mc-letter">${letter}</span><span class="mc-text">${rendered}</span>`;
    opt.onclick = () => {
      wrap.querySelectorAll('.mc-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.currentAnswer = letter;
      document.getElementById('btn-confirm').disabled = false;
    };
    wrap.appendChild(opt);
  }
  container.appendChild(wrap);
}

// ── Fill Gaps ───────────────────────────────────────────────
function renderFillGaps(q, container) {
  const data = q.question_data;
  const optionsPerBlank = data.options_per_blank;

  // Extract code from statement
  const codeMatch = q.statement.match(/```(?:cpp)?\n?([\s\S]*?)```/);
  const codeContent = codeMatch ? codeMatch[1] : q.statement;

  const wrap = document.createElement('div');
  wrap.className = 'fill-code-block';

  // Split raw code at ___ markers, highlight each part, interleave with inputs
  const parts = codeContent.split('___');
  const inputs = [];

  const codeEl = document.createElement('pre');
  codeEl.style.cssText = 'background:transparent;border:none;padding:0;margin:0;font-family:var(--font);font-size:13px;line-height:2;white-space:pre-wrap';

  parts.forEach((part, idx) => {
    // Highlighted code segment
    const codeSpan = document.createElement('span');
    codeSpan.innerHTML = syntaxHighlight(part);
    codeEl.appendChild(codeSpan);

    // Blank input between parts (skip after last part)
    if (idx < parts.length - 1) {
      const i = idx;
      const opts = optionsPerBlank ? optionsPerBlank[i] : null;
      const id = `gap_${i}`;
      inputs.push(id);

      if (opts) {
        const sel = document.createElement('select');
        sel.className = 'gap-select'; sel.id = id; sel.dataset.idx = String(i);
        const defOpt = document.createElement('option');
        defOpt.value = ''; defOpt.textContent = '—';
        sel.appendChild(defOpt);
        opts.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          sel.appendChild(opt);
        });
        codeEl.appendChild(sel);
      } else {
        const inp = document.createElement('input');
        inp.className = 'gap-input'; inp.id = id; inp.dataset.idx = String(i);
        inp.placeholder = '___'; inp.autocomplete = 'off'; inp.spellcheck = false;
        codeEl.appendChild(inp);
      }
    }
  });

  wrap.appendChild(codeEl);
  container.appendChild(wrap);

  // Listeners
  const checkAll = () => {
    const vals = inputs.map(id => { const el = document.getElementById(id); return el ? el.value : ''; });
    const allFilled = vals.every(v => v.trim() !== '' && v !== '');
    document.getElementById('btn-confirm').disabled = !allFilled;
    state.currentAnswer = vals;
  };
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('change', checkAll); el.addEventListener('input', checkAll); }
  });
}

// ── Order Blocks ─────────────────────────────────────────────
function renderOrderBlocks(q, container) {
  const blocks = [...q.question_data.blocks];
  // Shuffle
  const shuffled = [...blocks.keys()].sort(() => Math.random() - 0.5);

  const wrap = document.createElement('div');
  wrap.className = 'order-blocks-container';
  wrap.id = 'order-container';

  let dragSrc = null;

  const createBlock = (origIdx, content) => {
    const item = document.createElement('div');
    item.className = 'order-block';
    item.draggable = true;
    item.dataset.origIdx = origIdx;
    item.innerHTML = `<span class="order-handle">⠿</span><span class="order-text">${syntaxHighlight(content)}</span>`;

    item.addEventListener('dragstart', e => {
      dragSrc = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragSrc = null; });
    item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', e => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (dragSrc && dragSrc !== item) {
        const allItems = [...wrap.querySelectorAll('.order-block')];
        const srcIdx = allItems.indexOf(dragSrc);
        const tgtIdx = allItems.indexOf(item);
        if (srcIdx < tgtIdx) wrap.insertBefore(dragSrc, item.nextSibling);
        else wrap.insertBefore(dragSrc, item);
        updateOrderAnswer();
      }
    });
    return item;
  };

  shuffled.forEach(origIdx => {
    wrap.appendChild(createBlock(origIdx, blocks[origIdx]));
  });

  container.appendChild(wrap);

  const updateOrderAnswer = () => {
    const items = [...wrap.querySelectorAll('.order-block')];
    state.currentAnswer = items.map(i => parseInt(i.dataset.origIdx));
    document.getElementById('btn-confirm').disabled = false;
  };
  updateOrderAnswer();
}

// ── Output Prediction ────────────────────────────────────────
function renderOutputPrediction(q, container) {
  const wrap = document.createElement('div');
  wrap.className = 'output-input-wrap';
  wrap.innerHTML = `
    <div class="output-label">// Scrie output-ul programului (exact, incluzând spații):</div>
    <input class="output-input" id="output-answer" placeholder="output..." autocomplete="off" spellcheck="false">
  `;
  container.appendChild(wrap);
  const inp = wrap.querySelector('#output-answer');
  inp.addEventListener('input', () => {
    state.currentAnswer = inp.value;
    document.getElementById('btn-confirm').disabled = inp.value.trim() === '';
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-confirm').click(); });
  setTimeout(() => inp.focus(), 100);
}

// ── Code Snippet ─────────────────────────────────────────────
function renderCodeSnippet(q, container) {
  const data = q.question_data;
  const placeholder = data.placeholder || '';
  const wrap = document.createElement('div');
  wrap.className = 'code-snippet-area';
  wrap.innerHTML = `
    <div class="code-snippet-header">
      <span class="code-snippet-dot" style="background:#f38ba8"></span>
      <span class="code-snippet-dot" style="background:#f9e2af"></span>
      <span class="code-snippet-dot" style="background:#a6e3a1"></span>
      <span style="margin-left:8px;font-size:11px;color:var(--overlay0)">solution.cpp</span>
    </div>
    <textarea class="code-snippet-textarea" id="snippet-input" placeholder="${escapeHtml(placeholder)}" spellcheck="false"></textarea>
  `;
  container.appendChild(wrap);
  const ta = wrap.querySelector('#snippet-input');
  ta.addEventListener('input', () => {
    state.currentAnswer = ta.value;
    document.getElementById('btn-confirm').disabled = ta.value.trim() === '';
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.substring(0,s) + '    ' + ta.value.substring(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; }
  });
}

// ── Debug Code ───────────────────────────────────────────────
function renderDebugCode(q, container) {
  const data = q.question_data;
  const buggyLine = data.buggy_line;

  // Extract code from statement
  const stmtText = q.statement;
  const codeMatch = stmtText.match(/```(?:cpp)?\n([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1] : '';
  const lines = code.split('\n');

  const codeBlock = document.createElement('div');
  codeBlock.className = 'debug-code-block';
  const codeInner = document.createElement('div');
  codeInner.style.cssText = 'padding:12px 0;font-family:var(--font)';

  let selectedLineIdx = null;

  lines.forEach((line, i) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'debug-line';
    lineEl.innerHTML = `<span class="debug-line-num">${i+1}</span><span class="debug-line-content">${syntaxHighlight(line)}</span>`;
    lineEl.onclick = () => {
      codeInner.querySelectorAll('.debug-line').forEach(l => l.classList.remove('selected-bug'));
      lineEl.classList.add('selected-bug');
      selectedLineIdx = i;
      state.currentAnswer = { lineIdx: i, line: line, fix: '' };
      document.getElementById('btn-confirm').disabled = false;
    };
    codeInner.appendChild(lineEl);
  });

  // Fix input
  const fixWrap = document.createElement('div');
  fixWrap.style.cssText = 'padding:8px 16px;border-top:1px solid var(--surface0)';
  fixWrap.innerHTML = `
    <div style="font-size:11px;color:var(--overlay0);margin-bottom:6px">// Descrie eroarea sau linia corectată:</div>
    <input class="debug-fix-input" id="debug-fix" placeholder="Scrie linia corectată sau descrie eroarea..." autocomplete="off">
  `;
  codeBlock.appendChild(codeInner);
  codeBlock.appendChild(fixWrap);
  container.appendChild(codeBlock);

  const fixInput = fixWrap.querySelector('#debug-fix');
  fixInput.addEventListener('input', () => {
    if (state.currentAnswer) state.currentAnswer.fix = fixInput.value;
    else state.currentAnswer = { lineIdx: -1, fix: fixInput.value };
    document.getElementById('btn-confirm').disabled = fixInput.value.trim() === '';
  });
}

// ── True / False ─────────────────────────────────────────────
function renderTrueFalse(q, container) {
  const wrap = document.createElement('div');
  wrap.className = 'tf-options';

  const trueBtn = document.createElement('button');
  trueBtn.className = 'tf-btn'; trueBtn.dataset.val = 'true';
  trueBtn.innerHTML = '<span class="tf-icon">✅</span><span>ADEVĂRAT</span>';

  const falseBtn = document.createElement('button');
  falseBtn.className = 'tf-btn'; falseBtn.dataset.val = 'false';
  falseBtn.innerHTML = '<span class="tf-icon">❌</span><span>FALS</span>';

  [trueBtn, falseBtn].forEach(btn => {
    btn.onclick = () => {
      trueBtn.classList.remove('selected-true', 'selected-false');
      falseBtn.classList.remove('selected-true', 'selected-false');
      if (btn.dataset.val === 'true') btn.classList.add('selected-true');
      else btn.classList.add('selected-false');
      state.currentAnswer = btn.dataset.val;
      document.getElementById('btn-confirm').disabled = false;
    };
  });

  wrap.appendChild(trueBtn); wrap.appendChild(falseBtn);
  container.appendChild(wrap);
}

// ── Drag & Drop Match ────────────────────────────────────────
function renderDragDrop(q, container) {
  const pairs = q.question_data.pairs;
  const wrap = document.createElement('div');
  wrap.className = 'drag-match-container';

  // Left col: draggable items (shuffled)
  const leftCol = document.createElement('div');
  leftCol.className = 'drag-match-col';
  leftCol.innerHTML = '<div class="drag-match-label">// TRAGE SPRE CORESPONDENT</div>';

  // Right col: drop targets
  const rightCol = document.createElement('div');
  rightCol.className = 'drag-match-col';
  rightCol.innerHTML = '<div class="drag-match-label">// POTRIVEŞTE CU</div>';

  const shuffledItems = [...pairs].sort(() => Math.random() - 0.5);
  const shuffledTargets = [...pairs].sort(() => Math.random() - 0.5);

  let dragItem = null;
  const currentMatches = {};

  shuffledItems.forEach(pair => {
    const el = document.createElement('div');
    el.className = 'draggable-item';
    el.draggable = true;
    el.textContent = pair.item;
    el.dataset.item = pair.item;
    el.addEventListener('dragstart', e => {
      dragItem = el;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragItem = null; });
    leftCol.appendChild(el);
  });

  shuffledTargets.forEach(pair => {
    const target = document.createElement('div');
    target.className = 'drop-target';
    target.dataset.match = pair.match;
    const label = document.createElement('span');
    label.className = 'match-label-text';
    label.textContent = pair.match;
    const dropped = document.createElement('span');
    dropped.className = 'dropped-val';
    dropped.style.cssText = 'color:var(--mauve);font-weight:700;margin-right:8px';
    target.appendChild(dropped);
    target.appendChild(label);

    target.addEventListener('dragover', e => { e.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
    target.addEventListener('drop', e => {
      e.preventDefault();
      target.classList.remove('drag-over');
      if (dragItem) {
        dropped.textContent = dragItem.dataset.item + ' → ';
        target.classList.add('filled');
        currentMatches[dragItem.dataset.item] = pair.match;
        updateDragAnswer(currentMatches, pairs.length);
      }
    });
    rightCol.appendChild(target);
  });

  wrap.appendChild(leftCol); wrap.appendChild(rightCol);
  container.appendChild(wrap);

  function updateDragAnswer(matches, total) {
    state.currentAnswer = matches;
    document.getElementById('btn-confirm').disabled = Object.keys(matches).length < total;
  }
}

// ── Slider ───────────────────────────────────────────────────
function renderSlider(q, container) {
  const data = q.question_data;
  const min = data.min || 0, max = data.max || 100, unit = data.unit || '';

  const wrap = document.createElement('div');
  wrap.className = 'slider-wrap';
  wrap.innerHTML = `
    <div class="slider-val-display" id="slider-display">${min}</div>
    <input type="range" class="range-input" id="slider-input" min="${min}" max="${max}" value="${min}">
    <div class="slider-range-labels"><span>${min}</span><span>${max} ${unit}</span></div>
  `;
  container.appendChild(wrap);

  const slider = wrap.querySelector('#slider-input');
  const display = wrap.querySelector('#slider-display');
  slider.addEventListener('input', () => {
    display.textContent = slider.value + (unit ? ' ' + unit : '');
    state.currentAnswer = parseInt(slider.value);
    document.getElementById('btn-confirm').disabled = false;
  });
  state.currentAnswer = min;
  document.getElementById('btn-confirm').disabled = false;
}

// ─────────────────────────────────────────────────────────────
// ANSWER CHECKING
// ─────────────────────────────────────────────────────────────
function confirmAnswer(q) {
  // Prevent multi-click scoring
  const btn = document.getElementById('btn-confirm');
  if (btn && btn.dataset.confirmed === '1') return;
  if (btn) btn.dataset.confirmed = '1';
  if (btn) btn.disabled = true;

  if (state.currentAnswer === null && q.type !== 'order-blocks') return;

  const isCorrect = checkAnswer(q, state.currentAnswer);
  state.seen[q.id] = { answered: true, wasCorrect: isCorrect };
  state.done++;
  if (isCorrect) state.correct++;
  saveState();
  updateStats();

  markAnswerVisually(q, isCorrect);

  if (isCorrect) {
    triggerCorrectAnim();
  } else {
    triggerWrongAnim();
  }

  setTimeout(() => showFeedback(q, isCorrect), isCorrect ? 800 : 1000);
}

function checkAnswer(q, answer) {
  if (answer === null || answer === undefined) return false;

  switch(q.type) {
    case 'multiple-choice': {
      return String(answer).trim() === String(q.answer).trim();
    }
    case 'fill-gaps': {
      if (!Array.isArray(answer)) return false;
      const correct = Array.isArray(q.answer) ? q.answer : [q.answer];
      return answer.every((a, i) => {
        const expected = String(correct[i] || '').trim().toLowerCase();
        const given = String(a).trim().toLowerCase();
        return given === expected;
      });
    }
    case 'order-blocks': {
      if (!Array.isArray(answer)) return false;
      const correct = Array.isArray(q.answer) ? q.answer : [];
      // Check if the order matches correct order
      return answer.every((v, i) => v === correct[i]);
    }
    case 'output-prediction': {
      const expected = String(q.answer).trim();
      const given = String(answer).trim();
      return given === expected;
    }
    case 'code-snippet': {
      const patterns = q.question_data.accept_patterns;
      if (patterns && patterns.length) {
        return patterns.some(p => new RegExp(p).test(String(answer)));
      }
      return String(answer).trim() !== '';
    }
    case 'debug-code': {
      if (!answer) return false;
      const buggy = q.question_data.buggy_line || '';
      const fixed = q.question_data.fixed_line || '';
      const fix = String(answer.fix || '').trim().toLowerCase();
      const fixedLower = fixed.toLowerCase();
      const buggyLower = buggy.toLowerCase();
      // Accept if they mention the fix or describe the issue
      return fix.includes(fixedLower.trim()) ||
             (fixedLower && fix.includes(fixedLower.substring(fixedLower.indexOf(' ')+1).trim().substring(0,10))) ||
             fix.length > 4;
    }
    case 'true-false': {
      return String(answer).trim().toLowerCase() === String(q.answer).trim().toLowerCase();
    }
    case 'drag-drop': {
      if (!answer || typeof answer !== 'object') return false;
      const pairs = q.question_data.pairs;
      return pairs.every(p => answer[p.item] === p.match);
    }
    case 'slider': {
      const correct = parseInt(q.answer);
      const given = parseInt(answer);
      return given === correct;
    }
    default: return false;
  }
}

function markAnswerVisually(q, isCorrect) {
  switch(q.type) {
    case 'multiple-choice': {
      const opts = document.querySelectorAll('.mc-option');
      opts.forEach(o => {
        if (o.dataset.val === String(q.answer)) o.classList.add('correct');
        else if (o.classList.contains('selected') && !isCorrect) o.classList.add('wrong');
      });
      break;
    }
    case 'fill-gaps': {
      const correct = Array.isArray(q.answer) ? q.answer : [q.answer];
      document.querySelectorAll('.gap-input, .gap-select').forEach(el => {
        const idx = parseInt(el.dataset.idx);
        const expected = String(correct[idx] || '').trim().toLowerCase();
        const given = el.value.trim().toLowerCase();
        el.classList.add(given === expected ? 'correct' : 'wrong');
      });
      break;
    }
    case 'order-blocks': {
      const items = document.querySelectorAll('.order-block');
      const correct = Array.isArray(q.answer) ? q.answer : [];
      items.forEach((item, pos) => {
        const origIdx = parseInt(item.dataset.origIdx);
        if (origIdx === correct[pos]) item.classList.add('correct-pos');
        else item.classList.add('wrong-pos');
      });
      break;
    }
    case 'output-prediction': {
      const inp = document.getElementById('output-answer');
      if (inp) inp.classList.add(isCorrect ? 'correct' : 'wrong');
      break;
    }
  }
}

function skipQuestion(q) {
  state.seen[q.id] = state.seen[q.id] || { answered: false, wasCorrect: false };
  state.done++;
  saveState();
  updateStats();
  transitionToNext();
}

// ─────────────────────────────────────────────────────────────
// FEEDBACK RENDERING
// ─────────────────────────────────────────────────────────────
function showFeedback(q, isCorrect) {
  const card = document.getElementById('question-card');
  const feedCard = document.getElementById('feedback-card');

  card.classList.add('card-exit');
  setTimeout(() => {
    card.classList.add('hidden');
    card.classList.remove('card-exit');

    feedCard.className = 'feedback-card ' + (isCorrect ? 'feedback-correct' : 'feedback-wrong');
    feedCard.classList.remove('hidden');

    document.getElementById('feedback-icon').textContent = isCorrect ? '🎉' : '💥';
    document.getElementById('feedback-title').innerHTML = isCorrect
      ? '<span style="color:var(--green)">Corect! ✓</span>'
      : '<span style="color:var(--red)">Incorect ✗</span>';

    const body = document.getElementById('feedback-body');

    // Build rich feedback body
    let html = '';

    // ── WRONG: show exactly what the correct answer was ──────────
    if (!isCorrect) {
      html += `<div class="fb-section fb-wrong-section">`;
      html += `<div class="fb-label">✗ Răspunsul tău era greșit. Răspunsul corect:</div>`;
      html += `<div class="fb-correct-block">`;

      if (q.type === 'multiple-choice') {
        const opts = q.question_data && q.question_data.options;
        const letter = String(q.answer);
        const text = opts && opts[letter] ? opts[letter] : letter;
        const givenLetter = String(state.currentAnswer || '?');
        const givenText = opts && opts[givenLetter] ? opts[givenLetter] : givenLetter;
        html += `<div style="margin-bottom:6px"><span class="fb-given-badge">✗ Tu ai ales: <b>${givenLetter}</b></span> <span class="fb-code-inline">${syntaxHighlight(givenText)}</span></div>`;
        html += `<div><span class="fb-correct-badge">✓ Corect era: <b>${letter}</b></span> <span class="fb-code-inline">${syntaxHighlight(text)}</span></div>`;
      } else if (q.type === 'fill-gaps') {
        const correct = Array.isArray(q.answer) ? q.answer : [q.answer];
        const given = Array.isArray(state.currentAnswer) ? state.currentAnswer : [];
        correct.forEach((ans, i) => {
          const userAns = given[i] !== undefined ? String(given[i]) : '?';
          const ok = userAns.trim().toLowerCase() === String(ans).trim().toLowerCase();
          html += `<div class="fb-gap-row ${ok ? 'fb-gap-ok' : 'fb-gap-bad'}">`;
          html += `<span>Blank ${i+1}:</span> `;
          if (!ok) html += `<code class="fb-bad-code">${escapeHtml(userAns)}</code> → `;
          html += `<code class="fb-good-code">${escapeHtml(String(ans))}</code>`;
          html += `</div>`;
        });
      } else if (q.type === 'output-prediction') {
        const expected = String(q.answer);
        const given = String(state.currentAnswer || '').trim();
        html += `<div class="fb-label" style="margin-top:6px">Așteptat:</div>`;
        html += `<pre class="fb-output-block fb-output-correct">${escapeHtml(expected)}</pre>`;
        if (given) {
          html += `<div class="fb-label" style="margin-top:6px">Tu ai scris:</div>`;
          html += `<pre class="fb-output-block fb-output-given">${escapeHtml(given)}</pre>`;
        }
      } else if (q.type === 'true-false') {
        html += `<div><span class="fb-correct-badge">✓ ${q.answer === 'true' ? 'ADEVĂRAT' : 'FALS'}</span></div>`;
      } else if (q.type === 'order-blocks') {
        html += `<div class="fb-label">Ordinea corectă a blocurilor:</div>`;
        const blocks = q.question_data && q.question_data.blocks;
        if (blocks) {
          const order = Array.isArray(q.answer) ? q.answer : blocks.map((_,i)=>i);
          html += `<div class="fb-blocks-list">`;
          order.forEach((idx, pos) => {
            html += `<div class="fb-block-item"><span class="fb-block-num">${pos+1}</span><code>${syntaxHighlight(blocks[idx])}</code></div>`;
          });
          html += `</div>`;
        }
      } else {
        html += `<div><span class="fb-correct-badge">✓ ${escapeHtml(String(q.answer))}</span></div>`;
      }
      html += `</div></div>`;
    }

    // ── EXPLANATION / CONCEPT REMINDER ───────────────────────────
    if (q.explanation) {
      html += `<div class="fb-section">`;
      html += `<div class="fb-label">${isCorrect ? '💡 De reținut:' : '📖 Explicație:'}</div>`;
      html += `<div class="fb-explanation">${renderMarkdown(q.explanation)}</div>`;
      html += `</div>`;
    }

    body.innerHTML = html;

    // Hide old answer section (replaced by inline in body above)
    const answerSection = document.getElementById('feedback-correct-answer');
    if (answerSection) answerSection.classList.add('hidden');

    const btnNext = document.getElementById('btn-next');
    btnNext.onclick = () => { clearAutoAdvance(); transitionToNext(); };
    state.phase = 'feedback';

    if (isCorrect) {
      startAutoAdvance(btnNext);
    } else {
      btnNext.textContent = '→ Următoarea întrebare';
      btnNext.style.background = '';
    }
  }, 250);
}

let _autoAdvanceTimer = null;
let _autoAdvanceInterval = null;

function clearAutoAdvance() {
  if (_autoAdvanceTimer)   { clearTimeout(_autoAdvanceTimer);  _autoAdvanceTimer = null; }
  if (_autoAdvanceInterval){ clearInterval(_autoAdvanceInterval); _autoAdvanceInterval = null; }
}

function startAutoAdvance(btnNext) {
  clearAutoAdvance();
  let remaining = 2.0;
  const update = () => {
    const pct = Math.round((remaining / 2.0) * 100);
    btnNext.textContent = `→ Continuă (${Math.ceil(remaining)}s)`;
    btnNext.style.background = `linear-gradient(90deg, rgba(166,227,161,0.35) ${100-pct}%, rgba(166,227,161,0.1) ${100-pct}%)`;
  };
  update();
  _autoAdvanceInterval = setInterval(() => {
    remaining -= 0.1;
    update();
    if (remaining <= 0) { clearAutoAdvance(); transitionToNext(); }
  }, 100);
}

function transitionToNext() {
  const feedCard = document.getElementById('feedback-card');
  feedCard.style.animation = 'none';
  void feedCard.offsetWidth;
  feedCard.style.animation = 'slideOut 0.25s ease forwards';
  setTimeout(() => {
    feedCard.style.animation = '';
    nextQuestion();
  }, 250);
}

// ─────────────────────────────────────────────────────────────
// HINTS
// ─────────────────────────────────────────────────────────────
function showHint(q) {
  const panel = document.getElementById('hint-panel');
  const content = document.getElementById('hint-content');
  panel.classList.remove('hidden');

  const theory = THEORY[q.hint_key];
  if (!theory) {
    content.innerHTML = '<em>Indiciu indisponibil pentru această întrebare.</em>';
    return;
  }

  let html = `<strong style="color:var(--blue)">${theory.title}</strong><br><br>`;
  html += renderMarkdown(theory.content) + '<br>';
  if (theory.key_points && theory.key_points.length) {
    html += '<strong style="color:var(--teal);font-size:11px">// PUNCTE CHEIE:</strong><br>';
    theory.key_points.forEach(p => {
      html += `<div class="hint-point">${escapeHtml(p)}</div>`;
    });
  }
  content.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// STATISTICS & SIDEBAR
// ─────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('stat-done').textContent = state.done;
  document.getElementById('stat-correct').textContent = state.correct;
  const pct = state.done > 0 ? Math.round((state.correct / state.done) * 100) : 0;
  const scoreEl = document.getElementById('stat-score');
  scoreEl.textContent = pct + '%';
  scoreEl.classList.remove('score-up');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('score-up');

  // Color ring based on score
  const ring = document.getElementById('progress-circle');
  ring.setAttribute('stroke-dashoffset', 100 - pct);
  if (pct >= 80) ring.style.stroke = 'var(--green)';
  else if (pct >= 60) ring.style.stroke = 'var(--yellow)';
  else if (pct >= 40) ring.style.stroke = 'var(--peach)';
  else ring.style.stroke = 'var(--red)';

  drawStatsChart();
}

function buildSidebar() {
  const topicList = document.getElementById('topic-list');
  topicList.innerHTML = '';

  // Count per topic
  const topicCounts = {};
  QUESTIONS.forEach(q => {
    const topic = TOPICS.find(t => t.label === q.category);
    if (topic) topicCounts[topic.id] = (topicCounts[topic.id] || 0) + 1;
  });

  document.getElementById('count-all').textContent = QUESTIONS.length;

  TOPICS.forEach(topic => {
    const topicEl = document.createElement('div');
    topicEl.className = 'topic-item';
    topicEl.dataset.topicId = topic.id;
    topicEl.innerHTML = `<span class="topic-icon">▸</span><span style="flex:1">${topic.label}</span><span class="topic-count">${topicCounts[topic.id] || 0}</span>`;

    const subtopicList = document.createElement('div');
    subtopicList.className = 'subtopic-list hidden';
    subtopicList.id = 'sub_' + topic.id;

    topic.subtopics.forEach(sub => {
      const subCount = QUESTIONS.filter(q => q.subcategory === sub.label).length;
      const subEl = document.createElement('div');
      subEl.className = 'subtopic-item';
      subEl.dataset.subtopicId = sub.id;
      subEl.innerHTML = `<span>${sub.label}</span><span class="topic-count">${subCount}</span>`;
      subEl.onclick = e => {
        e.stopPropagation();
        if (state.filterTopic === topic.id && state.filterSubtopic === sub.id) {
          // Deselect subtopic
          state.filterSubtopic = null;
          subEl.classList.remove('active');
        } else {
          state.filterTopic = topic.id;
          state.filterSubtopic = sub.id;
          // Update all UI
          document.querySelectorAll('.topic-item, #topic-all').forEach(t => t.classList.remove('active'));
          topicEl.classList.add('active');
          document.querySelectorAll('.subtopic-item').forEach(s => s.classList.remove('active'));
          subEl.classList.add('active');
        }
        nextQuestion();
        // Keep sidebar open after subtopic selection so user can change filter easily
      };
      subtopicList.appendChild(subEl);
    });

    topicEl.onclick = () => {
      const alreadyActive = state.filterTopic === topic.id && !state.filterSubtopic;
      if (alreadyActive) {
        state.filterTopic = 'all'; state.filterSubtopic = null;
        topicEl.classList.remove('active');
        document.getElementById('topic-all').classList.add('active');
        subtopicList.classList.add('hidden');
      } else {
        state.filterTopic = topic.id; state.filterSubtopic = null;
        document.querySelectorAll('.topic-item, #topic-all').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.subtopic-item').forEach(s => s.classList.remove('active'));
        topicEl.classList.add('active');
        subtopicList.classList.remove('hidden');
      }
      nextQuestion();
      // Keep sidebar open so user can pick a subtopic or change selection
    };

    topicList.appendChild(topicEl);
    topicList.appendChild(subtopicList);
  });

  document.getElementById('topic-all').onclick = () => {
    state.filterTopic = 'all'; state.filterSubtopic = null;
    document.querySelectorAll('.topic-item, #topic-all').forEach(t => t.classList.remove('active'));
    document.getElementById('topic-all').classList.add('active');
    document.querySelectorAll('.subtopic-item').forEach(s => s.classList.remove('active'));
    nextQuestion();
    // Keep sidebar open after "Toate topicurile" selection
  };

  // Reset button
  document.getElementById('btn-reset').onclick = () => document.getElementById('modal-reset').classList.remove('hidden');
  document.getElementById('btn-reset-confirm').onclick = () => {
    resetState(); document.getElementById('modal-reset').classList.add('hidden'); nextQuestion();
  };
  document.getElementById('btn-reset-cancel').onclick = () => document.getElementById('modal-reset').classList.add('hidden');

  // ── Sidebar toggle (filter drawer) ──────────────────────────────
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const filterBtn = document.getElementById('btn-filter-toggle');
  const closeBtn = document.getElementById('btn-sidebar-close');

  function openSidebar() {
    sidebar.classList.remove('sidebar-hidden');
    backdrop.classList.add('active');
    filterBtn.classList.add('active');
  }
  function closeSidebar() {
    sidebar.classList.add('sidebar-hidden');
    backdrop.classList.remove('active');
    filterBtn.classList.remove('active');
  }
  filterBtn.onclick = () => sidebar.classList.contains('sidebar-hidden') ? openSidebar() : closeSidebar();
  // Backdrop click does NOT close — prevents accidental dismissal
  // Only the ✕ button closes the sidebar
  if (closeBtn) closeBtn.onclick = closeSidebar;
}

function drawStatsChart() {
  const canvas = document.getElementById('stats-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Difficulty distribution of answered questions
  const diffs = ['trivial','simple','easy','mediocre','above-average','hard','very-hard'];
  const counts = {};
  const correctCounts = {};
  diffs.forEach(d => { counts[d] = 0; correctCounts[d] = 0; });

  Object.entries(state.seen).forEach(([qid, data]) => {
    const q = QUESTIONS.find(q => q.id === qid);
    if (q && diffs.includes(q.difficulty)) {
      counts[q.difficulty]++;
      if (data.wasCorrect) correctCounts[q.difficulty]++;
    }
  });

  const maxVal = Math.max(...Object.values(counts), 1);
  const barW = (W - 20) / diffs.length - 3;
  const diffColors = ['#94e2d5','#a6e3a1','#a6e3a1','#f9e2af','#fab387','#f38ba8','#eba0ac'];

  diffs.forEach((d, i) => {
    const x = 10 + i * ((W - 20) / diffs.length);
    const total = counts[d];
    const correct = correctCounts[d];
    const barH = total > 0 ? ((total / maxVal) * (H - 30)) : 2;
    const correctH = total > 0 ? ((correct / maxVal) * (H - 30)) : 0;
    const y = H - 20 - barH;

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, barW, barH);

    ctx.fillStyle = diffColors[i] + '99';
    ctx.fillRect(x, H - 20 - correctH, barW, correctH);

    ctx.fillStyle = '#6c7086';
    ctx.font = '7px JetBrains Mono, monospace';
    ctx.fillText(d.substring(0,3), x, H - 5);
  });
}

// ─────────────────────────────────────────────────────────────
// ANIMATIONS
// ─────────────────────────────────────────────────────────────
// Particle system
const particleCanvas = document.getElementById('particle-canvas');
const pCtx = particleCanvas.getContext('2d');
let particles = [];

function resizeParticleCanvas() {
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeParticleCanvas);
resizeParticleCanvas();

class Particle {
  constructor(x, y, color, vx, vy) {
    this.x = x; this.y = y;
    this.color = color;
    this.vx = vx; this.vy = vy;
    this.life = 1;
    this.size = Math.random() * 6 + 2;
    this.decay = Math.random() * 0.02 + 0.015;
    this.gravity = 0.2;
  }
  update() {
    this.x += this.vx; this.y += this.vy;
    this.vy += this.gravity;
    this.vx *= 0.98;
    this.life -= this.decay;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class TextParticle {
  constructor(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.vy = -3; this.life = 1; this.decay = 0.02;
  }
  update() { this.y += this.vy; this.vy *= 0.95; this.life -= this.decay; }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.font = 'bold 24px JetBrains Mono, monospace';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

function animParticles() {
  pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
  particles = particles.filter(p => p.life > 0);
  particles.forEach(p => { p.update(); p.draw(pCtx); });
  requestAnimationFrame(animParticles);
}
animParticles();

function triggerCorrectAnim() {
  const card = document.getElementById('question-card');
  const rect = card.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // Flash
  const flash = document.getElementById('flash-overlay');
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 200);

  // Particles
  const colors = ['#a6e3a1','#94e2d5','#f9e2af','#89b4fa','#cba6f7','#f5c2e7'];
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 12 + 4;
    particles.push(new Particle(
      cx + (Math.random() - 0.5) * 200,
      cy + (Math.random() - 0.5) * 100,
      colors[Math.floor(Math.random() * colors.length)],
      Math.cos(angle) * speed, Math.sin(angle) * speed - 3
    ));
  }
  // Text particle
  particles.push(new TextParticle(cx - 30, cy - 60, '+1 ✓', '#a6e3a1'));

  // Score bounce
  const scoreEl = document.getElementById('stat-score');
  scoreEl.classList.remove('score-up');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('score-up');
}

function triggerWrongAnim() {
  const card = document.getElementById('question-card');
  const rect = card.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // Glitch
  const glitch = document.getElementById('glitch-overlay');
  glitch.classList.add('active');
  setTimeout(() => glitch.classList.remove('active'), 120);

  // Shake card
  card.classList.add('shake');
  setTimeout(() => card.classList.remove('shake'), 400);

  // Red particles
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 8 + 2;
    particles.push(new Particle(
      cx + (Math.random() - 0.5) * 100, cy,
      Math.random() > 0.5 ? '#f38ba8' : '#eba0ac',
      Math.cos(angle) * speed, Math.sin(angle) * speed - 2
    ));
  }
  particles.push(new TextParticle(cx - 20, cy - 40, '✗', '#f38ba8'));
}

// ─────────────────────────────────────────────────────────────
// MATRIX RAIN
// ─────────────────────────────────────────────────────────────
function startMatrixRain() {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  const chars = '#include<iostream>using namespace std;int main(){cout<<"";return 0;}//{}[]()=!<>+-*/%&|^~?:;,.abc0123456789';
  const cols = Math.floor(canvas.width / 14);
  const drops = new Array(cols).fill(1);

  setInterval(() => {
    ctx.fillStyle = 'rgba(17,17,27,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#a6e3a1';
    ctx.font = '12px JetBrains Mono, monospace';
    for (let i = 0; i < drops.length; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(char, i * 14, drops[i] * 14);
      if (drops[i] * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }
  }, 50);
}

// ─────────────────────────────────────────────────────────────
// SISYPHUS ANIMATION
// ─────────────────────────────────────────────────────────────
function startSisyphus() {
  const canvas = document.getElementById('sisyphus-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let t = 0.01;
  let rollDir = 1;

  // Ben 10 mode: triggers every ~4 cycles
  let cycleCount = 0;
  let ben10Mode = false;
  let transformAnim = 0; // 0..1 green flash
  let omnitrixPulse = 0;

  function drawHill() {
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H - 10);
    ctx.bezierCurveTo(W * 0.3, H - 10, W * 0.5, H * 0.2, W, H * 0.1);
    ctx.stroke();
  }

  function getBallPos(p) {
    const x = p * W;
    const y = H - 10 + p * (H * 0.1 - (H - 10)) - Math.sin(p * Math.PI) * 10;
    return { x, y: Math.min(y, H - 14) };
  }

  function drawBall(p) {
    const pos = getBallPos(p);
    const r = 8;
    if (ben10Mode) {
      // Omnitrix dial as the boulder
      const pulse = 0.5 + 0.5 * Math.sin(omnitrixPulse);
      ctx.fillStyle = `rgba(0,${Math.floor(200 + 55 * pulse)},60,1)`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      // Omnitrix symbol (hourglass silhouette)
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(pos.x - 3, pos.y - 4);
      ctx.lineTo(pos.x + 3, pos.y - 4);
      ctx.lineTo(pos.x + 1, pos.y);
      ctx.lineTo(pos.x + 3, pos.y + 4);
      ctx.lineTo(pos.x - 3, pos.y + 4);
      ctx.lineTo(pos.x - 1, pos.y);
      ctx.closePath();
      ctx.fill();
      // Green glow ring
      ctx.strokeStyle = `rgba(0,255,80,${0.4 + 0.4 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const grad = ctx.createRadialGradient(pos.x - 2, pos.y - 2, 1, pos.x, pos.y, r);
      grad.addColorStop(0, '#cba6f7');
      grad.addColorStop(1, '#6c5a8e');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e1e2e';
      ctx.font = 'bold 5px JetBrains Mono, monospace';
      ctx.fillText('{}', pos.x - 5, pos.y + 2);
    }
  }

  function drawSisyphus(p) {
    const ballPos = getBallPos(p);
    const sx = ballPos.x - 16;
    const sy = ballPos.y + 2;

    if (ben10Mode) {
      // Ben 10 / alien figure — bigger, green, with alien features
      const legSwing = Math.sin(t * 30) * 3;
      const armSwing = Math.cos(t * 30) * 2;

      // Body glow
      ctx.shadowColor = '#00ff50';
      ctx.shadowBlur = 6;

      // Legs (thicker alien legs)
      ctx.strokeStyle = '#00c840';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx - 5 + legSwing, sy + 13); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx + 5 - legSwing, sy + 13); ctx.stroke();

      // Body (alien torso — slightly bigger)
      ctx.strokeStyle = '#00ff50';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx, sy + 4); ctx.stroke();

      // Arms pushing with more muscle
      ctx.beginPath(); ctx.moveTo(sx, sy - 2); ctx.lineTo(sx + 11, sy - 5 + armSwing); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - 2); ctx.lineTo(sx - 3, sy + 2 - armSwing); ctx.stroke();

      // Alien head (oval, larger)
      ctx.fillStyle = '#00c840';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 11, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#00ff50';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Big alien eyes (glow white)
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.ellipse(sx - 2.5, sy - 12, 1.5, 2, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx + 2.5, sy - 12, 1.5, 2, 0.3, 0, Math.PI * 2); ctx.fill();

      // Omnitrix watch on wrist
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#00ff50';
      ctx.beginPath();
      ctx.rect(sx + 8, sy - 6, 5, 3);
      ctx.fill();
      ctx.fillStyle = '#003010';
      ctx.beginPath();
      ctx.rect(sx + 9, sy - 5.5, 3, 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.lineCap = 'butt';
    } else {
      // Normal Sisyphus stick figure
      const legSwing = Math.sin(t * 25) * 2;
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy - 10, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - 2); ctx.lineTo(sx + 10, sy - 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx - 4 + legSwing, sy + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx + 2 - legSwing, sy + 12); ctx.stroke();
    }
  }

  function drawTransformFlash() {
    if (transformAnim <= 0) return;
    const alpha = transformAnim * 0.6;
    const grad = ctx.createRadialGradient(W * 0.35, H * 0.6, 0, W * 0.35, H * 0.6, W * 0.4);
    grad.addColorStop(0, `rgba(0,255,80,${alpha})`);
    grad.addColorStop(1, `rgba(0,255,80,0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    transformAnim -= 0.05;
    if (transformAnim < 0) transformAnim = 0;
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    drawHill();
    drawTransformFlash();
    drawBall(t);
    drawSisyphus(t);

    if (ben10Mode) omnitrixPulse += 0.12;

    t += rollDir * 0.003;
    if (t >= 1) {
      rollDir = -1; t = 0.99;
      cycleCount++;
      // Switch to/from Ben 10 every 3 cycles (about every 10s)
      if (cycleCount % 3 === 0) {
        ben10Mode = !ben10Mode;
        transformAnim = 1.0;
        omnitrixPulse = 0;
      }
    }
    if (t <= 0) { rollDir = 1; t = 0.01; }
    requestAnimationFrame(frame);
  }
  frame();
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';

  // Extract code blocks FIRST (protect them from \n→<br> substitution)
  const codeBlocks = [];
  text = text.replace(/```(?:cpp)?\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${syntaxHighlight(code)}</pre>`);
    return `\x01CODE${idx}\x01`;
  });

  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Newlines to br (only on prose, code blocks are protected)
  text = text.replace(/\n/g, '<br>');

  // Restore code blocks (their content is NOT affected by \n→<br>)
  codeBlocks.forEach((block, i) => {
    text = text.replace(`\x01CODE${i}\x01`, block);
  });

  return text;
}

// Proper tokenizer-based syntax highlighter.
// Takes RAW code text and returns safe highlighted HTML.
// Does NOT break if keywords appear in HTML attribute names.
function syntaxHighlight(rawCode) {
  if (!rawCode) return '';
  const KWS  = new Set(['int','long','char','float','double','void','bool','return',
    'if','else','for','while','do','switch','case','break','continue','default',
    'using','namespace','const','struct','class','new','delete','true','false',
    'NULL','static','unsigned','short','signed','auto','include','typedef','sizeof']);
  const KW2S = new Set(['cin','cout','endl','string','vector','min','max','abs',
    'sqrt','pow','main','ifstream','ofstream','getline','strlen','strcmp','strcpy',
    'strcat','fstream','printf','scanf']);

  function e(s) { // html-escape a raw fragment
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  let out = '';
  let i   = 0;
  const src = rawCode;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // ── Line comment: // …
    if (ch === '/' && src[i+1] === '/') {
      let j = i;
      while (j < len && src[j] !== '\n') j++;
      out += `<span class="cmt">${e(src.slice(i, j))}</span>`;
      i = j; continue;
    }

    // ── Preprocessor: # …
    if (ch === '#') {
      let j = i;
      while (j < len && src[j] !== '\n') j++;
      out += `<span class="pre">${e(src.slice(i, j))}</span>`;
      i = j; continue;
    }

    // ── String literal: "…"
    if (ch === '"') {
      let j = i + 1;
      while (j < len && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      out += `<span class="str">${e(src.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }

    // ── Char literal: '…'
    if (ch === "'") {
      let j = i + 1;
      while (j < len && src[j] !== "'") { if (src[j] === '\\') j++; j++; }
      out += `<span class="str">${e(src.slice(i, j + 1))}</span>`;
      i = j + 1; continue;
    }

    // ── Number
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < len && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      out += `<span class="num">${e(src.slice(i, j))}</span>`;
      i = j; continue;
    }

    // ── Identifier or keyword
    if (ch === '_' || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let j = i;
      while (j < len && (src[j] === '_' || (src[j] >= 'a' && src[j] <= 'z') ||
             (src[j] >= 'A' && src[j] <= 'Z') || (src[j] >= '0' && src[j] <= '9'))) j++;
      const word = src.slice(i, j);
      if      (KWS.has(word))  out += `<span class="kw">${e(word)}</span>`;
      else if (KW2S.has(word)) out += `<span class="kw2">${e(word)}</span>`;
      else                     out += e(word);
      i = j; continue;
    }

    // ── Newline → <br>
    if (ch === '\n') { out += '\n'; i++; continue; }

    // ── Everything else
    out += e(ch);
    i++;
  }
  return out;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
