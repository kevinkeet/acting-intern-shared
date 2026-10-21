/**
 * Live Coworker: speaking out loud (the "Read answers and alerts aloud" setting).
 *
 * Two engines: Deepgram's natural Aura voices through the server's /api/tts
 * (the key stays on the server), or the browser's own speech synthesis
 * (on-device, free; also the fallback if the server can't speak). It:
 *   - cleans text for the ear: no markdown, dates and shorthand said in words
 *     ("9/2023" -> "September 2023", "K 5.1" -> "potassium 5.1");
 *   - speaks one sentence at a time (Chrome cuts long utterances off);
 *   - lets a safety alert cut in ahead of an answer;
 *   - picks a natural English voice unless one is chosen in settings.
 * The room mic hears it too. isEcho(heard) tells the app whether a transcript is
 * the coworker's own voice (drop it) or someone talking over it (stop, keep it).
 * Runs in the browser; the text helpers also run in Node for tests.
 */
(function (root) {
    'use strict';

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = (m) => MONTHS[Number(m) - 1] || m;
    // Shorthand a speech engine reads badly, said the way a colleague would.
    const SAY = [
        [/\*\*|__|`/g, ''],
        [/^\s*(?:[-*•]|\d+[.)])\s+/gm, ''],
        [/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m0, mo, d, y) => month(mo) + ' ' + Number(d) + ', ' + y],
        [/\b(\d{1,2})\/(\d{4})\b/g, (m0, mo, y) => month(mo) + ' ' + y],
        [/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/g, (m0, mo, d) => (Number(mo) <= 12 && Number(d) <= 31 ? month(mo) + ' ' + Number(d) : m0)],
        [/\bK\s+(?=\d)/g, 'potassium '],
        [/\bCr\s+(?=\d)/g, 'creatinine '],
        [/\bHgb\b/g, 'hemoglobin'],
        [/\bEF\b/g, 'ejection fraction'],
        [/\bAF\b|\bAFib\b/g, 'A-fib'],
        [/\bCHA2DS2-VASc\b/gi, 'chads-vasc'],
        [/\bHFrEF\b/g, 'heart failure with reduced ejection fraction'],
        [/\bCKD\b/g, 'C K D'],
        [/\bMDT\b/g, 'team'],
        [/\bPO\b/g, 'by mouth'],
        [/\bBID\b/gi, 'twice a day'],
        [/\bq(\d+)h\b/g, 'every $1 hours'],
        [/(\d)\s*-\s*(\d)/g, '$1 to $2'],
        [/~/g, 'about '],
        [/≥/g, 'at least '],
        [/≤/g, 'at most '],
        [/→/g, ' to '],
        [/\s+/g, ' '],
    ];

    /** Text as it should be heard. */
    function speakable(text) {
        let s = String(text || '');
        for (const [re, to] of SAY) s = s.replace(re, to);
        return s.trim();
    }

    /** Sentence-sized pieces, short ones joined, each under ~220 characters. */
    function pieces(text) {
        const sentences = String(text || '').split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/);
        const out = [];
        for (const s of sentences) {
            const t = s.trim();
            if (!t) continue;
            if (out.length && out[out.length - 1].length + t.length < 120) out[out.length - 1] += ' ' + t;
            else if (t.length <= 220) out.push(t);
            else out.push(...t.split(/(?<=[,;:])\s+/).reduce((acc, c) => { if (acc.length && acc[acc.length - 1].length + c.length < 200) acc[acc.length - 1] += ' ' + c; else acc.push(c); return acc; }, []));
        }
        return out;
    }

    /** For the Deepgram voice: one sentence per request so the first is heard quickly; tiny ones ("Safety.") ride with the next. */
    function sentencePieces(text) {
        const out = [];
        let carry = '';
        for (const s of String(text || '').split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)) {
            const t = (carry + ' ' + s).trim();
            if (t.length < 30) { carry = t; continue; }
            carry = '';
            if (t.length <= 400) out.push(t); else out.push(...pieces(t));
        }
        if (carry) { if (out.length) out[out.length - 1] += ' ' + carry; else out.push(carry); }
        return out;
    }

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);

    /**
     * Is this transcript the coworker's own voice coming back through the mic?
     * Most of its words appear in what was just spoken -> echo. Otherwise someone
     * is talking over it.
     */
    function isEchoOf(heard, spoken) {
        const words = norm(heard);
        if (!words.length) return true;
        const said = new Set(norm(spoken));
        const hits = words.filter((w) => said.has(w)).length;
        return hits / words.length >= 0.6;
    }

    // Natural voices first; novelty voices never.
    const NOVELTY = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|junior|ralph|fred|kathy|princess|hysterical|deranged|pipe organ|grandpa|grandma|eddy|flo|reed|rocko|sandy|shelley/i;
    const GOOD = ['Ava', 'Zoe', 'Allison', 'Samantha', 'Evan', 'Nathan', 'Tom', 'Susan', 'Karen', 'Daniel', 'Serena', 'Moira', 'Aria', 'Jenny', 'Guy', 'Google US English', 'Google UK English Female'];
    function rankVoice(v) {
        if (!/^en/i.test(v.lang || '') || NOVELTY.test(v.name)) return -1;
        let score = /^en[-_]US/i.test(v.lang) ? 20 : 10;
        if (/premium/i.test(v.name)) score += 40;
        if (/enhanced|natural|neural|online/i.test(v.name)) score += 30;
        const g = GOOD.findIndex((n) => v.name.indexOf(n) === 0);
        if (g >= 0) score += 25 - g;
        if (v.localService) score += 2;
        return score;
    }

    // Deepgram Aura-2 voices offered in settings (the server allows exactly these).
    const DG_VOICES = [
        { id: 'aura-2-athena-en', name: 'Athena', note: 'calm, professional' },
        { id: 'aura-2-asteria-en', name: 'Asteria', note: 'clear, confident' },
        { id: 'aura-2-thalia-en', name: 'Thalia', note: 'clear, energetic' },
        { id: 'aura-2-harmonia-en', name: 'Harmonia', note: 'empathetic, calm' },
        { id: 'aura-2-odysseus-en', name: 'Odysseus', note: 'calm, professional' },
        { id: 'aura-2-orpheus-en', name: 'Orpheus', note: 'professional, clear' },
        { id: 'aura-2-arcas-en', name: 'Arcas', note: 'natural, smooth' },
        { id: 'aura-2-draco-en', name: 'Draco', note: 'British, warm' },
        { id: 'aura-2-pandora-en', name: 'Pandora', note: 'British, calm' },
    ];

    const LiveVoice = {
        speaking: false,
        engine: 'browser',       // 'deepgram' (natural, via /api/tts) or 'browser'
        dgVoice: 'aura-2-athena-en',
        endpoint: '/api/tts',
        dgDown: false,           // the server could not speak: the browser voice takes over
        voiceName: null,
        onError: null,           // (reason) => {} e.g. 'not-allowed' before any click on the page
        _queue: [],
        _spoken: [],             // [{ text, at }] recent speech, for echo checks
        _endedAt: 0,
        _keepAlive: null,

        _browserOk() { return typeof window !== 'undefined' && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function'; },
        _deepgramOk() { return typeof window !== 'undefined' && typeof window.Audio === 'function' && typeof fetch === 'function' && !this.dgDown; },
        supported() { return this._browserOk() || (typeof window !== 'undefined' && typeof window.Audio === 'function'); },

        /** English voices, best first: [{ name, lang }]. Empty until the browser has loaded them. */
        voices() {
            if (!this._browserOk()) return [];
            return window.speechSynthesis.getVoices().map((v) => ({ v, r: rankVoice(v) })).filter((x) => x.r >= 0)
                .sort((a, b) => b.r - a.r).map((x) => ({ name: x.v.name, lang: x.v.lang }));
        },

        _voice() {
            const all = this._browserOk() ? window.speechSynthesis.getVoices() : [];
            return (this.voiceName && all.find((v) => v.name === this.voiceName)) || all.find((v) => v.name === (this.voices()[0] || {}).name) || null;
        },

        /** Say something. urgent (a safety alert): stop what is playing and go first. */
        say(text, opts) {
            if (!this.supported()) return false;
            if (this.engine === 'deepgram' && this._deepgramOk()) return this._sayDeepgram(text, opts);
            const chunks = pieces(speakable(text));
            if (!chunks.length) return false;
            if (opts && opts.urgent) this._halt();
            this._queue.push(...chunks);
            this._spoken.push({ text: chunks.join(' '), at: Date.now() });
            this._spoken = this._spoken.filter((x) => Date.now() - x.at < 60000).slice(-6);
            if (!this.speaking || (opts && opts.urgent)) this._next();
            return true;
        },

        _next() {
            if (!this._browserOk()) { this._done(); return; }
            const synth = window.speechSynthesis;
            const text = this._queue.shift();
            if (!text) { this._done(); return; }
            const u = new window.SpeechSynthesisUtterance(text);
            const voice = this._voice();
            if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
            u.rate = 1.05;
            u.onend = () => { if (this._current === u) this._next(); };
            u.onerror = (e) => {
                if (this._current !== u) return;
                if (e && e.error && e.error !== 'interrupted' && e.error !== 'canceled' && this.onError) this.onError(e.error);
                this._next();
            };
            this._current = u;
            this.speaking = true;
            // Chrome stalls long speech in some voices; a pause/resume nudge keeps it going.
            clearInterval(this._keepAlive);
            this._keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 10000);
            synth.speak(u);
        },

        _done() {
            this._current = null;
            if (this.speaking) this._endedAt = Date.now();
            this.speaking = false;
            clearInterval(this._keepAlive);
        },

        /** Stop talking now (the doctor started speaking, or the setting was turned off). */
        stop() {
            this._halt();
            this._done();
        },

        /** Cancel whatever is playing or queued, in both engines. */
        _halt() {
            this._queue = [];
            this._current = null;
            this._turn = (this._turn || 0) + 1;
            if (this._audio) { try { this._audio.pause(); } catch (e) { /* ignore */ } this._audio = null; }
            for (const x of (this._fetches || new Map()).values()) { try { x.ctrl.abort(); } catch (e) { /* ignore */ } if (x.url) URL.revokeObjectURL(x.url); }
            this._fetches = new Map();
            this._dgQueue = [];
            if (this._browserOk()) window.speechSynthesis.cancel();
        },

        // ── Deepgram: one request per sentence, the next fetched while this one plays ──
        _sayDeepgram(text, opts) {
            const chunks = sentencePieces(speakable(text));
            if (!chunks.length) return false;
            if (opts && opts.urgent) this._halt();
            this._dgQueue = (this._dgQueue || []).concat(chunks);
            this._spoken.push({ text: chunks.join(' '), at: Date.now() });
            this._spoken = this._spoken.filter((x) => Date.now() - x.at < 60000).slice(-6);
            if (!this.speaking || (opts && opts.urgent)) this._nextDeepgram();
            else this._prefetch();
            return true;
        },

        _audioFor(text) {
            this._fetches = this._fetches || new Map();
            if (!this._fetches.has(text)) {
                const ctrl = new AbortController();
                const entry = { ctrl, url: null };
                entry.p = fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: this.dgVoice }), signal: ctrl.signal })
                    .then((r) => { if (!r.ok) throw new Error('speech ' + r.status); return r.blob(); })
                    .then((b) => { entry.url = URL.createObjectURL(b); return entry.url; });
                this._fetches.set(text, entry);
            }
            return this._fetches.get(text).p;
        },

        _prefetch() { for (const t of (this._dgQueue || []).slice(0, 2)) this._audioFor(t).catch(() => {}); },

        _nextDeepgram() {
            const text = (this._dgQueue || []).shift();
            if (!text) { this._done(); return; }
            this.speaking = true;
            const turn = this._turn = (this._turn || 0) + 1;
            const got = this._audioFor(text);
            this._prefetch();
            got.then((url) => {
                if (turn !== this._turn) return;
                const a = new window.Audio(url);
                this._audio = a;
                const after = () => {
                    if (turn !== this._turn) return;
                    const entry = this._fetches.get(text);
                    if (entry && entry.url) URL.revokeObjectURL(entry.url);
                    this._fetches.delete(text);
                    this._audio = null;
                    this._nextDeepgram();
                };
                a.onended = after;
                a.onerror = after;
                const played = a.play();
                if (played && played.catch) played.catch((e) => { if (e && e.name === 'NotAllowedError' && this.onError) this.onError('not-allowed'); after(); });
            }, () => {
                if (turn !== this._turn) return;
                // The server could not speak: the browser voice says this and what follows.
                this.dgDown = true;
                if (this.onError) this.onError('deepgram-unavailable');
                const rest = [text].concat(this._dgQueue || []);
                this._dgQueue = [];
                this.speaking = false;
                if (this._browserOk()) { this._queue.push(...rest); this._next(); } else this._done();
            });
        },

        /** Speaking now, or stopped less than `ms` ago (the mic may still be hearing the tail). */
        busy(ms) { return this.speaking || Date.now() - this._endedAt < (ms == null ? 900 : ms); },

        /** Is this transcript its own voice? (Checked against what it said in the last minute.) */
        isEcho(heard) { return isEchoOf(heard, this._spoken.map((x) => x.text).join(' ')); },
    };

    const api = Object.assign(LiveVoice, { speakable, pieces, sentencePieces, isEchoOf, rankVoice, DG_VOICES });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiveVoice = api;
})(typeof window !== 'undefined' ? window : globalThis);
