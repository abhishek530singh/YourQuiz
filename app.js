/**
 * YourQuiz — Main Application Logic
 * Handles quiz flow: Landing → Quiz → Results → Answer Sheet
 */

// ============================================
// STATE
// ============================================
const state = {
    // Config
    selectedSubject: 'biochemistry',
    selectedCount: 25,
    selectedChapter: 'all',

    // Quiz
    questions: [],          // Active quiz questions
    currentIndex: 0,        // Current question index
    answers: {},            // { questionId: selectedOptionIndex }
    bookmarks: new Set(),   // Set of bookmarked question IDs

    // Timer
    totalSeconds: 0,
    remainingSeconds: 0,
    timerInterval: null,
    startTime: null,

    // Results
    score: 0,
    timeElapsed: 0
};

// ============================================
// DOM REFERENCES
// ============================================
const $ = (id) => document.getElementById(id);

const screens = {
    landing: $('landing-screen'),
    quiz: $('quiz-screen'),
    results: $('results-screen'),
    answersheet: $('answersheet-screen')
};

// ============================================
// SCREEN MANAGEMENT
// ============================================
function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
    window.scrollTo(0, 0);
}

// ============================================
// LANDING SCREEN
// ============================================
function initLanding() {
    // Update question counts
    for (const subjectKey of Object.keys(QUESTION_BANK)) {
        const count = getSubjectQuestions(subjectKey).length;
        const el = $(`count-${subjectKey}`);
        if (el) el.textContent = `${count} Qs`;
    }

    // Subject cards
    document.querySelectorAll('.subject-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.subject-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            state.selectedSubject = card.dataset.subject;
            updateChapterSelect();
        });
    });

    // Count buttons
    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            state.selectedCount = btn.dataset.count === 'all' ? 'all' : parseInt(btn.dataset.count);
        });
    });

    // Chapter select
    updateChapterSelect();

    $('chapter-select').addEventListener('change', (e) => {
        state.selectedChapter = e.target.value;
    });

    // Start button
    $('btn-start').addEventListener('click', startQuiz);

    // Load bookmarks from localStorage
    const saved = localStorage.getItem('yourquiz_bookmarks');
    if (saved) {
        try {
            state.bookmarks = new Set(JSON.parse(saved));
        } catch (e) { /* ignore */ }
    }
}

function updateChapterSelect() {
    const chapters = getChapterList(state.selectedSubject);
    const select = $('chapter-select');
    const section = $('chapter-section');

    if (chapters.length > 1) {
        section.style.display = '';
        select.innerHTML = '<option value="all">All Chapters</option>';
        chapters.forEach(ch => {
            const opt = document.createElement('option');
            opt.value = ch.key;
            opt.textContent = `${ch.name} (${ch.count} Qs)`;
            select.appendChild(opt);
        });
    } else {
        section.style.display = 'none';
    }
    state.selectedChapter = 'all';
}

// ============================================
// QUIZ ENGINE
// ============================================
function startQuiz() {
    // Get questions
    let questions;
    if (state.selectedChapter === 'all') {
        questions = getSubjectQuestions(state.selectedSubject);
    } else {
        const chapter = QUESTION_BANK[state.selectedSubject]?.chapters?.[state.selectedChapter];
        questions = chapter ? [...chapter.questions] : [];
    }

    if (questions.length === 0) {
        alert('No questions available for this selection.');
        return;
    }

    // Shuffle
    questions = shuffleArray(questions);

    // Limit count
    if (state.selectedCount !== 'all' && state.selectedCount < questions.length) {
        questions = questions.slice(0, state.selectedCount);
    }

    state.questions = questions;
    state.currentIndex = 0;
    state.answers = {};
    // Don't reset bookmarks — they persist

    // Set subject badge
    const subject = QUESTION_BANK[state.selectedSubject];
    $('quiz-subject-badge').textContent = subject ? subject.name : '';

    // Timer: 2 minutes per question
    state.totalSeconds = questions.length * 120;
    state.remainingSeconds = state.totalSeconds;
    state.startTime = Date.now();

    $('progress-total').textContent = questions.length;

    showScreen('quiz');
    renderQuestion();
    renderNavPills();
    startTimer();
}

