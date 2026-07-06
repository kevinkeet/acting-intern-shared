// SAT Daily — Sprint: 60 seconds of rapid-fire mental math.
(function () {
  const { el, share, dayIndex } = SAT.util;
  const store = SAT.store;
  const DURATION = 60;

  function ri(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
  function pick(arr) { return arr[ri(0, arr.length - 1)]; }

  // Each generator returns { q, answer, skill } — skill feeds the mastery
  // tracker (null for pure-arithmetic warmups the SAT doesn't test directly).
  const GENERATORS = [
    function addSub() {
      const a = ri(13, 89), b = ri(12, 78);
      return Math.random() < 0.5
        ? { q: a + ' + ' + b + ' = ?', answer: a + b, skill: null }
        : { q: (a + b) + ' − ' + b + ' = ?', answer: a, skill: null };
    },
    function times() {
      const a = ri(3, 12), b = ri(6, 15);
      return { q: a + ' × ' + b + ' = ?', answer: a * b, skill: null };
    },
    function divide() {
      const b = ri(3, 12), ans = ri(4, 13);
      return { q: (b * ans) + ' ÷ ' + b + ' = ?', answer: ans, skill: null };
    },
    function percent() {
      const pct = pick([10, 20, 25, 50, 75]);
      const base = pick([40, 60, 80, 120, 160, 200, 240, 300]);
      return { q: pct + '% of ' + base + ' = ?', answer: (pct * base) / 100, skill: 'psda-percent' };
    },
    function percentChange() {
      const base = pick([50, 80, 100, 120, 200]);
      const pct = pick([10, 20, 25, 50]);
      const up = Math.random() < 0.5;
      return {
        q: base + ' ' + (up ? 'increased' : 'decreased') + ' by ' + pct + '% = ?',
        answer: up ? base + (base * pct) / 100 : base - (base * pct) / 100,
        skill: 'psda-percent'
      };
    },
    function solveX() {
      const a = ri(2, 9), x = ri(2, 12), b = ri(1, 20);
      return { q: 'If ' + a + 'x + ' + b + ' = ' + (a * x + b) + ', x = ?', answer: x, skill: 'alg-lin1' };
    },
    function evalLinear() {
      const m = ri(2, 8), b = ri(1, 15), x = ri(2, 9);
      return { q: 'f(x) = ' + m + 'x + ' + b + '. f(' + x + ') = ?', answer: m * x + b, skill: 'alg-linfunc' };
    },
    function slope() {
      const x1 = ri(0, 5), y1 = ri(0, 10), m = ri(2, 6), dx = ri(1, 4);
      return {
        q: 'Slope through (' + x1 + ', ' + y1 + ') and (' + (x1 + dx) + ', ' + (y1 + m * dx) + ') = ?',
        answer: m, skill: 'alg-lin2'
      };
    },
    function square() {
      const n = ri(4, 15);
      return { q: n + '² = ?', answer: n * n, skill: 'adv-equiv' };
    },
    function exponentRule() {
      const a = ri(2, 6), b = ri(2, 6);
      return { q: 'x' + sup(a) + ' · x' + sup(b) + ' = x^?', answer: a + b, skill: 'adv-equiv' };
    },
    function fraction() {
      const f = pick([[1, 2], [1, 3], [1, 4], [2, 3], [3, 4]]);
      const mult = ri(2, 9);
      const base = f[1] * mult * pick([1, 2, 3]);
      return { q: f[0] + '/' + f[1] + ' of ' + base + ' = ?', answer: (base / f[1]) * f[0], skill: 'psda-ratio' };
    },
    function unitRate() {
      const rate = ri(3, 12), n = pick([4, 5, 6, 8, 10]);
      return { q: n + ' items cost $' + n * rate + '. One item = $?', answer: rate, skill: 'psda-ratio' };
    },
    function mean() {
      const m = ri(5, 20), d = ri(1, 4);
      const nums = [m - d, m, m + d];
      return { q: 'Mean of ' + nums.join(', ') + ' = ?', answer: m, skill: 'psda-1var' };
    },
    function rectArea() {
      const w = ri(3, 9), l = ri(4, 12);
      return Math.random() < 0.5
        ? { q: 'Area of a ' + l + ' × ' + w + ' rectangle = ?', answer: l * w, skill: 'geo-area' }
        : { q: 'Perimeter of a ' + l + ' × ' + w + ' rectangle = ?', answer: 2 * (l + w), skill: 'geo-area' };
    },
    function pythag() {
      const t = pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17]]);
      return { q: 'Right triangle, legs ' + t[0] + ' and ' + t[1] + '. Hypotenuse = ?', answer: t[2], skill: 'geo-trig' };
    }
  ];

  function sup(n) {
    const map = { 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶' };
    return map[n] || '^' + n;
  }

  function makeQuestion() {
    const { q, answer, skill } = pick(GENERATORS)();
    const opts = new Set([answer]);
    let guard = 0;
    while (opts.size < 4 && guard++ < 60) {
      const delta = pick([-10, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 10]);
      const cand = answer + delta;
      if (cand >= 0) opts.add(cand);
    }
    while (opts.size < 4) opts.add(answer + opts.size * 7 + 1);
    const choices = Array.from(opts).sort(() => Math.random() - 0.5);
    return { q, answer, choices, skill };
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
        const { q, answer, choices, skill } = makeQuestion();
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
              if (skill) store.recordSkill(skill, right);
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
