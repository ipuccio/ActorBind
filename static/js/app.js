/* ══════════════════════════════════════════════════════════════════════════════
   ActorBind — Frontend Application
   ══════════════════════════════════════════════════════════════════════════════ */

// ─── Configuration ───────────────────────────────────────────────────────────

const XP_REWARDS = {
    multiple_choice: 5,
    fill_blank:      10,
    word_scramble:   10,
    first_letters:   15,
    full_recall:     20,
};

const EXERCISE_LABELS = {
    multiple_choice: 'Multiple Choice',
    fill_blank:      'Fill in the Blanks',
    word_scramble:   'Word Scramble',
    first_letters:   'First Letters',
    full_recall:     'Full Recall',
};

const MAX_HEARTS = 3;
const STREAK_BONUS_EVERY = 3;
const STREAK_BONUS_XP = 5;

// ─── Application State ──────────────────────────────────────────────────────

let state = {
    // Play data
    playId:            null,
    totalPages:        1,
    characters:        [],
    selectedCharacter: null,
    startPage:         1,
    endPage:           1,
    preview:           [],
    linePairs:         [],

    // Lesson
    currentLesson:  0,
    totalLessons:   0,
    totalLines:     0,

    // Practice
    exercises:      [],
    currentIndex:   0,
    isChecked:      false,

    // Scoring
    xp:             0,
    hearts:         MAX_HEARTS,
    streak:         0,
    maxStreak:      0,
    correct:        0,
    incorrect:      0,
    missedLineIndices: new Set(),

    // Word scramble temp state
    scrambleAnswer: [],
};


// ─── DOM Helpers ─────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function el(tag, className, innerHTML) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (innerHTML !== undefined) e.innerHTML = innerHTML;
    return e;
}


// ─── Screen Management ──────────────────────────────────────────────────────

function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const target = $(`#screen-${id}`);
    if (target) target.classList.add('active');
}

function showOverlay(id) { $(`#overlay-${id}`).classList.add('show'); }
function hideOverlay(id) { $(`#overlay-${id}`).classList.remove('show'); }


// ═════════════════════════════════════════════════════════════════════════════
// UPLOAD SCREEN
// ═════════════════════════════════════════════════════════════════════════════

function initUpload() {
    const dropZone = $('#drop-zone');
    const fileInput = $('#file-input');
    const status = $('#upload-status');

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
    });
}

async function handleFileUpload(file) {
    const status = $('#upload-status');

    if (!file.name.toLowerCase().endsWith('.pdf')) {
        status.className = 'upload-status error';
        status.textContent = 'Please upload a PDF file.';
        return;
    }

    status.className = 'upload-status loading';
    status.textContent = `Uploading "${file.name}"…`;

    const formData = new FormData();
    formData.append('pdf', file);

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) {
            status.className = 'upload-status error';
            status.textContent = data.error || 'Upload failed.';
            return;
        }

        status.className = 'upload-status success';
        status.textContent = `Detected ${data.characters.length} characters, ${data.dialogue_count} lines of dialogue!`;

        // Store data
        state.playId     = data.play_id;
        state.totalPages = data.total_pages;
        state.characters = data.characters;
        state.preview    = data.preview || [];

        // Transition to setup
        setTimeout(() => initSetup(), 600);

    } catch (err) {
        status.className = 'upload-status error';
        status.textContent = 'Network error. Please try again.';
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// SETUP SCREEN
// ═════════════════════════════════════════════════════════════════════════════

function initSetup() {
    showScreen('setup');

    $('#badge-pages').textContent = `${state.totalPages} pages`;
    $('#badge-lines').textContent = `${state.characters.reduce((s, c) => s + c.line_count, 0)} lines detected`;

    const endInput = $('#end-page');
    endInput.max = state.totalPages;
    endInput.value = state.totalPages;
    state.endPage = state.totalPages;

    $('#start-page').max = state.totalPages;

    // Character grid
    const grid = $('#character-grid');
    grid.innerHTML = '';
    state.characters.forEach(ch => {
        const card = el('div', 'character-card');
        card.innerHTML = `
            <div class="char-name">${ch.name}</div>
            <div class="char-lines">${ch.line_count} line${ch.line_count !== 1 ? 's' : ''}</div>
        `;
        card.addEventListener('click', () => selectCharacter(ch.name, card));
        grid.appendChild(card);
    });

    // Preview
    renderPreview();
}

function selectCharacter(name, cardEl) {
    state.selectedCharacter = name;
    $$('.character-card').forEach(c => c.classList.remove('selected'));
    if (cardEl) cardEl.classList.add('selected');
    $('#btn-start').disabled = false;
    $('#btn-study').disabled = false;
}

function renderPreview() {
    const container = $('#preview-lines');
    container.innerHTML = '';
    if (!state.preview.length) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem;">No preview available</p>';
        return;
    }
    state.preview.forEach(entry => {
        const div = el('div', 'preview-line');
        div.innerHTML = `<span class="preview-char">${entry.character}:</span> ${escapeHtml(entry.line)}`;
        container.appendChild(div);
    });
}


