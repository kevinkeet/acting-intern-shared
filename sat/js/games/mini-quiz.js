// SAT Daily — The Mini: 5 timed SAT questions (3 math + 2 reading/writing, or 2 + 3).
(function () {
  const { el, modal, share, dayIndex, seededRng, shuffle } = SAT.util;
  const store = SAT.store;
  const BANK = window.SAT_QUESTIONS;
  const QUIZ_LEN = 5;

  const TOPIC_LABELS = {
    algebra: 'Algebra', geometry: 'Geometry', data: 'Data & Stats', advanced: 'Advanced Math',
    grammar: 'Grammar', vocabulary: 'Words in Context', reading: 'Reading'
  };

  function pickQuestions(practice) {
    const math = BANK.filter((q) => q.section === 'math');
    const rw = BANK.filter((q) => q.section === 'rw');
    if (practice) {
      const m = shuffle(math).slice(0, 3);
      const r = shuffle(rw).slice(0, 2);
      return shuffle(m.concat(r));
    }
    const di = dayIndex();
    const rng = seededRng(di * 104729 + 7);
    const mathCount = di % 2 === 0 ? 3 : 2;
    const m = shuffle(math, rng).slice(0, mathCount);
    const r = shuffle(rw, rng).slice(0, QUIZ_LEN - mathCount);
    return shuffle(m.concat(r), rng);
  }

  function fmtTime(s) {
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function render(view, practice) {
    const done = !practice && store.dailyRecord('mini');
    if (done) {
      renderDone(view, done);
      return;
    }

    const questions = pickQuestions(practice);
    let idx = 0;
    let marks = [];       // true/false per question
    let answered = false;
    let startAt = Date.now();
    let seconds = 0;
    let finished = false;

    view.appendChild(el('div', { class: 'game-head' }, [
      el('h1', { class: 'page-title' }, ['The Mini']),
      practice ? el('span', { class: 'practice-tag' }, ['Practice']) : null
    ]));
    view.appendChild(el('p', { class: 'page-sub' }, [QUIZ_LEN + ' quick SAT questions. Beat the clock — accuracy first.']));

    const meta = el('div', { class: 'quiz-meta' });
    const qWrap = el('div');
    view.appendChild(meta);
    view.appendChild(qWrap);

    const timerEl = el('span', { class: 'quiz-timer' }, ['0:00']);
    const dots = el('div', { class: 'progress-dots' });
    meta.appendChild(dots);
    meta.appendChild(timerEl);

    const timer = setInterval(() => {
      if (finished) return;
      seconds = Math.floor((Date.now() - startAt) / 1000);
      timerEl.textContent = fmtTime(seconds);
    }, 250);

    function drawDots() {
      dots.innerHTML = '';
      for (let i = 0; i < QUIZ_LEN; i++) {
        let cls = 'pdot';
        if (i < marks.length) cls += marks[i] ? ' right' : ' miss';
        else if (i === idx) cls += ' cur';
        dots.appendChild(el('span', { class: cls }));
      }
    }

    function drawQuestion() {
      answered = false;
      drawDots();
      qWrap.innerHTML = '';
      const q = questions[idx];
      qWrap.appendChild(el('span', { class: 'topic-chip' }, [TOPIC_LABELS[q.topic] || q.topic]));
      if (q.passage) qWrap.appendChild(el('p', { class: 'q-passage' }, [q.passage]));
      qWrap.appendChild(el('p', { class: 'q-text' }, [q.q]));

      const choices = el('div', { class: 'choices' });
      const letters = ['A', 'B', 'C', 'D'];
      q.c.forEach((choiceText, ci) => {
        choices.appendChild(el('button', {
          class: 'choice',
          onclick: () => answer(ci)
        }, [el('span', { class: 'letter' }, [letters[ci]]), choiceText]));
      });
      qWrap.appendChild(choices);

      function answer(ci) {
        if (answered) return;
        answered = true;
        const correct = ci === q.a;
        marks.push(correct);
        store.recordTopic(q.topic, correct);
        drawDots();

        choices.querySelectorAll('.choice').forEach((btn, bi) => {
          btn.disabled = true;
          if (bi === q.a) btn.classList.add('correct');
          else if (bi === ci) btn.classList.add('wrong');
        });

        qWrap.appendChild(el('div', { class: 'explain' }, [
          el('b', { class: correct ? 'good' : 'bad' }, [correct ? 'Correct. ' : 'Not quite. ']),
          q.exp
        ]));
        qWrap.appendChild(el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn', onclick: next }, [idx === QUIZ_LEN - 1 ? 'Finish' : 'Next'])
        ]));
      }
    }

    function next() {
      idx++;
      if (idx < QUIZ_LEN) { drawQuestion(); return; }
      finished = true;
      clearInterval(timer);
      seconds = Math.floor((Date.now() - startAt) / 1000);
      const correct = marks.filter(Boolean).length;
      store.recordMini(correct, QUIZ_LEN, seconds);
      if (!practice) store.completeDaily('mini', { correct, total: QUIZ_LEN, seconds, marks });
      showResult({ correct, total: QUIZ_LEN, seconds, marks }, practice);
    }

    drawQuestion();
    return () => clearInterval(timer);
  }

  function shareText(rec) {
    return rec.marks.map((m) => (m ? '✅' : '❌')).join('') + '  ⏱ ' + fmtTime(rec.seconds);
  }

  function showResult(rec, practice) {
    const num = dayIndex() + 1;
    const perfect = rec.correct === rec.total;
    modal(el('div', {}, [
      el('h2', {}, [perfect ? 'Perfect Mini!' : rec.correct >= 3 ? 'Nice work!' : 'Keep at it!']),
      el('div', { class: 'big-score' }, [rec.correct + '/' + rec.total]),
      el('p', { class: 'sub' }, ['Time: ' + fmtTime(rec.seconds)]),
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
      el('p', { class: 'sub' }, ['Time: ' + fmtTime(rec.seconds)]),
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
