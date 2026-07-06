// SAT Daily — The Editor: 90 seconds of rapid-fire Standard English
// Conventions. Covers the SAT's most-tested R&W domain (~26% of the section).
(function () {
  const { el, share, dayIndex, shuffle } = SAT.util;
  const store = SAT.store;
  const DURATION = 90;

  function render(view, practice) {
    const doneToday = !practice && store.dailyRecord('editor');
    const best = store.raw().games.editor.best;

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['The Editor']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, ['90 seconds. Fix as many sentences as you can — punctuation, agreement, usage.']));

    const body = el('div');
    view.appendChild(body);

    let timer = null;

    function splash() {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'sprint-splash' }, [
        el('div', { class: 'big' }, ['✏️']),
        doneToday ? el('div', { class: 'big-score' }, [String(doneToday.score)]) : null,
        doneToday
          ? el('p', { class: 'sub' }, ['Today’s score. Best ever: ' + best])
          : el('p', { class: 'sub' }, [best > 0 ? 'Best ever: ' + best : 'Every sentence has exactly one right fix.']),
        el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn', onclick: start }, [doneToday ? 'Run it again' : 'Start']),
          doneToday ? el('button', {
            class: 'btn secondary',
            onclick: () => share('SAT Daily Editor #' + (dayIndex() + 1), '✏️ ' + doneToday.score + ' sentences fixed in 90s')
          }, ['Share']) : null
        ])
      ]));
    }

    function start() {
      let score = 0;
      let left = DURATION;
      let deck = shuffle(window.SAT_EDITOR || []);
      let deckIdx = 0;
      const missed = [];
      body.innerHTML = '';

      const scoreEl = el('span', { class: 'sprint-score-live' }, ['Fixed: 0']);
      const timeEl = el('span', { class: 'quiz-timer' }, ['1:30']);
      const bar = el('div', { class: 'timebar', style: 'width:100%' });
      body.appendChild(el('div', { class: 'quiz-meta' }, [scoreEl, timeEl]));
      body.appendChild(el('div', { class: 'timebar-track' }, [bar]));
      const qArea = el('div');
      body.appendChild(qArea);

      timer = setInterval(() => {
        left--;
        const m = Math.floor(Math.max(left, 0) / 60);
        timeEl.textContent = m + ':' + String(Math.max(left, 0) % 60).padStart(2, '0');
        if (left <= 15) timeEl.classList.add('hot');
        bar.style.width = (Math.max(left, 0) / DURATION) * 100 + '%';
        if (left <= 0) finish();
      }, 1000);

      function nextItem() {
        if (deckIdx >= deck.length) { deck = shuffle(deck); deckIdx = 0; }
        const item = deck[deckIdx++];
        qArea.innerHTML = '';
        const parts = item.s.split('___');
        qArea.appendChild(el('div', { class: 'editor-sentence' }, [
          parts[0], el('span', { class: 'editor-blank' }, ['____']), parts[1] || ''
        ]));
        const grid = el('div', { class: 'choices' });
        let locked = false;
        item.c.forEach((c, ci) => {
          grid.appendChild(el('button', {
            class: 'choice editor-choice',
            onclick: function () {
              if (locked) return;
              locked = true;
              const right = ci === item.a;
              store.recordSkill(item.skill, right);
              if (right) {
                score++;
                scoreEl.textContent = 'Fixed: ' + score;
                this.classList.add('correct');
              } else {
                this.classList.add('wrong');
                grid.children[item.a].classList.add('correct');
                missed.push(item);
              }
              setTimeout(nextItem, right ? 150 : 700);
            }
          }, [c]));
        });
        qArea.appendChild(grid);
      }

      function finish() {
        clearInterval(timer);
        timer = null;
        store.recordEditor(score);
        if (!practice) {
          const prev = store.dailyRecord('editor');
          if (!prev || score > prev.score) store.completeDaily('editor', { score });
          else store.completeDaily('editor', prev);
        }
        const newBest = score > best && best > 0;
        body.innerHTML = '';
        const wrap = el('div', { class: 'sprint-splash' }, [
          el('h2', {}, [newBest ? '🏆 New personal best!' : 'Time!']),
          el('div', { class: 'big-score' }, [String(score)]),
          el('p', { class: 'sub' }, ['sentences fixed in 90 seconds']),
          el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn', onclick: start }, ['Go again']),
            el('button', {
              class: 'btn secondary',
              onclick: () => share('SAT Daily Editor #' + (dayIndex() + 1), '✏️ ' + score + ' sentences fixed in 90s')
            }, ['Share']),
            el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
          ])
        ]);
        body.appendChild(wrap);

        if (missed.length) {
          const review = el('div', { class: 'stats-section' }, [el('h3', {}, ['Review your misses'])]);
          missed.slice(0, 6).forEach((item) => {
            review.appendChild(el('div', { class: 'explain' }, [
              el('p', { class: 'editor-review-line' }, [item.s.replace('___', '[' + item.c[item.a] + ']')]),
              item.exp
            ]));
          });
          body.appendChild(review);
        }
      }

      nextItem();
    }

    splash();
    return () => { if (timer) clearInterval(timer); };
  }

  SAT.router.register('/editor', (view) => render(view, false));
  SAT.router.register('/editor/practice', (view) => render(view, true));
})();