// ═════════════════════════════════════════════════════════════════════════════
// STUDY SCREEN
// ═════════════════════════════════════════════════════════════════════════════

async function showStudy() {
    showOverlay('loading');
    $('#loading-text').textContent = 'Loading your lines…';

    try {
        const res = await fetch('/api/exercises', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                play_id:    state.playId,
                character:  state.selectedCharacter,
                start_page: parseInt($('#start-page').value) || 1,
                end_page:   parseInt($('#end-page').value) || state.totalPages,
                lesson_size: 9999,
                lesson_number: 0,
            }),
        });
        const data = await res.json();
        hideOverlay('loading');

        if (!res.ok) {
            alert(data.error || 'Failed to load lines.');
            return;
        }

        state.linePairs = data.line_pairs || [];
        renderStudyLines();
        showScreen('study');

    } catch (err) {
        hideOverlay('loading');
        alert('Network error. Please try again.');
    }
}

function renderStudyLines() {
    const container = $('#study-lines');
    container.innerHTML = '';
    $('#study-subtitle').textContent =
        `${state.linePairs.length} line${state.linePairs.length !== 1 ? 's' : ''} as ${state.selectedCharacter}`;

    state.linePairs.forEach((pair, i) => {
        // Cue line
        if (pair.cue_character !== 'NARRATOR') {
            const cue = el('div', 'study-entry cue');
            cue.innerHTML = `<span class="study-char">${escapeHtml(pair.cue_character)}</span>${escapeHtml(pair.cue)}`;
            container.appendChild(cue);
        }
        // Your line
        const mine = el('div', 'study-entry mine');
        mine.innerHTML = `<span class="study-char">${escapeHtml(pair.character)}</span>${escapeHtml(pair.line)}`;
        container.appendChild(mine);
    });
}


// ═════════════════════════════════════════════════════════════════════════════
// PRACTICE SCREEN
// ═════════════════════════════════════════════════════════════════════════════

