// SAT Daily — Vocab: Wordle-style game where the clue is an SAT definition.
(function () {
  const { el, toast, modal, share, dayIndex } = SAT.util;
  const store = SAT.store;
  const WORDS = window.SAT_VOCAB;
  const ROWS = 6, COLS = 5;
  const KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'];

  function dailyEntry() { return WORDS[((dayIndex() % WORDS.length) + WORDS.length) % WORDS.length]; }

  function randomEntry() {
    const daily = dailyEntry();
    const pool = WORDS.filter((w) => w !== daily);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Standard Wordle scoring with duplicate-letter handling.
  function evaluate(guess, answer) {
    const res = Array(COLS).fill('absent');
    const counts = {};
    for (let i = 0; i < COLS; i++) {
      if (guess[i] === answer[i]) res[i] = 'correct';
      else counts[answer[i]] = (counts[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < COLS; i++) {
      if (res[i] !== 'correct' && counts[guess[i]] > 0) {
        res[i] = 'present';
        counts[guess[i]]--;
      }
    }
    return res;
  }

  function emojiGrid(guesses, answer) {
    return guesses
      .map((g) => evaluate(g, answer).map((r) => (r === 'correct' ? '🟩' : r === 'present' ? '🟨' : '⬜')).join(''))
      .join('\n');
  }

  function render(view, practice) {
    const entry = practice ? randomEntry() : dailyEntry();
    const answer = entry.w;
    let guesses = [];
    let current = '';
    let over = false;

    const done = !practice && store.dailyRecord('vocab');
    if (done) {
      guesses = done.guesses.slice();
      over = true;
    } else if (!practice) {
      const wip = store.getProgress('vocab');
      if (wip && wip.guesses) guesses = wip.guesses.slice();
    }

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['Vocab']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, ['Guess the 5-letter SAT word that matches the definition. 6 tries.']));
    view.appendChild(el('div', { class: 'defcard' }, [
      el('span', { class: 'pos' }, [entry.pos + ' — ']),
      entry.def
    ]));

    const board = el('div', { class: 'board' });
    view.appendChild(board);

    const kb = el('div', { class: 'kb' });
    const keyEls = {};
    KB_ROWS.forEach((row) => {
      const r = el('div', { class: 'kb-row' });
      row.split('').forEach((ch) => {
        const isEnter = ch === '⏎', isBack = ch === '⌫';
        const k = el('button', {
          class: 'key' + (isEnter || isBack ? ' wide' : ''),
          onclick: () => handleKey(isEnter ? 'Enter' : isBack ? 'Backspace' : ch)
        }, [isEnter ? 'Enter' : ch]);
        if (!isEnter && !isBack) keyEls[ch] = k;
        r.appendChild(k);
      });
      kb.appendChild(r);
    });
    view.appendChild(kb);

    function drawBoard() {
      board.innerHTML = '';
      for (let r = 0; r < ROWS; r++) {
        const rowEl = el('div', { class: 'board-row', 'data-row': r });
        const g = guesses[r];
        for (let c = 0; c < COLS; c++) {
          let cls = 'tile', letter = '';
          if (g) {
            letter = g[c];
            cls += ' ' + evaluate(g, answer)[c];
          } else if (r === guesses.length && current[c]) {
            letter = current[c];
            cls += ' filled';
          }
          rowEl.appendChild(el('div', { class: cls }, [letter]));
        }
        board.appendChild(rowEl);
      }
      // keyboard coloring: best status per letter across all guesses
      const rank = { absent: 1, present: 2, correct: 3 };
      const best = {};
      guesses.forEach((g) => {
        const res = evaluate(g, answer);
        for (let i = 0; i < COLS; i++) {
          if (!best[g[i]] || rank[res[i]] > rank[best[g[i]]]) best[g[i]] = res[i];
        }
      });
      for (const ch in keyEls) {
        keyEls[ch].classList.remove('correct', 'present', 'absent');
        if (best[ch]) keyEls[ch].classList.add(best[ch]);
      }
    }

    function shakeCurrentRow() {
      const rowEl = board.querySelector('[data-row="' + guesses.length + '"]');
      if (rowEl) {
        rowEl.classList.add('shake');
        setTimeout(() => rowEl.classList.remove('shake'), 400);
      }
    }

    function handleKey(key) {
      if (over) return;
      if (key === 'Enter') {
        if (current.length < COLS) { toast('Not enough letters'); shakeCurrentRow(); return; }
        if (!/^[A-Z]{5}$/.test(current)) { toast('Letters only'); shakeCurrentRow(); return; }
        guesses.push(current);
        current = '';
        drawBoard();
        const won = guesses[guesses.length - 1] === answer;
        if (won || guesses.length === ROWS) {
          finish(won);
        } else if (!practice) {
          store.saveProgress('vocab', { guesses });
        }
        return;
      }
      if (key === 'Backspace') {
        current = current.slice(0, -1);
        drawBoard();
        return;
      }
      if (/^[a-zA-Z]$/.test(key) && current.length < COLS) {
        current += key.toUpperCase();
        drawBoard();
      }
    }

    function finish(won) {
      over = true;
      store.recordVocab(won, guesses.length);
      store.recordTopic('vocabulary', won);
      if (!practice) {
        store.completeDaily('vocab', { won, guesses });
      }
      setTimeout(() => showResult(won), 500);
    }

    function showResult(won) {
      const num = dayIndex() + 1;
      const scoreLabel = won ? guesses.length + '/6' : 'X/6';
      modal(el('div', {}, [
        el('h2', {}, [won ? (guesses.length <= 2 ? 'Genius!' : guesses.length <= 4 ? 'Nailed it!' : 'Phew!') : 'The word was…']),
        el('div', { class: 'result-word' }, [answer]),
        el('p', { class: 'result-def' }, [entry.pos + ' — ' + entry.def]),
        el('p', { class: 'result-def' }, ['“' + entry.ex.replace('___', answer.toLowerCase()) + '”']),
        el('div', { class: 'share-grid' }, [emojiGrid(guesses, answer)]),
        el('div', { class: 'btn-row' }, [
          practice ? null : el('button', {
            class: 'btn', onclick: () => share('SAT Daily Vocab #' + num + ' — ' + scoreLabel, emojiGrid(guesses, answer))
          }, ['Share']),
          el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/vocab/practice') }, ['Practice another']),
          el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
        ])
      ]));
    }

    drawBoard();

    if (over && done) {
      view.appendChild(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: () => showResult(done.won) }, ['View results']),
        el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/vocab/practice') }, ['Practice'])
      ]));
    }

    const onKeydown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.modal-scrim')) return; // let modal buttons receive Enter
      if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault(); // keep Enter from re-clicking a focused on-screen key
        handleKey(e.key);
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }

  SAT.router.register('/vocab', (view) => render(view, false));
  SAT.router.register('/vocab/practice', (view) => render(view, true));
})();