function renderQuestion() {
    const q = state.questions[state.currentIndex];
    const idx = state.currentIndex;
    const total = state.questions.length;

    // Question number
    $('question-number').textContent = `Q${idx + 1}`;
    $('progress-current').textContent = idx + 1;

    // Progress bar
    $('progress-bar-fill').style.width = `${((idx + 1) / total) * 100}%`;

    // Question text
    $('question-text').textContent = q.question;

    // Bookmark state
    const bmBtn = $('btn-bookmark');
    if (state.bookmarks.has(q.id)) {
        bmBtn.classList.add('active');
    } else {
        bmBtn.classList.remove('active');
    }

    // Options
    const container = $('options-container');
    container.innerHTML = '';
    const labels = ['A', 'B', 'C', 'D'];
    const userAnswer = state.answers[q.id];
    const hasAnswered = userAnswer !== undefined;

    q.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.innerHTML = `
            <span class="option-label">${labels[i]}</span>
            <span class="option-text">${opt}</span>
        `;

        if (hasAnswered) {
            btn.classList.add('disabled');
            if (i === q.correctIndex) {
                btn.classList.add('correct');
            }
            if (i === userAnswer && userAnswer !== q.correctIndex) {
                btn.classList.add('wrong');
            }
        } else {
            btn.addEventListener('click', () => selectAnswer(i));
        }

        container.appendChild(btn);
    });

    // Explanation
    const expBox = $('explanation-box');
    if (hasAnswered && q.explanation) {
        $('explanation-text').textContent = q.explanation;
        expBox.style.display = '';
    } else {
        expBox.style.display = 'none';
    }

    // Navigation buttons
    $('btn-prev').disabled = idx === 0;

    if (idx === total - 1) {
        $('btn-next').style.display = 'none';
        $('btn-submit-quiz').style.display = '';
    } else {
        $('btn-next').style.display = '';
        $('btn-submit-quiz').style.display = 'none';
    }

    // Update nav pills
    updateNavPillsCurrent();
}

function selectAnswer(optionIndex) {
    const q = state.questions[state.currentIndex];
    state.answers[q.id] = optionIndex;
    renderQuestion();
    updateNavPillState(state.currentIndex);
}

function renderNavPills() {
    const container = $('nav-pills-container');
    container.innerHTML = '';

    state.questions.forEach((q, i) => {
        const pill = document.createElement('button');
        pill.className = 'nav-pill';
        pill.textContent = i + 1;
        pill.addEventListener('click', () => {
            state.currentIndex = i;
            renderQuestion();
        });
        container.appendChild(pill);
    });

    updateNavPillsCurrent();
}

function updateNavPillsCurrent() {
    const pills = $('nav-pills-container').children;
    for (let i = 0; i < pills.length; i++) {
        pills[i].classList.remove('current');
        if (i === state.currentIndex) {
            pills[i].classList.add('current');
        }
        updateNavPillState(i);
    }
}

function updateNavPillState(index) {
    const pill = $('nav-pills-container').children[index];
    if (!pill) return;

    const q = state.questions[index];
    const userAnswer = state.answers[q.id];
    
    pill.classList.remove('answered', 'answered-wrong');

    if (userAnswer !== undefined) {
        if (userAnswer === q.correctIndex) {
            pill.classList.add('answered');
        } else {
            pill.classList.add('answered-wrong');
        }
    }

    // Bookmark indicator
    if (state.bookmarks.has(q.id)) {
        pill.classList.add('bookmarked');
    } else {
        pill.classList.remove('bookmarked');
    }
}