async function startPractice(options = {}) {
    showOverlay('loading');
    $('#loading-text').textContent = 'Generating exercises…';

    const body = {
        play_id:       state.playId,
        character:     state.selectedCharacter,
        start_page:    parseInt($('#start-page').value) || 1,
        end_page:      parseInt($('#end-page').value) || state.totalPages,
        lesson_size:   5,
        lesson_number: options.lessonNumber ?? state.currentLesson,
    };
    if (options.lineIndices) body.line_indices = options.lineIndices;

    try {
        const res = await fetch('/api/exercises', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        hideOverlay('loading');

        if (!res.ok) {
            alert(data.error || 'Failed to generate exercises.');
            return;
        }

        // Initialize practice state
        state.exercises     = data.exercises;
        state.linePairs     = data.line_pairs || state.linePairs;
        state.totalLessons  = data.total_lessons;
        state.totalLines    = data.total_lines;
        state.currentIndex  = 0;
        state.isChecked     = false;
        state.hearts        = MAX_HEARTS;
        state.xp            = 0;
        state.streak        = 0;
        state.maxStreak     = 0;
        state.correct       = 0;
        state.incorrect     = 0;
        state.missedLineIndices = new Set();
        state.scrambleAnswer = [];

        updatePracticeStats();
        showScreen('practice');
        loadExercise(0);

    } catch (err) {
        hideOverlay('loading');
        alert('Network error. Please try again.');
    }
}

function updatePracticeStats() {
    $('#heart-count').textContent = state.hearts;
    $('#xp-count').textContent = state.xp;
    $('#streak-count').textContent = state.streak;

    const total = state.exercises.length;
    const pct = total > 0 ? ((state.currentIndex) / total) * 100 : 0;
    $('#progress-bar').style.width = `${pct}%`;
}

function loadExercise(index) {
    if (index >= state.exercises.length) {
        showResults();
        return;
    }

    state.currentIndex = index;
    state.isChecked = false;
    state.scrambleAnswer = [];

    const ex = state.exercises[index];
    const container = $('#exercise-container');
    const badge = $('#exercise-type-badge');
    const checkBtn = $('#btn-check');
    const feedback = $('#feedback-bar');

    container.innerHTML = '';
    badge.textContent = EXERCISE_LABELS[ex.type] || ex.type;
    badge.className = 'exercise-type-badge pop-in';

    checkBtn.textContent = 'Check';
    checkBtn.className = 'btn-primary btn-check';
    checkBtn.disabled = true;

    feedback.className = 'feedback-bar';
    feedback.innerHTML = '';

    updatePracticeStats();

    // Render cue
    const cueSection = el('div', 'cue-section slide-up');
    cueSection.innerHTML = `
        <div class="cue-label">${escapeHtml(ex.cue_character)} says:</div>
        <div class="cue-text">${escapeHtml(ex.cue)}</div>
    `;
    container.appendChild(cueSection);

    // Render prompt
    const prompt = el('div', 'your-line-prompt slide-up');
    prompt.textContent = `Your line as ${ex.your_character}:`;
    container.appendChild(prompt);

    // Render exercise-specific content
    switch (ex.type) {
        case 'multiple_choice': renderMultipleChoice(ex, container); break;
        case 'fill_blank':      renderFillBlank(ex, container);      break;
        case 'word_scramble':   renderWordScramble(ex, container);   break;
        case 'first_letters':   renderFirstLetters(ex, container);   break;
        case 'full_recall':     renderFullRecall(ex, container);     break;
    }
}


// ── Multiple Choice ──────────────────────────────────────────────────────────

function renderMultipleChoice(ex, container) {
    const optionsDiv = el('div', 'mc-options slide-up');

    ex.options.forEach((opt, i) => {
        const btn = el('button', 'mc-option');
        btn.textContent = opt;
        btn.dataset.index = i;

        btn.addEventListener('click', () => {
            if (state.isChecked) return;

            // Immediately check
            state.isChecked = true;
            const isCorrect = (i === ex.correct_index);

            // Disable all buttons
            optionsDiv.querySelectorAll('.mc-option').forEach(b => b.disabled = true);

            if (isCorrect) {
                btn.classList.add('correct');
                handleCorrectAnswer(ex);
            } else {
                btn.classList.add('incorrect');
                // Highlight the correct one
                optionsDiv.querySelectorAll('.mc-option')[ex.correct_index].classList.add('correct');
                handleIncorrectAnswer(ex);
            }

            // Show continue button
            showContinueButton();
        });

        optionsDiv.appendChild(btn);
    });

    container.appendChild(optionsDiv);
    // No need for check button on MC — clicking an option checks immediately
    $('#btn-check').style.display = 'none';
}


// ── Fill in the Blanks ───────────────────────────────────────────────────────

function renderFillBlank(ex, container) {
    const templateDiv = el('div', 'fill-template slide-up');
    const parts = ex.template.split('____');
    let inputCount = 0;

    parts.forEach((part, i) => {
        templateDiv.appendChild(document.createTextNode(part));
        if (i < ex.blanks.length) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'blank-input';
            input.dataset.blankIndex = i;
            input.placeholder = '…';
            input.autocomplete = 'off';
            input.autocapitalize = 'off';

            // Size input based on answer length
            const answerLen = ex.blanks[i].answer.length;
            input.style.width = Math.max(60, answerLen * 12 + 24) + 'px';

            input.addEventListener('input', () => {
                const allFilled = container.querySelectorAll('.blank-input').length > 0 &&
                    [...container.querySelectorAll('.blank-input')].every(inp => inp.value.trim());
                $('#btn-check').disabled = !allFilled;
            });

            // Tab to next blank
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!$('#btn-check').disabled) {
                        $('#btn-check').click();
                    }
                }
            });

            templateDiv.appendChild(input);
            inputCount++;
        }
    });

    container.appendChild(templateDiv);
    $('#btn-check').style.display = '';
    $('#btn-check').disabled = true;

    // Focus first input
    setTimeout(() => {
        const firstInput = container.querySelector('.blank-input');
        if (firstInput) firstInput.focus();
    }, 100);
}


