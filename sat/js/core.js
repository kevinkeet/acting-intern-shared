// SAT Daily — core: dates, seeded RNG, storage/progress, router, UI helpers.
(function () {
  const SAT = (window.SAT = window.SAT || {});

  // ---------- Dates & seeded randomness ----------
  const EPOCH = new Date(2026, 0, 1); // local midnight, Jan 1 2026 = day 0

  function todayStr(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function dayIndex(d) {
    d = d || new Date();
    const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((local - EPOCH) / 86400000);
  }

  // mulberry32 — small deterministic PRNG so everyone gets the same daily puzzle
  function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Storage / progress ----------
  const KEY = 'satDaily.v1';

  function blankStats() {
    return {
      streak: { count: 0, lastDay: null },
      daily: {}, // dateStr -> per-game results for that day
      games: {
        vocab: { played: 0, won: 0, dist: [0, 0, 0, 0, 0, 0] },
        conn: { played: 0, won: 0, mistakes: 0 },
        mini: { played: 0, correct: 0, total: 0, bestTime: null },
        sprint: { played: 0, best: 0, totalScore: 0 },
        editor: { played: 0, best: 0, totalScore: 0 },
        drill: { played: 0, correct: 0, total: 0 }
      },
      skills: {}, // skill id -> { t, c, recent: [0|1, ...] (last 12) }
      seenQ: [],  // hashes of served bank questions (avoid repeats)
      plan: { startDay: null } // dayIndex of first play; drives "Day N of 120"
    };
  }

  let state = blankStats();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = Object.assign(blankStats(), parsed);
      // Deep-merge one level so saves written before a field existed
      // (e.g. vocab.dist, sprint.totalScore) still get their defaults.
      const blankGames = blankStats().games;
      state.games = {};
      for (const k in blankGames) {
        state.games[k] = Object.assign(blankGames[k], (parsed.games || {})[k]);
      }
    }
  } catch (e) { /* corrupted or unavailable storage — start fresh */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
  }

  function touchStreak() {
    const today = todayStr();
    const s = state.streak;
    if (s.lastDay === today) return;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    s.count = s.lastDay === todayStr(y) ? s.count + 1 : 1;
    s.lastDay = today;
  }

  const store = {
    raw: () => state,

    // All daily read/writes accept an optional `day` (yyyy-mm-dd). Games
    // capture the day ONCE at render and pass it through, so a session that
    // crosses midnight saves under the day whose puzzle was actually played.
    dailyRecord(game, day) {
      const rec = state.daily[day || todayStr()];
      return rec ? rec[game] : undefined;
    },

    // Save a completed daily-game result (also feeds streak).
    completeDaily(game, result, day) {
      const t = day || todayStr();
      state.daily[t] = state.daily[t] || {};
      state.daily[t][game] = result;
      touchStreak();
      save();
    },

    // In-progress daily state (so a refresh doesn't lose the board).
    saveProgress(game, progress, day) {
      const t = day || todayStr();
      state.daily[t] = state.daily[t] || {};
      state.daily[t][game + '_wip'] = progress;
      save();
    },
    getProgress(game, day) {
      const rec = state.daily[day || todayStr()];
      return rec ? rec[game + '_wip'] : undefined;
    },

    recordVocab(won, guessCount) {
      const g = state.games.vocab;
      g.played++;
      if (won) { g.won++; g.dist[guessCount - 1]++; }
      save();
    },
    recordConn(won, mistakes) {
      const g = state.games.conn;
      g.played++;
      if (won) g.won++;
      g.mistakes += mistakes;
      save();
    },
    recordMini(correct, total, seconds) {
      const g = state.games.mini;
      g.played++;
      g.correct += correct;
      g.total += total;
      if (correct === total && (g.bestTime === null || seconds < g.bestTime)) g.bestTime = seconds;
      save();
    },
    recordSprint(score) {
      const g = state.games.sprint;
      g.played++;
      g.totalScore += score;
      if (score > g.best) g.best = score;
      save();
    },
    recordEditor(score) {
      const g = state.games.editor;
      g.played++;
      g.totalScore += score;
      if (score > g.best) g.best = score;
      save();
    },
    recordDrill(correct, total) {
      const g = state.games.drill;
      g.played++;
      g.correct += correct;
      g.total += total;
      save();
    },

    // ---- Skill mastery ----
    recordSkill(skillId, correct) {
      if (!skillId) return;
      const s = (state.skills[skillId] = state.skills[skillId] || { t: 0, c: 0, recent: [] });
      s.t++;
      if (correct) s.c++;
      s.recent.push(correct ? 1 : 0);
      if (s.recent.length > 12) s.recent.shift();
      save();
    },
    skill(skillId) {
      return state.skills[skillId] || { t: 0, c: 0, recent: [] };
    },
    recentAcc(skillId) {
      const s = this.skill(skillId);
      if (!s.recent.length) return 0;
      return s.recent.reduce((a, b) => a + b, 0) / s.recent.length;
    },
    mastery(skillId) {
      const s = this.skill(skillId);
      if (s.t === 0) return 'new';
      const acc = this.recentAcc(skillId);
      if (s.t >= 12 && acc >= 0.85) return 'mastered';
      if (s.t >= 6 && acc >= 0.7) return 'solid';
      return 'learning';
    },

    // ---- Served-question tracking (avoid repeats until pool exhausted) ----
    isSeen(hash) { return state.seenQ.indexOf(hash) !== -1; },
    markSeen(hash) {
      if (this.isSeen(hash)) return;
      state.seenQ.push(hash);
      if (state.seenQ.length > 500) state.seenQ.splice(0, state.seenQ.length - 500);
      save();
    },

    // ---- 120-day plan ----
    ensurePlanStart() {
      if (state.plan.startDay == null) { state.plan.startDay = dayIndex(); save(); }
    },
    planDay() {
      if (state.plan.startDay == null) return 1;
      return dayIndex() - state.plan.startDay + 1;
    },

    streak() {
      const s = state.streak;
      if (!s.lastDay) return 0;
      // A streak is "alive" if the last play was today or yesterday.
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return (s.lastDay === todayStr() || s.lastDay === todayStr(y)) ? s.count : 0;
    },

    reset() {
      state = blankStats();
      save();
    }
  };

  // ---------- Curriculum: daily focus + adaptive question selection ----------
  function qHash(str) { // djb2, for tracking served questions
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Stable identity for a bank question. R&W questions share standard stems
  // ("Which choice completes the text…"), so the passage must be included.
  function qKey(q) { return qHash((q.passage || '') + '|' + q.q); }

  const curriculum = {
    // The skill formally taught today (30-day rotation, defined in skills.js).
    focusSkill(offset) {
      const rot = window.SAT_SKILLS.rotation;
      const i = (((dayIndex() + (offset || 0)) % rot.length) + rot.length) % rot.length;
      return rot[i];
    },

    // Pick up to n questions for a skill, preferring never-served ones.
    // Falls back to same domain, then same section, so it always fills.
    questionsFor(skillId, n, exclude) {
      const bank = window.SAT_QUESTIONS || [];
      const SK = window.SAT_SKILLS;
      const ex = exclude || new Set();
      const pools = [
        bank.filter((q) => q.skill === skillId),
        bank.filter((q) => SK.domainOf(q.skill) === SK.domainOf(skillId)),
        bank.filter((q) => SK.sectionOf(q.skill) === SK.sectionOf(skillId))
      ];
      const picked = [];
      for (const pool of pools) {
        if (picked.length >= n) break;
        const fresh = shuffle(pool.filter((q) => !ex.has(qKey(q)) && !store.isSeen(qKey(q))));
        const rest = shuffle(pool.filter((q) => !ex.has(qKey(q))));
        for (const q of fresh.concat(rest)) {
          if (picked.length >= n) break;
          const h = qKey(q);
          if (ex.has(h)) continue;
          ex.add(h);
          picked.push(q);
        }
      }
      return picked;
    },

    // Skills the student is doing worst at (attempted, lowest recent accuracy).
    weakestSkills(n) {
      return window.SAT_SKILLS.all
        .filter((id) => store.skill(id).t > 0)
        .map((id) => ({ id, acc: store.recentAcc(id), t: store.skill(id).t }))
        .sort((a, b) => a.acc - b.acc || a.t - b.t)
        .slice(0, n)
        .map((s) => s.id);
    },

    unseenSkills() {
      return window.SAT_SKILLS.all.filter((id) => store.skill(id).t === 0);
    }
  };

  // ---------- UI helpers ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function toast(msg, ms) {
    const root = document.getElementById('toast-root');
    const t = el('div', { class: 'toast' }, [msg]);
    root.appendChild(t);
    setTimeout(() => t.remove(), ms || 1800);
  }

  function modal(contentNode, opts) {
    opts = opts || {};
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const box = el('div', { class: 'modal' }, [
      el('button', { class: 'modal-close', 'aria-label': 'Close', onclick: close }, ['×']),
      contentNode
    ]);
    const scrim = el('div', { class: 'modal-scrim' }, [box]);
    // Scrim-click closes, but not in the first 350ms and only if the press
    // started on the scrim — the second click of a double-clicked "Finish"
    // button must not dismiss the freshly opened results modal.
    const openedAt = Date.now();
    let downOnScrim = false;
    scrim.addEventListener('mousedown', (e) => { downOnScrim = e.target === scrim; });
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim && downOnScrim && Date.now() - openedAt > 350) close();
    });
    function close() {
      root.innerHTML = '';
      if (opts.onClose) opts.onClose();
    }
    root.appendChild(scrim);
    return close;
  }

  function share(title, text) {
    const payload = title + '\n' + text + '\n' + location.origin + location.pathname;
    if (navigator.share) {
      navigator.share({ text: payload }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload).then(
        () => toast('Copied results to clipboard'),
        () => toast('Could not copy — select and copy manually')
      );
    } else {
      toast('Sharing not supported on this browser');
    }
  }

  // ---------- Router ----------
  const routes = {};
  let teardown = null;

  function register(path, renderFn) { routes[path] = renderFn; }

  function navigate(path) {
    // Re-render even when the hash doesn't change (e.g. "practice another").
    if (location.hash === '#' + path) render();
    else location.hash = '#' + path;
  }

  function render() {
    if (teardown) { try { teardown(); } catch (e) {} teardown = null; }
    document.getElementById('modal-root').innerHTML = '';
    const path = (location.hash || '#/').slice(1) || '/';
    const fn = routes[path] || routes['/'];
    const view = document.getElementById('view');
    view.innerHTML = '';
    window.scrollTo(0, 0);
    // A route render may return a cleanup function (timers, key listeners).
    teardown = fn(view) || null;
  }

  window.addEventListener('hashchange', render);
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-home').addEventListener('click', () => navigate('/'));
    document.getElementById('btn-stats').addEventListener('click', () => navigate('/stats'));
    render();
  });

  SAT.util = { todayStr, dayIndex, seededRng, shuffle, el, toast, modal, share, qHash, qKey };
  SAT.store = store;
  SAT.curriculum = curriculum;
  SAT.router = { register, navigate };
})();
