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
      daily: {}, // dateStr -> { vocab:{...}, conn:{...}, mini:{...}, sprint:{...} }
      games: {
        vocab: { played: 0, won: 0, dist: [0, 0, 0, 0, 0, 0] },
        conn: { played: 0, won: 0, mistakes: 0 },
        mini: { played: 0, correct: 0, total: 0, bestTime: null },
        sprint: { played: 0, best: 0, totalScore: 0 }
      },
      topics: {} // topic -> { c, t }
    };
  }

  let state = blankStats();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = Object.assign(blankStats(), parsed);
      state.games = Object.assign(blankStats().games, parsed.games || {});
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

    dailyRecord(game) {
      const day = state.daily[todayStr()];
      return day ? day[game] : undefined;
    },

    // Save today's completed result for a daily game (also feeds streak).
    completeDaily(game, result) {
      const t = todayStr();
      state.daily[t] = state.daily[t] || {};
      state.daily[t][game] = result;
      touchStreak();
      save();
    },

    // In-progress daily state (so a refresh doesn't lose the board).
    saveProgress(game, progress) {
      const t = todayStr();
      state.daily[t] = state.daily[t] || {};
      state.daily[t][game + '_wip'] = progress;
      save();
    },
    getProgress(game) {
      const day = state.daily[todayStr()];
      return day ? day[game + '_wip'] : undefined;
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
    recordTopic(topic, correct) {
      const t = (state.topics[topic] = state.topics[topic] || { c: 0, t: 0 });
      t.t++;
      if (correct) t.c++;
      save();
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
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
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

  SAT.util = { todayStr, dayIndex, seededRng, shuffle, el, toast, modal, share };
  SAT.store = store;
  SAT.router = { register, navigate };
})();
