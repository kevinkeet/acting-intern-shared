// SAT Daily — Connections: group 16 terms into 4 categories (math + reading/writing).
(function () {
  const { el, toast, modal, share, dayIndex, seededRng, shuffle } = SAT.util;
  const store = SAT.store;
  const PUZZLES = window.SAT_CONNECTIONS;
  const COLORS = ['🟨', '🟩', '🟦', '🟪'];
  const MAX_MISTAKES = 4;

  function dailyIdx() { return ((dayIndex() % PUZZLES.length) + PUZZLES.length) % PUZZLES.length; }

  function render(view, practice) {
    const pIdx = practice
      ? (dailyIdx() + 1 + Math.floor(Math.random() * (PUZZLES.length - 1))) % PUZZLES.length
      : dailyIdx();
    const puzzle = PUZZLES[pIdx];

    const itemGroup = {}; // item -> group index (0 = easiest)
    puzzle.groups.forEach((g, gi) => g.items.forEach((it) => (itemGroup[it] = gi)));

    let solved = [];   // group indices in solve order
    let mistakes = 0;
    let history = [];  // each guess: array of 4 group indices
    let selected = [];
    let over = false;

    const done = !practice && store.dailyRecord('conn');
    if (done) {
      solved = done.solved.slice();
      mistakes = done.mistakes;
      history = done.history || [];
      over = true;
    } else if (!practice) {
      const wip = store.getProgress('conn');
      if (wip) {
        solved = (wip.solved || []).slice();
        mistakes = wip.mistakes || 0;
        history = (wip.history || []).slice();
      }
    }

    const rng = practice ? Math.random : seededRng(dayIndex() * 7919 + 13);
    let tiles = shuffle(
      puzzle.groups.flatMap((g) => g.items).filter((it) => !solved.includes(itemGroup[it])),
      rng
    );

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['Connections']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, ['Find four groups of four. Categories mix SAT math and reading/writing.']));

    const solvedWrap = el('div');
    const grid = el('div', { class: 'conn-grid' });
    const mistakeRow = el('div', { class: 'mistake-dots' });
    const controls = el('div', { class: 'btn-row' });
    view.appendChild(solvedWrap);
    view.appendChild(grid);
    view.appendChild(mistakeRow);
    view.appendChild(controls);

    function drawSolved() {
      solvedWrap.innerHTML = '';
      solved.forEach((gi) => {
        const g = puzzle.groups[gi];
        solvedWrap.appendChild(el('div', { class: 'solved-group c' + gi }, [
          el('h4', {}, [g.title]),
          el('p', {}, [g.items.join(', ')])
        ]));
      });
    }

    function drawGrid() {
      grid.innerHTML = '';
      tiles.forEach((it) => {
        const t = el('button', {
          class: 'conn-tile' + (selected.includes(it) ? ' sel' : ''),
          onclick: () => {
            if (over) return;
            if (selected.includes(it)) selected = selected.filter((s) => s !== it);
            else if (selected.length < 4) selected.push(it);
            drawGrid();
            drawControls();
          }
        }, [it]);
        grid.appendChild(t);
      });
    }

    function drawMistakes() {
      mistakeRow.innerHTML = '';
      mistakeRow.appendChild(el('span', {}, ['Mistakes remaining:']));
      for (let i = 0; i < MAX_MISTAKES; i++) {
        mistakeRow.appendChild(el('span', { class: 'mdot' + (i < mistakes ? ' used' : '') }));
      }
    }

    function drawControls() {
      controls.innerHTML = '';
      if (over) {
        controls.appendChild(el('button', { class: 'btn', onclick: () => showResult(solved.length === 4) }, ['View results']));
        controls.appendChild(el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/connections/practice') }, ['Practice']));
        return;
      }
      controls.appendChild(el('button', {
        class: 'btn secondary small',
        onclick: () => { tiles = shuffle(tiles); drawGrid(); }
      }, ['Shuffle']));
      controls.appendChild(el('button', {
        class: 'btn secondary small',
        onclick: () => { selected = []; drawGrid(); drawControls(); }
      }, ['Deselect']));
      const submit = el('button', { class: 'btn small', onclick: submitGuess }, ['Submit']);
      if (selected.length !== 4) submit.disabled = true;
      controls.appendChild(submit);
    }

    function persist() {
      if (!practice) store.saveProgress('conn', { solved, mistakes, history });
    }

    function submitGuess() {
      const groups = selected.map((it) => itemGroup[it]);
      history.push(groups.slice());
      const allSame = groups.every((g) => g === groups[0]);

      if (allSame) {
        solved.push(groups[0]);
        tiles = tiles.filter((it) => !selected.includes(it));
        selected = [];
        drawSolved();
        drawGrid();
        drawControls();
        if (solved.length === 4) return finish(true);
        persist();
        return;
      }

      // count the most common group in the guess
      const tally = {};
      groups.forEach((g) => (tally[g] = (tally[g] || 0) + 1));
      const maxSame = Math.max(...Object.values(tally));
      mistakes++;
      drawMistakes();
      grid.querySelectorAll('.conn-tile.sel').forEach((t) => {
        t.classList.add('shake');
        setTimeout(() => t.classList.remove('shake'), 400);
      });
      if (mistakes >= MAX_MISTAKES) return finish(false);
      toast(maxSame === 3 ? 'One away!' : 'Not a group');
      persist();
    }

    function finish(won) {
      over = true;
      if (!won) {
        // reveal the unsolved groups in difficulty order
        puzzle.groups.forEach((g, gi) => { if (!solved.includes(gi)) solved.push(gi); });
        tiles = [];
        drawSolved();
        drawGrid();
      }
      selected = [];
      drawControls();
      store.recordConn(won, mistakes);
      if (!practice) store.completeDaily('conn', { won, solved, mistakes, history });
      setTimeout(() => showResult(won), 600);
    }

    function emojiGrid() {
      return history.map((guess) => guess.map((g) => COLORS[g]).join('')).join('\n');
    }

    function showResult(won) {
      const num = dayIndex() + 1;
      modal(el('div', {}, [
        el('h2', {}, [won ? (mistakes === 0 ? 'Perfect!' : 'Solved it!') : 'Next time!']),
        el('p', { class: 'sub' }, [won ? 'You found all four groups with ' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's') + '.' : 'You ran out of guesses — the groups are revealed on the board.']),
        el('div', { class: 'share-grid' }, [emojiGrid()]),
        el('div', { class: 'btn-row' }, [
          practice ? null : el('button', {
            class: 'btn',
            onclick: () => share('SAT Daily Connections #' + num + (won ? ' ✓' : ' ✗'), emojiGrid())
          }, ['Share']),
          el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/connections/practice') }, ['Practice another']),
          el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
        ])
      ]));
    }

    drawSolved();
    drawGrid();
    drawMistakes();
    drawControls();
  }

  SAT.router.register('/connections', (view) => render(view, false));
  SAT.router.register('/connections/practice', (view) => render(view, true));
})();
