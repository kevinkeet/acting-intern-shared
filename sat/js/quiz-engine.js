// SAT Daily — shared one-question-at-a-time quiz runner (used by The Mini and Focus).
// Renders question -> choices -> feedback + explanation -> next, records skill
// mastery per answer, and reports {correct, total, seconds, marks} when done.
(function () {
  const { el } = SAT.util;
  const store = SAT.store;

  function fmtTime(s) {
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // opts: { onDone(result), markSeen: bool }
  // Returns a teardown function (clears the timer).
  function run(container, questions, opts) {
    opts = opts || {};
    const total = questions.length;
    let idx = 0;
    let marks = [];
    let answered = false;
    let finished = false;
    const startAt = Date.now();
    let seconds = 0;

    const meta = el('div', { class: 'quiz-meta' });
    const dots = el('div', { class: 'progress-dots' });
    const timerEl = el('span', { class: 'quiz-timer' }, ['0:00']);
    meta.appendChild(dots);
    meta.appendChild(timerEl);
    const qWrap = el('div');
    container.appendChild(meta);
    container.appendChild(qWrap);

    const timer = setInterval(() => {
      if (finished) return;
      seconds = Math.floor((Date.now() - startAt) / 1000);
      timerEl.textContent = fmtTime(seconds);
    }, 250);

    function drawDots() {
      dots.innerHTML = '';
      for (let i = 0; i < total; i++) {
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
      const skillName = window.SAT_SKILLS ? window.SAT_SKILLS.name(q.skill) : q.skill;
      qWrap.appendChild(el('span', { class: 'topic-chip' }, [skillName]));
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
        store.recordSkill(q.skill, correct);
        if (opts.markSeen !== false) store.markSeen(SAT.util.qKey(q));
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
          el('button', { class: 'btn', onclick: next }, [idx === total - 1 ? 'Finish' : 'Next'])
        ]));
      }
    }

    function next() {
      idx++;
      if (idx < total) { drawQuestion(); return; }
      finished = true;
      clearInterval(timer);
      seconds = Math.floor((Date.now() - startAt) / 1000);
      const correct = marks.filter(Boolean).length;
      if (opts.onDone) opts.onDone({ correct, total, seconds, marks });
    }

    drawQuestion();
    return () => clearInterval(timer);
  }

  SAT.quizEngine = { run, fmtTime };
})();
