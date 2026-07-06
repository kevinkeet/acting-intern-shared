// SAT Daily — home + progress pages.
(function () {
  const { el, dayIndex, modal } = SAT.util;
  const store = SAT.store;

  const GAMES = [
    { key: 'drill', route: '/focus', cls: 'mini', icon: '🎯', name: 'Focus',
      desc: 'Today’s skill on the 30-day syllabus: learn the card, drill 4 questions.',
      result: (r) => (window.SAT_SKILLS ? window.SAT_SKILLS.name(r.skill) : '') + ' — ' + r.correct + '/' + r.total },
    { key: 'mini', route: '/mini', cls: 'mini', icon: '🔵', name: 'The Mini',
      desc: '5 SAT questions picked for you: focus, weak spots, something new.',
      result: (r) => r.correct + '/' + r.total + ' in ' + Math.floor(r.seconds / 60) + ':' + String(r.seconds % 60).padStart(2, '0') },
    { key: 'vocab', route: '/vocab', cls: 'vocab', icon: '🟩', name: 'Vocab',
      desc: 'Guess the SAT word from its definition. Wordle rules, test-day payoff.',
      result: (r) => (r.won ? 'Solved in ' + r.guesses.length + '/6' : 'Revealed — see the word') },
    { key: 'editor', route: '/editor', cls: 'sprint', icon: '✏️', name: 'The Editor',
      desc: '90 seconds of grammar fixes — punctuation, agreement, usage.',
      result: (r) => r.score + ' fixed in 90s' },
    { key: 'conn', route: '/connections', cls: 'conn', icon: '🟪', name: 'Connections',
      desc: 'Sort 16 terms into 4 groups — math and reading mixed together.',
      result: (r) => (r.won ? 'Solved with ' + r.mistakes + ' mistake' + (r.mistakes === 1 ? '' : 's') : 'Out of guesses') },
    { key: 'sprint', route: '/sprint', cls: 'sprint', icon: '⚡', name: 'Sprint',
      desc: '60 seconds of mental math. No calculator, no mercy.',
      result: (r) => r.score + ' correct in 60s' }
  ];

  // ---------- Home ----------
  SAT.router.register('/', (view) => {
    store.ensurePlanStart();
    const SK = window.SAT_SKILLS;
    const now = new Date();
    const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const streak = store.streak();
    const doneCount = GAMES.filter((g) => store.dailyRecord(g.key)).length;
    const focusId = SAT.curriculum.focusSkill(0);
    const focusDomain = SK.domainOf(focusId);
    const planDay = store.planDay();

    view.appendChild(el('p', { class: 'home-date' }, [dateLabel + ' · Puzzle #' + (dayIndex() + 1)]));
    view.appendChild(el('h1', { class: 'home-greeting' }, [
      doneCount === GAMES.length ? 'All done for today! 🎉' : 'Today’s games'
    ]));
    view.appendChild(el('div', { class: 'streak-chip' }, [
      '🔥 ' + streak + '-day streak',
      ' · Day ' + Math.min(planDay, 120) + ' of 120',
      doneCount > 0 ? ' · ' + doneCount + '/' + GAMES.length + ' played' : ''
    ]));

    view.appendChild(el('button', { class: 'focus-banner', onclick: () => SAT.router.navigate('/focus') }, [
      el('span', { class: 'focus-banner-label' }, ['Today’s focus']),
      el('span', { class: 'focus-banner-skill' }, [SK.name(focusId)]),
      el('span', { class: 'focus-banner-domain' }, [(focusDomain ? focusDomain.name : '') + ' · ' + coverageSummary()])
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
      el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/stats') }, ['📊 My syllabus & progress'])
    ]));
  });

  function coverageSummary() {
    const SK = window.SAT_SKILLS;
    const solid = SK.all.filter((id) => ['solid', 'mastered'].indexOf(store.mastery(id)) !== -1).length;
    return solid + '/' + SK.all.length + ' skills solid';
  }

  // ---------- Progress / syllabus ----------
  const MASTERY_LABEL = { new: 'not started', learning: 'learning', solid: 'solid', mastered: 'mastered' };

  SAT.router.register('/stats', (view) => {
    const SK = window.SAT_SKILLS;
    const s = store.raw();
    const g = s.games;
    const totalPlays = g.vocab.played + g.conn.played + g.mini.played + g.sprint.played + g.editor.played + g.drill.played;
    const mastered = SK.all.filter((id) => store.mastery(id) === 'mastered').length;
    const solid = SK.all.filter((id) => store.mastery(id) === 'solid').length;

    view.appendChild(el('h1', { class: 'page-title' }, ['My syllabus']));
    view.appendChild(el('p', { class: 'page-sub' }, ['Every skill the Digital SAT tests, and where you stand. Goal: all 30 mastered.']));

    view.appendChild(el('div', { class: 'stat-hero' }, [
      el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, ['🔥' + store.streak()]), el('div', { class: 'lbl' }, ['Day streak'])]),
      el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, ['Day ' + Math.min(store.planDay(), 120)]), el('div', { class: 'lbl' }, ['of 120-day plan'])]),
      el('div', { class: 'stat-box' }, [el('div', { class: 'num' }, [mastered + '/' + SK.all.length]), el('div', { class: 'lbl' }, ['Skills mastered'])])
    ]));

    // coverage progress bar
    const pctSolid = Math.round(((mastered + solid) / SK.all.length) * 100);
    view.appendChild(el('div', { class: 'stats-section' }, [
      el('div', { class: 'bar-row' }, [
        el('span', { class: 'bar-label' }, ['Coverage']),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill math', style: 'width:' + pctSolid + '%' })]),
        el('span', { class: 'bar-val' }, [pctSolid + '%'])
      ]),
      el('p', { class: 'empty-note' }, ['Skills at “solid” or better. Play Focus daily — it walks the whole syllabus every 30 days.'])
    ]));

    ['math', 'rw'].forEach((section) => {
      view.appendChild(el('h2', { class: 'section-title' }, [section === 'math' ? 'Math' : 'Reading & Writing']));
      SK.domains.filter((d) => d.section === section).forEach((d) => {
        const sec = el('div', { class: 'stats-section' }, [
          el('h3', {}, [d.name + ' ', el('span', { class: 'domain-weight' }, ['~' + d.weight + '% of section'])])
        ]);
        d.skills.forEach((sk) => {
          const st = store.skill(sk.id);
          const m = store.mastery(sk.id);
          const acc = Math.round(store.recentAcc(sk.id) * 100);
          sec.appendChild(el('div', { class: 'skill-row' }, [
            el('span', { class: 'skill-name' }, [sk.name]),
            el('div', { class: 'bar-track skill-bar' }, [
              el('div', { class: 'bar-fill ' + (section === 'math' ? 'math' : 'rw'), style: 'width:' + (st.t ? acc : 0) + '%' })
            ]),
            el('span', { class: 'mastery-chip m-' + m }, [MASTERY_LABEL[m]]),
            el('span', { class: 'skill-count' }, [st.t ? acc + '% · ' + st.t + ' tried' : '—'])
          ]));
        });
        view.appendChild(sec);
      });
    });

    // Game stats, condensed
    const gsec = el('div', { class: 'stats-section' }, [el('h3', {}, ['Games'])]);
    const lines = [];
    if (g.drill.played) lines.push('🎯 Focus: ' + g.drill.played + ' drills, ' + Math.round((g.drill.correct / Math.max(g.drill.total, 1)) * 100) + '% correct');
    if (g.mini.played) lines.push('🔵 Mini: ' + g.mini.played + ' quizzes, ' + Math.round((g.mini.correct / Math.max(g.mini.total, 1)) * 100) + '% accuracy' + (g.mini.bestTime !== null ? ', best perfect ' + SAT.quizEngine.fmtTime(g.mini.bestTime) : ''));
    if (g.vocab.played) lines.push('🟩 Vocab: ' + g.vocab.played + ' played, ' + Math.round((g.vocab.won / g.vocab.played) * 100) + '% solved');
    if (g.editor.played) lines.push('✏️ Editor: best ' + g.editor.best + ' fixes, avg ' + (g.editor.totalScore / g.editor.played).toFixed(1));
    if (g.conn.played) lines.push('🟪 Connections: ' + g.conn.played + ' played, ' + Math.round((g.conn.won / g.conn.played) * 100) + '% solved');
    if (g.sprint.played) lines.push('⚡ Sprint: best ' + g.sprint.best + ', avg ' + (g.sprint.totalScore / g.sprint.played).toFixed(1));
    if (!lines.length) gsec.appendChild(el('p', { class: 'empty-note' }, ['No games played yet — start with today’s Focus.']));
    lines.forEach((l) => gsec.appendChild(el('p', { class: 'mini-stat-line' }, [l])));
    view.appendChild(gsec);

    view.appendChild(el('div', { class: 'stats-section' }, [
      el('h3', {}, ['The last mile']),
      el('p', { class: 'mini-stat-line' }, ['This app is your daily engine. In months 2–4, also take full-length timed practice tests in College Board’s Bluebook app — pacing under real conditions is the one skill games can’t teach.'])
    ]));

    view.appendChild(el('div', { class: 'danger-zone' }, [
      el('button', {
        onclick: () => {
          const close = modal(el('div', {}, [
            el('h2', {}, ['Reset all progress?']),
            el('p', { class: 'sub' }, ['This clears your streak, mastery, and today’s games on this device. It can’t be undone.']),
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
