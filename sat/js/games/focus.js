// SAT Daily — Focus: the curriculum backbone. Each day one skill from the
// 30-day rotation is formally taught (lesson card) and drilled (4 questions).
// 120 days = 4 full passes over every tested SAT skill.
(function () {
  const { el, modal, share, dayIndex, shuffle } = SAT.util;
  const store = SAT.store;
  const curriculum = SAT.curriculum;
  const DRILL_LEN = 4;
  // Active quiz timer teardown — module level so the router can clean up even
  // after the picker re-renders the view outside the router.
  let activeTeardown = null;
  function cleanup() { if (activeTeardown) { activeTeardown(); activeTeardown = null; } }

  // A Test-Day Playbook lesson appears every 3rd day, cycling all 8 strategies
  // (~5 full passes across 120 days).
  function strategyForToday() {
    const di = dayIndex();
    if (di % 3 !== 0) return null;
    const list = window.SAT_STRATEGY || [];
    return list.length ? list[Math.floor(di / 3) % list.length] : null;
  }

  function strategyCard(lesson) {
    return el('div', { class: 'lesson-card strategy-card' }, [
      el('div', { class: 'lesson-eyebrow' }, ['Test-Day Playbook · bonus lesson']),
      el('h3', {}, [lesson.title]),
      el('ul', {}, lesson.points.map((p) => el('li', {}, [p]))),
      lesson.tip ? el('p', { class: 'lesson-tip' }, ['💡 ' + lesson.tip]) : null,
      el('p', { class: 'lesson-more' }, [
        el('a', { href: '#/playbook' }, ['See all 8 playbook lessons →'])
      ])
    ]);
  }

  function lessonCard(skillId) {
    const lesson = (window.SAT_LESSONS || {})[skillId];
    const SK = window.SAT_SKILLS;
    const domain = SK.domainOf(skillId);
    if (!lesson) return el('div');
    return el('div', { class: 'lesson-card' }, [
      el('div', { class: 'lesson-eyebrow' }, [(domain ? domain.name : '') + ' · ' + (domain && domain.section === 'math' ? 'Math' : 'Reading & Writing')]),
      el('h3', {}, [lesson.title]),
      el('ul', {}, lesson.points.map((p) => el('li', {}, [p]))),
      lesson.tip ? el('p', { class: 'lesson-tip' }, ['💡 ' + lesson.tip]) : null
    ]);
  }

  function render(view, practice, practiceSkill) {
    const day = SAT.util.todayStr(); // pin: a session crossing midnight stays on this day
    const skillId = practice ? practiceSkill : curriculum.focusSkill(0);
    const SK = window.SAT_SKILLS;

    // Practice mode with no skill chosen yet: show the skill picker.
    if (practice && !skillId) return renderPicker(view);

    const done = !practice && store.dailyRecord('drill', day);

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['Focus']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, [
      practice ? 'Deliberate practice on the skill you picked.' : 'Today’s skill on the 30-day syllabus. Read the card, then drill it.'
    ]));

    view.appendChild(lessonCard(skillId));

    if (!practice) {
      const strat = strategyForToday();
      if (strat) view.appendChild(strategyCard(strat));
    }

    const body = el('div');
    view.appendChild(body);

    if (done) {
      const bonus = SAT.dailyPlan ? SAT.dailyPlan.bonus() : null;
      const bonusOpen = bonus && !store.dailyRecord(bonus.key);
      body.appendChild(el('div', { class: 'sprint-splash' }, [
        el('div', { class: 'big-score' }, [done.correct + '/' + done.total]),
        el('p', { class: 'sub' }, ['Today’s drill: ' + SK.name(done.skill) + '. Back tomorrow for the next skill.']),
        el('div', { class: 'btn-row' }, [
          bonusOpen ? el('button', { class: 'btn', onclick: () => SAT.router.navigate(bonus.route) }, ['Next: ' + bonus.name + ' →']) : null,
          el('button', { class: 'btn' + (bonusOpen ? ' secondary' : ''), onclick: () => SAT.router.navigate('/focus/practice') }, ['Practice another skill']),
          el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
        ])
      ]));
      return;
    }

    const startRow = el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn',
        onclick: () => {
          startRow.remove();
          const questions = curriculum.questionsFor(skillId, DRILL_LEN, new Set());
          activeTeardown = SAT.quizEngine.run(body, shuffle(questions), {
            onDone(rec) {
              store.recordDrill(rec.correct, rec.total);
              if (!practice) store.completeDaily('drill', { correct: rec.correct, total: rec.total, skill: skillId }, day);
              showResult(rec, skillId, practice);
            }
          });
        }
      }, ['Start the drill →'])
    ]);
    body.appendChild(startRow);

    return cleanup;
  }

  function renderPicker(view) {
    const SK = window.SAT_SKILLS;
    view.appendChild(el('h1', { class: 'page-title' }, ['Pick a skill']));
    view.appendChild(el('p', { class: 'page-sub' }, ['Drill any skill on the syllabus. Your weakest are flagged.']));
    const weakest = new Set(curriculum.weakestSkills(5));
    SK.domains.forEach((d) => {
      const sec = el('div', { class: 'stats-section' }, [el('h3', {}, [d.name])]);
      d.skills.forEach((s) => {
        const m = store.mastery(s.id);
        sec.appendChild(el('button', {
          class: 'skill-pick',
          onclick: () => {
            const v = document.getElementById('view');
            v.innerHTML = '';
            render(v, true, s.id);
          }
        }, [
          el('span', {}, [s.name]),
          el('span', { class: 'mastery-chip m-' + m }, [weakest.has(s.id) ? 'weak spot' : m])
        ]));
      });
      view.appendChild(sec);
    });
  }

  function showResult(rec, skillId, practice) {
    const SK = window.SAT_SKILLS;
    const num = dayIndex() + 1;
    // Step 2 of the daily plan: offer the day's bonus game right here.
    const bonus = !practice && SAT.dailyPlan ? SAT.dailyPlan.bonus() : null;
    const bonusOpen = bonus && !store.dailyRecord(bonus.key);
    modal(el('div', {}, [
      el('h2', {}, [rec.correct === rec.total ? 'Skill sharpened!' : 'Progress made']),
      el('div', { class: 'big-score' }, [rec.correct + '/' + rec.total]),
      el('p', { class: 'sub' }, [SK.name(skillId) + ' — mastery: ' + store.mastery(skillId)]),
      el('div', { class: 'share-grid' }, [rec.marks.map((m) => (m ? '✅' : '❌')).join('')]),
      bonusOpen ? el('p', { class: 'sub' }, ['One more quick step and today is done:']) : null,
      el('div', { class: 'btn-row' }, [
        bonusOpen ? el('button', {
          class: 'btn',
          onclick: () => SAT.router.navigate(bonus.route)
        }, ['Continue: ' + bonus.name + ' →']) : null,
        practice ? null : el('button', {
          class: 'btn' + (bonusOpen ? ' secondary' : ''),
          onclick: () => share('SAT Daily Focus #' + num + ' — ' + SK.name(skillId), rec.marks.map((m) => (m ? '✅' : '❌')).join('') + ' 🎯')
        }, ['Share']),
        practice ? el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/focus/practice') }, ['Another skill']) : null,
        el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
      ])
    ]));
  }

  SAT.router.register('/focus', (view) => { render(view, false); return cleanup; });
  SAT.router.register('/focus/practice', (view) => { render(view, true, null); return cleanup; });
})();
