// SAT Daily — The Mini: 5 timed SAT questions, adaptively selected.
// Slots: today's focus skill, 2 weakest skills, an unseen skill, yesterday's
// focus (spaced repetition) — balanced so both sections always appear.
(function () {
  const { el, modal, share, dayIndex, shuffle } = SAT.util;
  const store = SAT.store;
  const curriculum = SAT.curriculum;
  const QUIZ_LEN = 5;

  function pickSkillSlots() {
    const SK = window.SAT_SKILLS;
    const slots = [];
    const used = new Set();
    function add(id) {
      if (id && !used.has(id) && slots.length < QUIZ_LEN) { used.add(id); slots.push(id); }
    }

    add(curriculum.focusSkill(0));
    curriculum.weakestSkills(4).forEach((id) => { if (slots.length < 3) add(id); });
    shuffle(curriculum.unseenSkills()).forEach((id) => { if (slots.length < 4) add(id); });
    add(curriculum.focusSkill(-1));
    // top up with random skills, weighted implicitly by taking from the full list
    shuffle(SK.all).forEach((id) => add(id));

    // Balance: ensure at least 2 math and 2 R&W among the 5.
    const bySection = (sec) => slots.filter((id) => SK.sectionOf(id) === sec);
    ['math', 'rw'].forEach((sec) => {
      while (bySection(sec).length < 2) {
        const other = sec === 'math' ? 'rw' : 'math';
        const overIdx = slots.lastIndexOf(bySection(other)[bySection(other).length - 1]);
        const candidates = shuffle(SK.all.filter((id) => SK.sectionOf(id) === sec && !used.has(id)));
        if (!candidates.length) break;
        used.add(candidates[0]);
        slots[overIdx] = candidates[0];
      }
    });
    return slots;
  }

  function pickQuestions() {
    const exclude = new Set();
    const questions = [];
    pickSkillSlots().forEach((skillId) => {
      curriculum.questionsFor(skillId, 1, exclude).forEach((q) => questions.push(q));
    });
    // Safety net: fill from anywhere if a slot came back empty.
    while (questions.length < QUIZ_LEN) {
      const q = shuffle(window.SAT_QUESTIONS.filter((x) => !exclude.has(SAT.util.qKey(x))))[0];
      if (!q) break;
      exclude.add(SAT.util.qKey(q));
      questions.push(q);
    }
    return shuffle(questions);
  }

  function render(view, practice) {
    const done = !practice && store.dailyRecord('mini');
    if (done) {
      renderDone(view, done);
      return;
    }

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['The Mini']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, ['5 SAT questions picked for you: today’s focus, your weak spots, and something new.']));

    const body = el('div');
    view.appendChild(body);

    const teardown = SAT.quizEngine.run(body, pickQuestions(), {
      onDone(rec) {
        store.recordMini(rec.correct, rec.total, rec.seconds);
        if (!practice) store.completeDaily('mini', rec);
        showResult(rec, practice);
      }
    });
    return teardown;
  }

  function shareText(rec) {
    return rec.marks.map((m) => (m ? '✅' : '❌')).join('') + '  ⏱ ' + SAT.quizEngine.fmtTime(rec.seconds);
  }

  function showResult(rec, practice) {
    const num = dayIndex() + 1;
    const perfect = rec.correct === rec.total;
    modal(el('div', {}, [
      el('h2', {}, [perfect ? 'Perfect Mini!' : rec.correct >= 3 ? 'Nice work!' : 'Keep at it!']),
      el('div', { class: 'big-score' }, [rec.correct + '/' + rec.total]),
      el('p', { class: 'sub' }, ['Time: ' + SAT.quizEngine.fmtTime(rec.seconds)]),
      el('div', { class: 'share-grid' }, [rec.marks.map((m) => (m ? '✅' : '❌')).join('')]),
      el('div', { class: 'btn-row' }, [
        practice ? null : el('button', {
          class: 'btn', onclick: () => share('SAT Daily Mini #' + num + ' — ' + rec.correct + '/' + rec.total, shareText(rec))
        }, ['Share']),
        el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/mini/practice') }, ['Practice 5 more']),
        el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/') }, ['Home'])
      ])
    ]));
  }

  function renderDone(view, rec) {
    view.appendChild(el('h1', { class: 'page-title' }, ['The Mini']));
    view.appendChild(el('p', { class: 'page-sub' }, ['You already finished today’s Mini. Come back tomorrow — or keep practicing.']));
    view.appendChild(el('div', { class: 'sprint-splash' }, [
      el('div', { class: 'big-score' }, [rec.correct + '/' + rec.total]),
      el('p', { class: 'sub' }, ['Time: ' + SAT.quizEngine.fmtTime(rec.seconds)]),
      el('div', { class: 'share-grid' }, [rec.marks.map((m) => (m ? '✅' : '❌')).join('')]),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn', onclick: () => share('SAT Daily Mini #' + (dayIndex() + 1) + ' — ' + rec.correct + '/' + rec.total, shareText(rec)) }, ['Share']),
        el('button', { class: 'btn secondary', onclick: () => SAT.router.navigate('/mini/practice') }, ['Practice']),
      ])
    ]));
  }

  SAT.router.register('/mini', (view) => render(view, false));
  SAT.router.register('/mini/practice', (view) => render(view, true));
})();
