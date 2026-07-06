// SAT Daily — Sprint: 60 seconds of rapid-fire mental math.
(function () {
  const { el, share, dayIndex } = SAT.util;
  const store = SAT.store;
  const DURATION = 60;

  function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function pick(arr) { return arr[ri(0, arr.length - 1)]; }

  // Each generator returns { q, answer } with an integer answer.
  const GENERATORS = [
    function addSub() {
      const a = ri(13, 89), b = ri(12, 78);
      return Math.random() < 0.5
        ? { q: a + ' + ' + b + ' = ?', answer: a + b }
        : { q: (a + b) + ' − ' + b + ' = ?', answer: a };
    },
    function times() {
      const a = ri(3, 12), b = ri(6, 15);
      return { q: a + ' × ' + b + ' = ?', answer: a * b };
    },
    function divide() {
      const b = ri(3, 12), ans = ri(4, 13);
      return { q: (b * ans) + ' ÷ ' + b + ' = ?', answer: ans };
    },
    function percent() {
      const pct = pick([10, 20, 25, 50, 75]);
      const base = pick([40, 60, 80, 120, 160, 200, 240, 300]);
      return { q: pct + '% of ' + base + ' = ?', answer: (pct * base) / 100 };
    },
    function solveX() {
      const a = ri(2, 9), x = ri(2, 12), b = ri(1, 20);
      return { q: 'If ' + a + 'x + ' + b + ' = ' + (a * x + b) + ', x = ?', answer: x };
    },
    function square() {
      const n = ri(4, 15);
      return { q: n + '² = ?', answer: n * n };
    },
    function fraction() {
      const f = pick([[1, 2], [1, 3], [1, 4], [2, 3], [3, 4]]);
      const mult = ri(2, 9);
      const base = f[1] * mult * pick([1, 2, 3]);
      return { q: f[0] + '/' + f[1] + ' of ' + base + ' = ?', answer: (base / f[1]) * f[0] };
    },
    function mean() {
      const m = ri(5, 20), d = ri(1, 4);
      const nums = [m - d, m, m + d];
      return { q: 'Mean of ' + nums.join(', ') + ' = ?', answer: m };
    }
  ];

  function makeQuestion() {
    const { q, answer } = pick(GENERATORS)();
    const opts = new Set([answer]);
    let guard = 0;
    while (opts.size < 4 && guard++ < 60) {
      const delta = pick([-10, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 10]);
      const cand = answer + delta;
      if (cand >= 0) opts.add(cand);
    }
    while (opts.size < 4) opts.add(answer + opts.size * 7 + 1);
    const choices = Array.from(opts).sort(() => Math.random() - 0.5);
    return { q, answer, choices };
  }

  function render(view, practice) {
    const doneToday = !practice && store.dailyRecord('sprint');
    const best = store.raw().games.sprint.best;

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['Sprint']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, ['60 seconds. As many mental-math problems as you can. No calculator — that’s the point.']));

    const body = el('div');
    view.appendChild(body);

    let timer = null;

    function splash() {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'sprint-splash' }, [
        el('div', { class: 'big' }, ['⚡']),
        doneToday ? el('div', { class: 'big-score' }, [doneToday.score]) : null,
        doneToday ? el('p', { class: 'sub' }, ['Today’s score. Best ever: ' + best]) : el('p', { class: 'sub' }, [best > 0 ? 'Best ever: ' + best : 'First run — set a baseline!']),
        el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn', onclick: start }, [doneToday ? 'Run it again' : 'Start']),
          doneToday ? el('button', {
            class: 'btn secondary',
            onclick: () => share('SAT Daily Sprint #' + (dayIndex() + 1), '⚡ ' + doneToday.score + ' correct in 60s')
          }, ['Share']) : null
        ])
      ]));
    }

    function start() {
      let score = 0;
      let left = DURATION;
      body.innerHTML = '';

      const scoreEl = el('span', { class: 'sprint-score-live' }, ['Score: 0']);
      const timeEl = el('span', { class: 'quiz-timer' }, ['1:00']);
      const bar = el('div', { class: 'timebar', style: 'width:100%' });
      body.appendChild(el('div', { class: 'quiz-meta' }, [scoreEl, timeEl]));
      body.appendChild(el('div', { class: 'timebar-track' }, [bar]));
      const qArea = el('div');
      body.appendChild(qArea);

      timer = setInterval(() => {
        left--;
        timeEl.textContent = '0:' + String(Math.max(left, 0)).padStart(2, '0');
        if (left <= 10) timeEl.classList.add('hot');
        bar.style.width = (Math.max(left, 0) / DURATION) * 100 + '%';
        if (left <= 0) finish();
      }, 1000);

      function nextQuestion() {
        qArea.innerHTML = '';
        const { q, answer, choices } = makeQuestion();
        qArea.appendChild(el('div', { class: 'sprint-q' }, [q]));
        const grid = el('div', { class: 'sprint-choices' });
        let locked = false;
        choices.forEach((c) => {
          grid.appendChild(el('button', {
            class: 'choice',
            onclick: function () {
              if (locked) return;
              locked = true;
              const right = c === answer;
              store.recordTopic('mental-math', right);
              if (right) {
                score++;
                scoreEl.textContent = 'Score: ' + score;
                this.classList.add('correct');
              } else {
                this.classList.add('wrong');
                grid.querySelectorAll('.choice').forEach((btn) => {
                  if (btn.textContent === String(answer)) btn.classList.add('correct');
                });
              }
              setTimeout(nextQuestion, right ? 120 : 550);
            }
          }, [String(c)]));
        });
        qArea.appendChild(grid);
      }

      function finish() {
        clearInterval(timer);
        timer = null;
        store.recordSprint(score);
        if (!practice) {
          const prev = store.dailyRecord('sprint');
          // keep the best score of the day as the daily record
          if (!prev || score > prev.score) store.completeDaily('sprint', { score });
          else store.completeDaily('sprint', prev);
        }
        const newBest = score > best && best > 0;
        body.innerHTML = '';
        body.appendChild(el('div', { class: 'sprint-splash' }, [
          el('h2', {}, [newBest ? '🏆 New personal best!' : 'Time!']),
          el('div', { class: 'big-score' }, [String(score)]),
          el('p', { class: 'sub' }, ['correct in 60 seconds' + (store.raw().games.sprint.best > score ? ' · best: ' + store.raw().games.sprint.best : '')]),
          el('div', { class: 'btn-row' }, [
            el('button', { class: 'btn', onclick: start }, ['Go again']),
            el('button', {
              class: 'btn secondary',
              onclick: () => share('SAT Daily Sprint #' + (dayIndex() + 1), '⚡ ' + score + ' correct in 60s')
            }, ['Share']),
            el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
          ])
        ]));
      }

      nextQuestion();
    }

    splash();
    return () => { if (timer) clearInterval(timer); };
  }

  SAT.router.register('/sprint', (view) => render(view, false));
  SAT.router.register('/sprint/practice', (view) => render(view, true));
})();