// ============================================
// TIMER
// ============================================
function startTimer() {
    clearInterval(state.timerInterval);
    updateTimerDisplay();

    state.timerInterval = setInterval(() => {
        state.remainingSeconds--;
        updateTimerDisplay();

        if (state.remainingSeconds <= 0) {
            clearInterval(state.timerInterval);
            finishQuiz();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const mins = Math.floor(state.remainingSeconds / 60);
    const secs = state.remainingSeconds % 60;
    $('timer-text').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    const display = document.querySelector('.timer-display');
    display.classList.remove('warning', 'danger');

    if (state.remainingSeconds <= 60) {
        display.classList.add('danger');
    } else if (state.remainingSeconds <= state.totalSeconds * 0.2) {
        display.classList.add('warning');
    }
}

function stopTimer() {
    clearInterval(state.timerInterval);
    state.timeElapsed = Math.floor((Date.now() - state.startTime) / 1000);
}

// ============================================
// QUIZ NAVIGATION
// ============================================
function nextQuestion() {
    if (state.currentIndex < state.questions.length - 1) {
        state.currentIndex++;
        renderQuestion();
    }
}

function prevQuestion() {
    if (state.currentIndex > 0) {
        state.currentIndex--;
        renderQuestion();
    }
}

function toggleBookmark() {
    const q = state.questions[state.currentIndex];
    if (state.bookmarks.has(q.id)) {
        state.bookmarks.delete(q.id);
    } else {
        state.bookmarks.add(q.id);
    }
    // Save to localStorage
    localStorage.setItem('yourquiz_bookmarks', JSON.stringify([...state.bookmarks]));
    renderQuestion();
    updateNavPillState(state.currentIndex);
}

// ============================================
// SUBMIT / FINISH QUIZ
// ============================================
function attemptSubmit() {
    const unanswered = state.questions.filter(q => state.answers[q.id] === undefined).length;

    if (unanswered > 0) {
        $('modal-title').textContent = 'Submit Quiz?';
        $('modal-desc').textContent = `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Are you sure you want to submit?`;
        $('modal-overlay').style.display = '';
    } else {
        finishQuiz();
    }
}

function confirmSubmit() {
    $('modal-overlay').style.display = 'none';
    finishQuiz();
}

function cancelModal() {
    $('modal-overlay').style.display = 'none';
}

function quitQuiz() {
    $('modal-title').textContent = 'Quit Quiz?';
    $('modal-desc').textContent = 'Are you sure you want to quit? Your progress will be lost.';
    $('modal-confirm').textContent = 'Quit';

    // Temporarily rebind confirm
    $('modal-confirm').onclick = () => {
        $('modal-overlay').style.display = 'none';
        stopTimer();
        showScreen('landing');
        // Reset confirm
        $('modal-confirm').onclick = confirmSubmit;
        $('modal-confirm').textContent = 'Submit';
    };

    $('modal-overlay').style.display = '';
}

function finishQuiz() {
    stopTimer();

    // Calculate score
    let correct = 0;
    let wrong = 0;
    let skipped = 0;

    state.questions.forEach(q => {
        const ans = state.answers[q.id];
        if (ans === undefined) {
            skipped++;
        } else if (ans === q.correctIndex) {
            correct++;
        } else {
            wrong++;
        }
    });

    state.score = correct;
    const total = state.questions.length;
    const percent = Math.round((correct / total) * 100);

    // Update Results UI
    $('stat-correct').textContent = correct;
    $('stat-wrong').textContent = wrong;
    $('stat-skipped').textContent = skipped;

    const mins = Math.floor(state.timeElapsed / 60);
    const secs = state.timeElapsed % 60;
    $('stat-time').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Animate score ring
    const circumference = 2 * Math.PI * 52; // r=52
    const targetOffset = circumference - (percent / 100) * circumference;
    const ring = $('score-ring-circle');
    ring.style.strokeDashoffset = circumference;

    showScreen('results');

    // Animate after screen transition
    requestAnimationFrame(() => {
        setTimeout(() => {
            ring.style.transition = 'stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)';
            ring.style.strokeDashoffset = targetOffset;

            // Animate percentage counter
            animateCounter($('score-percent'), 0, percent, 1200);
        }, 200);
    });
}

function animateCounter(element, start, end, duration) {
    const startTime = performance.now();
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (end - start) * eased);
        element.textContent = `${current}%`;
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    requestAnimationFrame(update);
}

// ============================================
// ANSWER SHEET
// ============================================
function showAnswerSheet() {
    showScreen('answersheet');
    renderAnswerSheet('all');
}

function renderAnswerSheet(filter) {
    const body = $('sheet-body');
    body.innerHTML = '';

    const labels = ['A', 'B', 'C', 'D'];

    state.questions.forEach((q, idx) => {
        const userAnswer = state.answers[q.id];
        const isCorrect = userAnswer === q.correctIndex;
        const isSkipped = userAnswer === undefined;

        // Filter logic
        if (filter === 'correct' && !isCorrect) return;
        if (filter === 'wrong' && (isCorrect || isSkipped)) return;
        if (filter === 'skipped' && !isSkipped) return;
        if (filter === 'bookmarked' && !state.bookmarks.has(q.id)) return;

        const statusClass = isSkipped ? 'sheet-skipped' : (isCorrect ? 'sheet-correct' : 'sheet-wrong');
        const badgeClass = isSkipped ? 'skipped-badge' : (isCorrect ? 'correct-badge' : 'wrong-badge');
        const badgeText = isSkipped ? 'Skipped' : (isCorrect ? 'Correct' : 'Wrong');

        const item = document.createElement('div');
        item.className = `sheet-item ${statusClass}`;

        let bookmarkHTML = '';
        if (state.bookmarks.has(q.id)) {
            bookmarkHTML = '<span class="sheet-bookmark-icon">🔖</span>';
        }

        let optionsHTML = '';
        q.options.forEach((opt, i) => {
            let optClass = '';
            if (!isSkipped && i === userAnswer && !isCorrect) {
                optClass = 'user-answer-wrong';
            }
            if (i === q.correctIndex) {
                optClass = isSkipped ? 'correct-answer' : (isCorrect ? 'user-answer-correct' : 'correct-answer');
            }
            optionsHTML += `
                <div class="sheet-option ${optClass}">
                    <span class="sheet-option-label">${labels[i]})</span>
                    <span>${opt}</span>
                </div>
            `;
        });

        let explanationHTML = '';
        if (q.explanation) {
            explanationHTML = `
                <div class="sheet-explanation">
                    <div class="sheet-explanation-title">💡 Explanation</div>
                    <p class="sheet-explanation-text">${q.explanation}</p>
                </div>
            `;
        }

        item.innerHTML = `
            <div class="sheet-item-header">
                <span class="sheet-q-number">Q${idx + 1}</span>
                <span class="sheet-status-badge ${badgeClass}">${badgeText}</span>
                ${bookmarkHTML}
            </div>
            <p class="sheet-question-text">${q.question}</p>
            <div class="sheet-options">${optionsHTML}</div>
            ${explanationHTML}
        `;

        body.appendChild(item);
    });

    if (body.children.length === 0) {
        body.innerHTML = '<div style="text-align:center; padding:60px 20px; color: var(--text-muted);">No questions match this filter.</div>';
    }
}

function retakeQuiz() {
    // Reset score ring animation
    const ring = $('score-ring-circle');
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = 326.73;
    $('score-percent').textContent = '0%';

    showScreen('landing');
}

// ============================================
// EVENT LISTENERS
// ============================================
function initEventListeners() {
    // Quiz navigation
    $('btn-next').addEventListener('click', nextQuestion);
    $('btn-prev').addEventListener('click', prevQuestion);
    $('btn-bookmark').addEventListener('click', toggleBookmark);
    $('btn-submit-quiz').addEventListener('click', attemptSubmit);
    $('btn-quit').addEventListener('click', quitQuiz);

    // Modal
    $('modal-confirm').addEventListener('click', confirmSubmit);
    $('modal-cancel').addEventListener('click', cancelModal);
    $('modal-overlay').addEventListener('click', (e) => {
        if (e.target === $('modal-overlay')) cancelModal();
    });

    // Results
    $('btn-answer-sheet').addEventListener('click', showAnswerSheet);
    $('btn-retake').addEventListener('click', retakeQuiz);
    $('btn-retake-sheet').addEventListener('click', retakeQuiz);
    $('btn-back-results').addEventListener('click', () => showScreen('results'));

    // Answer sheet filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAnswerSheet(btn.dataset.filter);
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (!screens.quiz.classList.contains('active')) return;

        switch (e.key) {
            case 'ArrowRight':
            case 'n':
                nextQuestion();
                break;
            case 'ArrowLeft':
            case 'p':
                prevQuestion();
                break;
            case 'b':
                toggleBookmark();
                break;
            case '1': case '2': case '3': case '4':
                const q = state.questions[state.currentIndex];
                if (state.answers[q.id] === undefined) {
                    selectAnswer(parseInt(e.key) - 1);
                }
                break;
        }
    });
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initLanding();
    initEventListeners();
});