// ── Word Scramble ────────────────────────────────────────────────────────────

function renderWordScramble(ex, container) {
    state.scrambleAnswer = [];

    const answerArea = el('div', 'scramble-answer slide-up');
    answerArea.id = 'scramble-answer';
    answerArea.innerHTML = '<span class="placeholder-text">Tap words to build your line</span>';

    const bankArea = el('div', 'scramble-bank slide-up');
    bankArea.id = 'scramble-bank';

    ex.scrambled.forEach((word, i) => {
        const chip = el('button', 'word-chip');
        chip.textContent = word;
        chip.dataset.bankIndex = i;

        chip.addEventListener('click', () => {
            if (state.isChecked) return;
            addToScrambleAnswer(word, i, answerArea, bankArea, ex);
        });

        bankArea.appendChild(chip);
    });

    container.appendChild(answerArea);
    container.appendChild(bankArea);
    $('#btn-check').style.display = '';
    $('#btn-check').disabled = true;
}

function addToScrambleAnswer(word, bankIndex, answerArea, bankArea, ex) {
    // Add to answer
    state.scrambleAnswer.push({ word, bankIndex });

    // Mark bank chip as placed
    const bankChip = bankArea.querySelectorAll('.word-chip')[bankIndex];
    if (bankChip) bankChip.classList.add('placed');

    // Remove placeholder
    const placeholder = answerArea.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    // Add chip to answer area
    const answerChip = el('button', 'word-chip in-answer pop-in');
    answerChip.textContent = word;
    answerChip.dataset.answerIndex = state.scrambleAnswer.length - 1;

    answerChip.addEventListener('click', () => {
        if (state.isChecked) return;
        removeFromScrambleAnswer(parseInt(answerChip.dataset.answerIndex), answerArea, bankArea, ex);
    });

    answerArea.appendChild(answerChip);
    answerArea.classList.add('active');

    // Enable check if all words placed
    const allPlaced = state.scrambleAnswer.length === ex.scrambled.length;
    $('#btn-check').disabled = !allPlaced;
}

function removeFromScrambleAnswer(answerIndex, answerArea, bankArea, ex) {
    const entry = state.scrambleAnswer[answerIndex];
    if (!entry) return;

    // Un-place the bank chip
    const bankChip = bankArea.querySelectorAll('.word-chip')[entry.bankIndex];
    if (bankChip) bankChip.classList.remove('placed');

    // Remove from answer array
    state.scrambleAnswer.splice(answerIndex, 1);

    // Re-render answer area
    const chips = answerArea.querySelectorAll('.word-chip');
    chips.forEach(c => c.remove());

    if (state.scrambleAnswer.length === 0) {
        if (!answerArea.querySelector('.placeholder-text')) {
            answerArea.innerHTML = '<span class="placeholder-text">Tap words to build your line</span>';
        }
        answerArea.classList.remove('active');
    } else {
        state.scrambleAnswer.forEach((entry, i) => {
            const chip = el('button', 'word-chip in-answer');
            chip.textContent = entry.word;
            chip.dataset.answerIndex = i;
            chip.addEventListener('click', () => {
                if (state.isChecked) return;
                removeFromScrambleAnswer(i, answerArea, bankArea, ex);
            });
            answerArea.appendChild(chip);
        });
    }

    $('#btn-check').disabled = true;
}


// ── First Letters ────────────────────────────────────────────────────────────

