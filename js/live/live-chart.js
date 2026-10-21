/**
 * Live Coworker: fast, exact chart lookups (no AI).
 *
 * The coworker's brain calls these as tools ("last potassium?", "is he on an
 * ACE inhibitor?", "what did cardiology say about his EF?"), and the session
 * digest is built from them. Runs in the browser (data via the app's
 * DataLoader or plain fetch) and in Node (data read from disk by the replay
 * harness). Read-only.
 */
(function (root) {
    'use strict';

    // Common shorthand -> words that appear in result names.
    const LAB_SYNONYMS = {
        k: ['potassium'], potassium: ['potassium'],
        na: ['sodium'], sodium: ['sodium'],
        cl: ['chloride'], co2: ['co2', 'bicarbonate'], bicarb: ['co2', 'bicarbonate'], hco3: ['co2', 'bicarbonate'],
        cr: ['creatinine'], creat: ['creatinine'], creatinine: ['creatinine'],
        bun: ['bun', 'urea nitrogen'], egfr: ['egfr', 'gfr'], gfr: ['egfr', 'gfr'],
        glucose: ['glucose'], sugar: ['glucose'], bg: ['glucose'],
        a1c: ['a1c'], hba1c: ['a1c'], 'hemoglobin a1c': ['a1c'],
        bnp: ['bnp'], 'nt-probnp': ['bnp'], probnp: ['bnp'],
        trop: ['troponin'], troponin: ['troponin'],
        hgb: ['hemoglobin'], hb: ['hemoglobin'], hemoglobin: ['hemoglobin'], hct: ['hematocrit'],
        wbc: ['wbc', 'white blood'], plt: ['platelet'], platelets: ['platelet'],
        mg: ['magnesium'], magnesium: ['magnesium'], phos: ['phosph'], phosphorus: ['phosph'],
        ca: ['calcium'], calcium: ['calcium'], albumin: ['albumin'],
        inr: ['inr'], pt: ['prothrombin', 'pt '], ptt: ['ptt'],
        ast: ['ast'], alt: ['alt'], 'alk phos': ['alkaline'], bili: ['bilirubin'], bilirubin: ['bilirubin'],
        tsh: ['tsh'], ldl: ['ldl'], hdl: ['hdl'], lipids: ['cholesterol', 'ldl', 'hdl', 'triglyceride'],
        lactate: ['lactate', 'lactic'], digoxin: ['digoxin'], uric: ['uric'], 'uric acid': ['uric'],
        uacr: ['albumin/creatinine', 'microalbumin'], microalbumin: ['microalbumin', 'albumin/creatinine'],
        iron: ['iron', 'ferritin', 'tibc', 'transferrin'], ferritin: ['ferritin'],
    };

    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const day = (iso) => String(iso || '').slice(0, 10);

    function flagFor(value, range) {
        const v = typeof value === 'number' ? value : parseFloat(value);
        if (!range || !isFinite(v)) return '';
        const r = String(range).trim();
        let m = r.match(/^([\d.]+)\s*-\s*([\d.]+)/);
        if (m) return v < parseFloat(m[1]) ? 'L' : v > parseFloat(m[2]) ? 'H' : '';
        m = r.match(/^<\s*=?\s*([\d.]+)/);
        if (m) return v > parseFloat(m[1]) ? 'H' : '';
        m = r.match(/^>\s*=?\s*([\d.]+)/);
        if (m) return v < parseFloat(m[1]) ? 'L' : '';
        return '';
    }

    // Notes come in several shapes (plain "content", a "sections" object, or
    // structured fields like hpi/assessment/plan). Flatten everything except
    // the bookkeeping fields into "label: text" lines.
    const NOTE_META = new Set(['id', 'date', 'author', 'department', 'encounter', 'signedDate', 'coSignatures', 'attestation', 'facility', 'status', 'radiologist', 'orderingProvider']);
    function noteText(n) {
        const out = [];
        const walk = (v, label, depth) => {
            if (v == null || depth > 6) return;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                const s = String(v).trim();
                if (s) out.push(label ? label + ': ' + s : s);
            } else if (Array.isArray(v)) {
                for (const x of v) walk(x, label, depth + 1);
            } else if (typeof v === 'object') {
                for (const [k, x] of Object.entries(v)) {
                    if (depth === 0 && NOTE_META.has(k)) continue;
                    walk(x, k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(), depth + 1);
                }
            }
        };
        walk(n, '', 0);
        return out.join('\n');
    }

    function tokens(s) {
        return norm(s).replace(/[^a-z0-9/+.\- ]/g, ' ').split(' ').filter((t) => t.length > 1 && !STOP.has(t));
    }
    const STOP = new Set(['the', 'and', 'for', 'with', 'was', 'his', 'her', 'has', 'had', 'are', 'what', 'when', 'did', 'does', 'any', 'from', 'that', 'this', 'last', 'of', 'on', 'in', 'to', 'is', 'a', 'an', 'he', 'she', 'patient', 'pt']);

    /**
     * loadJSON(relPath) -> object, where relPath is relative to the patient's
     * folder (e.g. "labs/index.json"). loadAllLabs() is optional (the browser
     * passes DataLoader's cached version).
     */
    function create(opts) {
        const o = opts || {};
        const loadJSON = o.loadJSON;
        const chart = {
            patientId: o.patientId || 'PAT001',
            demographics: null, allergies: [], problems: [], resolvedProblems: [], meds: [], pastMeds: [],
            labs: [], vitals: [], notesIndex: [], notes: null, imaging: [], encounters: [], orders: [],
            social: null, family: null, loaded: false,
        };

        const safe = async (p, fallback) => { try { return await loadJSON(p); } catch (e) { return fallback; } };

        chart.load = async function () {
            const [demo, alg, prob, res, meds, hist, vit, notes, img, enc, soc, fam, ord] = await Promise.all([
                safe('demographics.json', null), safe('allergies.json', { allergies: [] }),
                safe('problems/active.json', { problems: [] }), safe('problems/resolved.json', { problems: [] }),
                safe('medications/active.json', { medications: [] }), safe('medications/historical.json', { medications: [] }),
                safe('vitals/index.json', { vitals: [] }), safe('notes/index.json', { notes: [] }),
                safe('imaging/index.json', { studies: [] }), safe('encounters/index.json', { encounters: [] }),
                safe('social_history.json', null), safe('family_history.json', null), safe('orders/index.json', { active: [] }),
            ]);
            chart.demographics = demo;
            chart.allergies = (alg && alg.allergies) || [];
            chart.problems = (prob && prob.problems) || [];
            chart.resolvedProblems = (res && res.problems) || [];
            chart.meds = (meds && meds.medications) || [];
            chart.pastMeds = (hist && hist.medications) || [];
            chart.vitals = ((vit && vit.vitals) || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
            chart.notesIndex = ((notes && notes.notes) || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
            chart.imaging = ((img && img.studies) || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
            chart.encounters = ((enc && enc.encounters) || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
            chart.social = soc;
            chart.family = fam;
            chart.orders = (ord && (ord.active || ord.orders)) || [];

            let labs = null;
            if (o.loadAllLabs) { try { labs = await o.loadAllLabs(); } catch (e) { labs = null; } }
            if (!labs) {
                const idx = await safe('labs/index.json', { panels: [] });
                const panels = await Promise.all((idx.panels || []).map((p) => safe('labs/panels/' + p.id + '.json', null)));
                labs = [];
                for (const pd of panels) {
                    if (!pd) continue;
                    for (const r of pd.results || []) labs.push(Object.assign({}, r, { panelName: pd.name, panelId: pd.id, collectedDate: pd.collectedDate }));
                }
            }
            chart.labs = labs.map((r) => Object.assign({}, r, { flag: r.flag || flagFor(r.value, r.referenceRange) }))
                .sort((a, b) => String(a.collectedDate).localeCompare(String(b.collectedDate)));
            chart.loaded = true;
            return chart;
        };

        /** Distinct lab result names matching a query term. */
        function labNamesFor(term) {
            const t = norm(term);
            const words = LAB_SYNONYMS[t] || [t];
            const names = new Set();
            for (const r of chart.labs) {
                const n = norm(r.name);
                if (words.some((w) => n === w || n.includes(w))) names.add(r.name);
            }
            return [...names];
        }

        /** Latest results for each requested test, newest first. */
        chart.lookupLabs = function (tests, limit) {
            const n = Math.max(1, Math.min(limit || 3, 12));
            const out = [];
            for (const term of tests || []) {
                const names = labNamesFor(term);
                if (!names.length) { out.push({ test: term, found: false }); continue; }
                for (const name of names.slice(0, 4)) {
                    const rows = chart.labs.filter((r) => r.name === name).slice(-n).reverse();
                    out.push({
                        test: name, found: true, unit: rows[0] && rows[0].unit, range: rows[0] && rows[0].referenceRange,
                        results: rows.map((r) => ({ date: day(r.collectedDate), value: r.value, flag: r.flag || '' })),
                    });
                }
            }
            return out;
        };

        chart.latestLab = function (term) {
            const names = labNamesFor(term);
            let best = null;
            for (const r of chart.labs) if (names.includes(r.name)) best = r;
            return best;
        };

        chart.lastVitals = function () { return chart.vitals[chart.vitals.length - 1] || null; };

        chart.age = function (asOf) {
            const dob = chart.demographics && chart.demographics.dateOfBirth;
            if (!dob) return null;
            const ref = asOf ? new Date(asOf) : new Date();
            const b = new Date(dob);
            let a = ref.getFullYear() - b.getFullYear();
            if (ref.getMonth() < b.getMonth() || (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate())) a -= 1;
            return a;
        };

        /** Loads every note's full text once (about 1 MB for PAT001), plus imaging reports. */
        async function ensureNotes() {
            if (chart.notes) return chart.notes;
            const [full, reports] = await Promise.all([
                Promise.all(chart.notesIndex.map((n) => safe('notes/' + n.id + '.json', null))),
                Promise.all(chart.imaging.map((s) => safe('imaging/reports/' + s.id + '.json', null))),
            ]);
            chart.notes = full.filter(Boolean).map((n) => Object.assign({}, n, { text: noteText(n) }));
            chart.imagingReports = reports.filter(Boolean).map((r) => Object.assign({}, r, { text: noteText(r) }));
            return chart.notes;
        }

        /**
         * Keyword search over notes, problems, meds, allergies and imaging.
         * Returns up to k hits: { source, id, date, title, snippet }.
         */
        chart.search = async function (query, k) {
            const q = tokens(query);
            if (!q.length) return [];
            const limit = Math.max(1, Math.min(k || 6, 12));
            const notes = await ensureNotes();
            const docs = [];
            for (const n of notes) docs.push({ source: 'note', id: n.id, date: day(n.date), title: (n.title || n.type) + ' — ' + (n.department || '') + ' (' + (n.author || '') + ')', text: n.text || '' });
            for (const r of chart.imagingReports || []) docs.push({ source: 'imaging report', id: r.id, date: day(r.date), title: (r.modality || '') + ': ' + (r.description || ''), text: r.text || '' });
            for (const p of chart.problems) docs.push({ source: 'problem', id: p.id, date: day(p.onsetDate), title: 'Problem: ' + p.name, text: [p.name, p.notes, p.status].filter(Boolean).join('. ') });
            for (const m of chart.meds) docs.push({ source: 'medication', id: m.id, date: day(m.startDate), title: 'Active med: ' + m.name, text: [m.name, m.genericName, m.dose, m.route, m.frequency, m.indication, m.instructions].filter(Boolean).join(' ') });
            for (const m of chart.pastMeds) docs.push({ source: 'past medication', id: m.id, date: day(m.endDate || m.startDate), title: 'Past med: ' + m.name, text: [m.name, m.genericName, m.dose, m.reason, m.discontinuedReason, m.indication].filter(Boolean).join(' ') });
            for (const a of chart.allergies) docs.push({ source: 'allergy', id: a.id, date: day(a.onsetDate), title: 'Allergy: ' + a.substance, text: [a.substance, a.reaction, a.severity, a.notes].filter(Boolean).join('. ') });
            for (const s of chart.imaging) docs.push({ source: 'imaging', id: s.id, date: day(s.date), title: s.modality + ': ' + s.description, text: [s.description, s.impression, s.findings].filter(Boolean).join('. ') });

            // Simple BM25.
            const N = docs.length;
            const df = new Map();
            const dl = [];
            const tfs = docs.map((d) => {
                const toks = tokens(d.title + ' ' + d.text);
                dl.push(toks.length);
                const tf = new Map();
                for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
                for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
                return tf;
            });
            const avg = dl.reduce((a, b) => a + b, 0) / Math.max(1, N);
            const scored = docs.map((d, i) => {
                let s = 0;
                for (const t of q) {
                    const f = tfs[i].get(t) || 0;
                    if (!f) continue;
                    const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
                    s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * dl[i] / avg));
                }
                return { d, s };
            }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || String(b.d.date).localeCompare(String(a.d.date))).slice(0, limit);

            return scored.map(({ d }) => ({ source: d.source, id: d.id, date: d.date, title: d.title, snippet: snippet(d.text, q) }));
        };

        function snippet(text, q) {
            const t = String(text || '');
            const lower = t.toLowerCase();
            let best = 0;
            let bestHits = -1;
            for (let i = 0; i < t.length; i += 120) {
                const win = lower.slice(i, i + 420);
                const hits = q.reduce((n, w) => n + (win.includes(w) ? 1 : 0), 0);
                if (hits > bestHits) { bestHits = hits; best = i; }
            }
            const start = Math.max(0, best - 40);
            return (start > 0 ? '…' : '') + t.slice(start, start + 460).replace(/\s+/g, ' ').trim() + (start + 460 < t.length ? '…' : '');
        }

        chart.note = async function (id) {
            const notes = await ensureNotes();
            return notes.find((n) => n.id === id) || null;
        };

        return chart;
    }

    const api = { create, flagFor, noteText, LAB_SYNONYMS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiveChart = api;
})(typeof window !== 'undefined' ? window : globalThis);
