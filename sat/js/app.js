// SAT Daily — home + stats pages.
(function () {
  const { el, todayStr, dayIndex, modal } = SAT.util;
  const store = SAT.store;

  const GAMES = [
    { key: 'vocab', route: '/vocab', cls: 'vocab', icon: '🟩', name: 'Vocab',
      desc: 'Guess the SAT word from its definition. Wordle rules, test-day payoff.',
      result: (r) => (r.won ? 'Solved in ' + r.guesses.length + '/6' : 'Revealed — see the word') },
    { key: 'conn', route: '/connections', cls: 'conn', icon: '🟪', name: 'Connections',
      desc: 'Sort 16 terms into 4 groups — math and reading mixed together.',
      result: (r) => (r.won ? 'Solved with ' + r.mistakes + ' mistake' + (r.mistakes === 1 ? '' : 's') : 'Out of guesses') },
    { key: 'mini', route: '/mini', cls: 'mini', icon: '🔵', name: 'The Mini',
      desc: '5 real SAT questions against the clock, with explanations.',
      result: (r) => r.correct + '/' + r.total + ' in ' + Math.floor(r.seconds / 60) + ':' + String(r.seconds % 60).padStart(2, '0') },
    { key: 'sprint', route: '/sprint', cls: 'sprint', icon: '⚡', name: 'Sprint',
      desc: '60 seconds of mental math. No calculator, no mercy.',
      result: (r) => r.score + ' correct in 60s' }
  ];

  // ---------- Home ----------
  SAT.router.register('/', (view) => {
    const now = new Date();
    const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const streak = store.streak();
    const doneCount = GAMES.filter((g) => store.dailyRecord(g.key)).length;

    view.appendChild(el('p', { class: 'home-date' }, [dateLabel + ' · Puzzle #' + (dayIndex() + 1)]));
    view.appendChild(el('h1', { class: 'home-greeting' }, [
      doneCount === GAMES.length ? 'All done for today! 🎉' : 'Today’s games'
    ]));
    view.appendChild(el('div', { class: 'streak-chip' }, [
      '🔥 ' + streak + '-day streak',
      doneCount > 0 ? ' · ' + doneCount + '/' + GAMES.length + ' played today' : ''
    ]));

    const grid = el('div', { class: 'game-grid' });
    GAMES.forEach((g) => {
      const rec = store.dailyRecord(g.key);
      grid.appendChild(el('button', {
        class: 'game-card ' + g.cls,
        onclick: () => SAT.router.navigate(g.route)
      }, [
        rec ? el('span', { class: 'done-badge' }, ['✓']) : null,
        el('div', { class: 'game-icon' }, [g.icon]),
        el('div', { class: 'game-name' }, [g.name]),
        el('div', { class: 'game-desc' }, [g.desc]),
        el('div', { class: 'game-status ' + (rec ? 'done' : 'todo') }, [rec ? g.result(rec) : 'Play →'])
      ]));
    });
    view.appendChild(grid);

    view.appendChild(el('div', { class: 'home-footer' }, [
      el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/stats') }, ['📊 My progress'])
    ]));
  });

  // ---------- Stats ----------
  const MATH_TOPICS = [
    ['algebra', 'Algebra'], ['geometry', 'Geometry'], ['data', 'Data & Stats'],
    ['advanced', 'Advanced Math'], ['mental-math', 'Mental Math']
  ];
  const RW_TOPICS = [
    ['grammar', 'Grammar'], ['vocabulary', 'Vocabulary'], ['reading', 'Reading']
  ];

  function topicBars(pairs, cls, topics) {
    const wrap = el('div');
    let any = false;
    pairs.forEach(([key, label]) => {
      const t = topics[key];
      if (!t || t.t === 0) return;
      any = true;
      const pct = Math.round((t.c / t.t) * 100);
      wrap.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-label' }, [label]),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill ' + cls, style: 'width:' + pct + '%' })]),
        el('span', { class: 'bar-val' }, [pct + '% (' + t.c + '/' + t.t + ')'])
      ]));
    });
    if (!any) wrap.appendChild(el('p', { class: 'empty-note' }, ['No questions answered yet — play The Mini or Sprint to build this chart.']));
    return wrap;
  }

  SAT.router.register('/stats', (view) => {
    const s = store.raw();
    const g = s.games;
    const totalPlays = g.vocab.played + g.conn.played + g.mini.played + g.sprint.played;
    const daysPlayed = Object.keys(s.daily).length;

    view.appendChild(el('h1', { class: 'page-title' }, ['My progress']));
    view.appendChild(el('p', { class: 'page-sub' }, ['Everything is saved on this device.']));

    view.appendChild(el('div', { class: 'stat-hero' }, [
      el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, ['🔥' + store.streak()]), el('div', { class: 'lbl' }, ['Day streak'])]),
      el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, [String(daysPlayed)]), el('div', { class: 'lbl' }, ['Days played'])]),
      el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, [String(totalPlays)]), el('div', { class: 'lbl' }, ['Games played'])])
    ]));

    // Skills
    const skills = el('div', { class: 'stats-section' }, [el('h3', {}, ['Math skills'])]);
    skills.appendChild(topicBars(MATH_TOPICS, 'math', s.topics));
    view.appendChild(skills);

    const rwSkills = el('div', { class: 'stats-section' }, [el('h3', {}, ['Reading & Writing skills'])]);
    rwSkills.appendChild(topicBars(RW_TOPICS, 'rw', s.topics));
    view.appendChild(rwSkills);

    // Vocab
    const vSec = el('div', { class: 'stats-section' }, [el('h3', {}, ['🟩 Vocab'])]);
    if (g.vocab.played === 0) {
      vSec.appendChild(el('p', { class: 'empty-note' }, ['Not played yet.']));
    } else {
      vSec.appendChild(el('p', { class: 'mini-stat-line' }, [
        'Played: ', el('b', {}, [String(g.vocab.played)]),
        ' · Win rate: ', el('b', {}, [Math.round((g.vocab.won / g.vocab.played) * 100) + '%'])
      ]));
      const maxDist = Math.max(1, ...g.vocab.dist);
      g.vocab.dist.forEach((n, i) => {
        vSec.appendChild(el('div', { class: 'dist-row' }, [
          el('span', { class: 'g' }, [String(i + 1)]),
          el('span', {
            class: 'dist-bar' + (n === maxDist && n > 0 ? ' hl' : ''),
            style: 'width:' + Math.max(8, (n / maxDist) * 70) + '%'
          }, [String(n)])
        ]));
      });
    }
    view.appendChild(vSec);

    // Connections
    const cSec = el('div', { class: 'stats-section' }, [el('h3', {}, ['🟪 Connections'])]);
    cSec.appendChild(g.conn.played === 0
      ? el('p', { class: 'empty-note' }, ['Not played yet.'])
      : el('p', { class: 'mini-stat-line' }, [
          'Played: ', el('b', {}, [String(g.conn.played)]),
          ' · Win rate: ', el('b', {}, [Math.round((g.conn.won / g.conn.played) * 100) + '%']),
          ' · Avg mistakes: ', el('b', {}, [(g.conn.mistakes / g.conn.played).toFixed(1)])
        ]));
    view.appendChild(cSec);

    // Mini
    const mSec = el('div', { class: 'stats-section' }, [el('h3', {}, ['🔵 The Mini'])]);
    if (g.mini.played === 0) {
      mSec.appendChild(el('p', { class: 'empty-note' }, ['Not played yet.']));
    } else {
      mSec.appendChild(el('p', { class: 'mini-stat-line' }, [
        'Quizzes: ', el('b', {}, [String(g.mini.played)]),
        ' · Accuracy: ', el('b', {}, [Math.round((g.mini.correct / g.mini.total) * 100) + '%']),
        g.mini.bestTime !== null ? ' · Best perfect time: ' : '',
        g.mini.bestTime !== null ? el('b', {}, [Math.floor(g.mini.bestTime / 60) + ':' + String(g.mini.bestTime % 60).padStart(2, '0')]) : ''
      ]));
    }
    view.appendChild(mSec);

    // Sprint
    const spSec = el('div', { class: 'stats-section' }, [el('h3', {}, ['⚡ Sprint'])]);
    spSec.appendChild(g.sprint.played === 0
      ? el('p', { class: 'empty-note' }, ['Not played yet.'])
      : el('p', { class: 'mini-stat-line' }, [
          'Runs: ', el('b', {}, [String(g.sprint.played)]),
          ' · Best: ', el('b', {}, [String(g.sprint.best)]),
          ' · Average: ', el('b', {}, [(g.sprint.totalScore / g.sprint.played).toFixed(1)])
        ]));
    view.appendChild(spSec);

    view.appendChild(el('div', { class: 'danger-zone' }, [
      el('button', {
        onclick: () => {
          const close = modal(el('div', {}, [
            el('h2', {}, ['Reset all progress?']),
            el('p', { class: 'sub' }, ['This clears your streak, stats, and today’s games on this device. It can’t be undone.']),
            el('div', { class: 'btn-row' }, [
              el('button', { class: 'btn', onclick: () => { store.reset(); close(); SAT.router.navigate('/'); } }, ['Yes, reset']),
              el('button', { class: 'btn secondary', onclick: () => close() }, ['Cancel'])
            ])
          ]));
        }
      }, ['Reset all progress'])
    ]));
  });
})();