function renderFirstLetters(ex, container) {
    const hintDiv = el('div', 'hint-display slide-up');
    hintDiv.textContent = ex.hint;
    container.appendChild(hintDiv);

    const textarea = document.createElement('textarea');
    textarea.className = 'recall-input slide-up';
    textarea.placeholder = 'Type the full line using the hints above…';
    textarea.rows = 3;
    textarea.addEventListener('input', () => {
        $('#btn-check').disabled = !textarea.value.trim();
    });
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!$('#btn-check').disabled) $('#btn-check').click();
        }
    });

    container.appendChild(textarea);
    $('#btn-check').style.display = '';
    $('#btn-check').disabled = true;

    setTimeout(() => textarea.focus(), 100);
}


// ── Full Recall ──────────────────────────────────────────────────────────────

function renderFullRecall(ex, container) {
    const promptNote = el('div', 'hint-display slide-up');
    promptNote.textContent = 'Type your line from memory';
    promptNote.style.color = 'var(--text-secondary)';
    promptNote.style.fontFamily = 'var(--font-body)';
    promptNote.style.fontSize = '.9rem';
    container.appendChild(promptNote);

    const textarea = document.createElement('textarea');
    textarea.className = 'recall-input slide-up';
    textarea.placeholder = 'What do you say next?';
    textarea.rows = 3;
    textarea.addEventListener('input', () => {
        $('#btn-check').disabled = !textarea.value.trim();
    });
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!$('#btn-check').disabled) $('#btn-check').click();
        }
    });

    container.appendChild(textarea);
    $('#btn-check').style.display = '';
    $('#btn-check').disabled = true;

    setTimeout(() => textarea.focus(), 100);
}


// ═════════════════════════════════════════════════════════════════════════════
// ANSWER CHECKING
// ═════════════════════════════════════════════════════════════════════════════

function checkAnswer() {
    if (state.isChecked) {
        // "Continue" mode
        advanceExercise();
        return;
    }

    const ex = state.exercises[state.currentIndex];
    state.isChecked = true;

    switch (ex.type) {
        case 'multiple_choice':
            // Handled inline on click
            break;
        case 'fill_blank':
            checkFillBlank(ex);
            break;
        case 'word_scramble':
            checkWordScramble(ex);
            break;
        case 'first_letters':
        case 'full_recall':
            checkTextRecall(ex);
            break;
    }
}

function checkFillBlank(ex) {
    const inputs = [...$$('.blank-input')];
    let allCorrect = true;

    inputs.forEach((input, i) => {
        const userVal = normalizeText(input.value);
        const correctVal = normalizeText(ex.blanks[i].answer);

        if (userVal === correctVal) {
            input.classList.add('correct');
        } else {
            input.classList.add('incorrect');
            input.value = ex.blanks[i].display;
            allCorrect = false;
        }
        input.disabled = true;
    });

    if (allCorrect) {
        handleCorrectAnswer(ex);
    } else {
        handleIncorrectAnswer(ex);
    }
    showContinueButton();
}

function checkWordScramble(ex) {
    const userWords = state.scrambleAnswer.map(e => e.word);
    const correctWords = ex.correct_words;
    const isCorrect = JSON.stringify(userWords) === JSON.stringify(correctWords);

    const answerArea = $('#scramble-answer');
    const chips = answerArea.querySelectorAll('.word-chip');

    if (isCorrect) {
        answerArea.classList.add('correct');
        chips.forEach(c => c.classList.add('correct-chip'));
        handleCorrectAnswer(ex);
    } else {
        answerArea.classList.add('incorrect');
        chips.forEach((c, i) => {
            if (userWords[i] === correctWords[i]) {
                c.classList.add('correct-chip');
            } else {
                c.classList.add('incorrect-chip');
            }
        });
        handleIncorrectAnswer(ex);
    }
    showContinueButton();
}

function checkTextRecall(ex) {
    const textarea = $('.recall-input');
    const result = fuzzyMatch(textarea.value, ex.correct);

    textarea.disabled = true;

    if (result.match) {
        textarea.classList.add('correct');
        handleCorrectAnswer(ex);
    } else {
        textarea.classList.add('incorrect');
        // Show similarity score
        const simBar = el('div', 'similarity-bar');
        simBar.textContent = `${Math.round(result.score * 100)}% match`;
        textarea.parentNode.insertBefore(simBar, textarea.nextSibling);
        handleIncorrectAnswer(ex);
    }
    showContinueButton();
}


// ── Correct / Incorrect Handlers ─────────────────────────────────────────────

function handleCorrectAnswer(ex) {
    state.correct++;
    state.streak++;
    if (state.streak > state.maxStreak) state.maxStreak = state.streak;

    let xpGain = XP_REWARDS[ex.type] || 10;

    // Streak bonus
    if (state.streak > 0 && state.streak % STREAK_BONUS_EVERY === 0) {
        xpGain += STREAK_BONUS_XP;
    }

    state.xp += xpGain;

    showFeedback(true, `+${xpGain} XP` + (state.streak >= STREAK_BONUS_EVERY && state.streak % STREAK_BONUS_EVERY === 0 ? ' 🔥 Streak bonus!' : ''));
    updatePracticeStats();
    animateStat('#xp-count');
    if (state.streak % STREAK_BONUS_EVERY === 0 && state.streak > 0) animateStat('#streak-count');
}

function handleIncorrectAnswer(ex) {
    state.incorrect++;
    state.streak = 0;
    state.hearts--;
    state.missedLineIndices.add(ex.line_index);

    showFeedback(false, `Correct answer: "${ex.correct}"`);
    updatePracticeStats();

    // Animate heart loss
    const heartsEl = $('#hearts-display');
    heartsEl.classList.add('heart-break');
    setTimeout(() => heartsEl.classList.remove('heart-break'), 600);

    // Check for game over
    if (state.hearts <= 0) {
        setTimeout(() => showOverlay('hearts'), 800);
    }
}

function showFeedback(isCorrect, message) {
    const bar = $('#feedback-bar');
    bar.className = `feedback-bar show ${isCorrect ? 'correct' : 'incorrect'}`;
    bar.innerHTML = `<span>${isCorrect ? '✓' : '✗'}</span> <span>${escapeHtml(message)}</span>`;
}

function showContinueButton() {
    const btn = $('#btn-check');
    btn.textContent = 'Continue';
    btn.className = 'btn-primary btn-check btn-continue';
    btn.disabled = false;
    btn.style.display = '';
}

function advanceExercise() {
    if (state.hearts <= 0) {
        showOverlay('hearts');
        return;
    }
    loadExercise(state.currentIndex + 1);
}

function animateStat(selector) {
    const el = $(selector);
    el.classList.remove('count-up');
    void el.offsetWidth; // reflow
    el.classList.add('count-up');
}


// ═════════════════════════════════════════════════════════════════════════════
// RESULTS SCREEN
// ═════════════════════════════════════════════════════════════════════════════

function showResults() {
    const total = state.correct + state.incorrect;
    const accuracy = total > 0 ? Math.round((state.correct / total) * 100) : 0;

    $('#result-xp').textContent = state.xp;
    $('#result-accuracy').textContent = accuracy + '%';
    $('#result-streak').textContent = state.maxStreak;

    if (accuracy >= 80) {
        $('#results-title').textContent = 'Lesson Complete!';
        $('#results-trophy').textContent = '🏆';
    } else if (accuracy >= 50) {
        $('#results-title').textContent = 'Good Effort!';
        $('#results-trophy').textContent = '🌟';
    } else {
        $('#results-title').textContent = 'Keep Practicing!';
        $('#results-trophy').textContent = '💪';
    }

    const hasNext = (state.currentLesson + 1) < state.totalLessons;
    $('#btn-next-lesson').style.display = hasNext ? '' : 'none';
    $('#btn-retry-mistakes').style.display = state.missedLineIndices.size > 0 ? '' : 'none';

    const lessonInfo = `Lesson ${state.currentLesson + 1} of ${state.totalLessons}`;
    $('#results-subtitle').textContent = `${lessonInfo} · ${state.correct}/${total} correct`;

    showScreen('results');

    // Confetti for high accuracy
    if (accuracy >= 70) {
        setTimeout(createConfetti, 300);
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// TEXT MATCHING
// ═════════════════════════════════════════════════════════════════════════════

function normalizeText(text) {
    return text.toLowerCase()
        .replace(/[.,!?;:'"()\-\[\]{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]);
        }
    }
    return dp[m][n];
}

function similarity(a, b) {
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length >= b.length ? b : a;
    if (longer.length === 0) return 1.0;
    return (longer.length - levenshtein(longer, shorter)) / longer.length;
}

function fuzzyMatch(userInput, correct, threshold = 0.82) {
    const a = normalizeText(userInput);
    const b = normalizeText(correct);
    if (a === b) return { match: true, score: 1.0 };
    const score = similarity(a, b);
    return { match: score >= threshold, score };
}


// ═════════════════════════════════════════════════════════════════════════════
// CONFETTI
// ═════════════════════════════════════════════════════════════════════════════

function createConfetti() {
    const canvas = $('#confetti-canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    const colors = ['#f5c518', '#58cc02', '#49c0f8', '#a560e8', '#ff4b4b', '#ff9600'];
    const particles = [];

    for (let i = 0; i < 150; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: -10 - Math.random() * canvas.height * 0.5,
            w: 4 + Math.random() * 8,
            h: 4 + Math.random() * 8,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360,
            rotV: (Math.random() - 0.5) * 12,
            vx: (Math.random() - 0.5) * 5,
            vy: 2 + Math.random() * 4,
            opacity: 1,
        });
    }

    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;

        for (const p of particles) {
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.rotV;
            p.vy += 0.06;
            if (frame > 80) p.opacity -= 0.012;

            if (p.opacity > 0 && p.y < canvas.height + 50) {
                alive = true;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rot * Math.PI) / 180);
                ctx.globalAlpha = Math.max(0, p.opacity);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }
        }

        frame++;
        if (alive && frame < 240) {
            requestAnimationFrame(animate);
        } else {
            canvas.style.display = 'none';
        }
    }

    animate();
}


// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ═════════════════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═════════════════════════════════════════════════════════════════════════════

document.addEventListener('keydown', (e) => {
    // Enter → Check / Continue (unless in textarea or input)
    if (e.key === 'Enter' && !e.shiftKey) {
        const active = document.activeElement;
        const isInput = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
        // If it's an input, it handles its own enter
        if (!isInput) {
            const check = $('#btn-check');
            if (check && !check.disabled && check.style.display !== 'none') {
                e.preventDefault();
                check.click();
            }
        }
    }

    // Number keys 1-4 for multiple choice
    if (['1', '2', '3', '4'].includes(e.key)) {
        const ex = state.exercises[state.currentIndex];
        if (ex && ex.type === 'multiple_choice' && !state.isChecked) {
            const options = $$('.mc-option');
            const idx = parseInt(e.key) - 1;
            if (options[idx]) options[idx].click();
        }
    }
});


// ═════════════════════════════════════════════════════════════════════════════
// INITIALIZATION & EVENT BINDING
// ═════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initUpload();

    // Setup screen buttons
    $('#btn-back-upload').addEventListener('click', () => showScreen('upload'));
    $('#btn-start').addEventListener('click', () => startPractice());
    $('#btn-study').addEventListener('click', () => showStudy());

    // Study screen buttons
    $('#btn-study-back').addEventListener('click', () => showScreen('setup'));
    $('#btn-start-from-study').addEventListener('click', () => startPractice());

    // Practice screen buttons
    $('#btn-check').addEventListener('click', () => checkAnswer());
    $('#btn-quit').addEventListener('click', () => {
        if (confirm('Quit this lesson? Progress will be lost.')) {
            showScreen('setup');
        }
    });

    // Results screen buttons
    $('#btn-next-lesson').addEventListener('click', () => {
        state.currentLesson++;
        startPractice({ lessonNumber: state.currentLesson });
    });

    $('#btn-retry').addEventListener('click', () => {
        startPractice({ lessonNumber: state.currentLesson });
    });

    $('#btn-retry-mistakes').addEventListener('click', () => {
        const indices = [...state.missedLineIndices];
        if (indices.length > 0) {
            startPractice({ lineIndices: indices });
        }
    });

    $('#btn-new-play').addEventListener('click', () => showScreen('upload'));

    // Hearts overlay
    $('#btn-hearts-retry').addEventListener('click', () => {
        hideOverlay('hearts');
        startPractice({ lessonNumber: state.currentLesson });
    });
    $('#btn-hearts-quit').addEventListener('click', () => {
        hideOverlay('hearts');
        showScreen('setup');
    });
});
