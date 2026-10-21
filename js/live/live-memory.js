/**
 * Live Coworker: builds the brain's two memory layers for a session.
 *
 *  digest   - a compact chart summary (~5-8K tokens) that sits in the brain's
 *             cached system prompt. Allergies, medicines, problems, labs and
 *             vitals come straight from the structured chart, because the
 *             AI-written memory can be wrong (the shipped PAT001 memory says
 *             "no documented allergies"). The AI memory adds the story.
 *  longTerm - everything the long-term memory knows (the full AI memory
 *             document plus per-document facts from Deep Learn), read by a
 *             cheap helper model only when the brain asks a question.
 */
(function (root) {
    'use strict';

    const day = (iso) => String(iso || '').slice(0, 10);
    const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const KEY_LABS = ['potassium', 'sodium', 'creatinine', 'egfr', 'bun', 'co2', 'glucose', 'a1c', 'bnp', 'troponin', 'hemoglobin', 'platelets', 'wbc', 'inr', 'magnesium', 'albumin', 'ldl', 'tsh'];

    function asText(v, depth) {
        const d = depth || 0;
        if (v == null) return '';
        if (typeof v !== 'object') return String(v);
        if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? '- ' + asText(x, d + 1).replace(/\n/g, '\n  ') : '- ' + x)).join('\n');
        return Object.entries(v).filter(([, x]) => x != null && x !== '' && !(Array.isArray(x) && !x.length))
            .map(([k, x]) => (typeof x === 'object' ? k + ':\n' + asText(x, d + 1).replace(/^/gm, '  ') : k + ': ' + x)).join('\n');
    }

    function latestDate(chart) {
        const ds = [];
        if (chart.labs.length) ds.push(day(chart.labs[chart.labs.length - 1].collectedDate));
        if (chart.notesIndex.length) ds.push(day(chart.notesIndex[0].date));
        if (chart.encounters.length) ds.push(day(chart.encounters[0].date));
        return ds.sort().pop() || '';
    }

    function chartSection(chart) {
        const d = chart.demographics || {};
        const out = [];
        out.push('PATIENT: ' + [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') + ', ' + chart.age() + '-year-old ' + String(d.sex || '').toLowerCase() + ' (DOB ' + (d.dateOfBirth || '?') + ')');
        out.push('CHART DATA THROUGH: ' + latestDate(chart) + ' (anything said in the room today is newer)');
        out.push('');
        out.push('ALLERGIES (structured list; authoritative):');
        for (const a of chart.allergies) out.push('- ' + a.substance + ': ' + [a.reaction, a.severity].filter(Boolean).join(', ') + (a.onsetDate ? ' (' + day(a.onsetDate) + ')' : '') + (a.notes ? ' — ' + clip(a.notes, 140) : ''));
        if (!chart.allergies.length) out.push('- none recorded');
        out.push('');
        out.push('ACTIVE PROBLEMS:');
        for (const p of chart.problems) out.push('- ' + p.name + (p.notes ? ' — ' + clip(p.notes, 170) : ''));
        out.push('');
        out.push('HOME MEDICATIONS (active list):');
        for (const m of chart.meds) out.push('- ' + [m.name, m.genericName && m.genericName !== m.name ? '(' + m.genericName + ')' : '', m.dose, m.route, m.frequency].filter(Boolean).join(' ') + (m.indication ? ' — for ' + m.indication : ''));
        const stopped = chart.pastMeds.filter((m) => m.discontinuedReason || m.reason || m.endDate);
        if (stopped.length) {
            out.push('');
            out.push('STOPPED MEDICATIONS (most recent first):');
            stopped.slice().sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || ''))).slice(0, 14)
                .forEach((m) => out.push('- ' + [m.name, m.dose].filter(Boolean).join(' ') + (m.endDate ? ', stopped ' + day(m.endDate) : '') + ((m.discontinuedReason || m.reason) ? ' — ' + clip(m.discontinuedReason || m.reason, 140) : '')));
        }
        out.push('');
        out.push('LABS (newest first, last 3 each):');
        for (const t of KEY_LABS) {
            for (const r of chart.lookupLabs([t], 3)) {
                if (!r.found) continue;
                out.push('- ' + r.test + (r.unit ? ' (' + r.unit + ')' : '') + ': ' + r.results.map((x) => x.value + (x.flag ? ' ' + x.flag : '') + ' ' + x.date).join('; '));
            }
        }
        const v = chart.vitals.slice(-3).reverse();
        if (v.length) {
            out.push('');
            out.push('LAST VITALS:');
            for (const x of v) out.push('- ' + day(x.date) + ': BP ' + x.systolic + '/' + x.diastolic + ', HR ' + x.heartRate + ', RR ' + x.respiratoryRate + ', SpO2 ' + x.spO2 + '%, T ' + x.temperature + ', weight ' + x.weight + ' kg');
        }
        if (chart.imaging.length) {
            out.push('');
            out.push('IMAGING (latest 6):');
            for (const s of chart.imaging.slice(0, 6)) out.push('- ' + day(s.date) + ' ' + s.modality + ': ' + s.description);
        }
        if (chart.encounters.length) {
            out.push('');
            out.push('RECENT ENCOUNTERS (latest 8):');
            for (const e of chart.encounters.slice(0, 8)) out.push('- ' + day(e.date) + ' ' + [e.type, e.department].filter(Boolean).join(', ') + (e.chiefComplaint ? ': ' + clip(e.chiefComplaint, 90) : '') + (e.diagnoses && e.diagnoses.length ? ' → ' + clip(e.diagnoses.join('; '), 120) : ''));
        }
        const s = chart.social;
        if (s) {
            out.push('');
            out.push('SOCIAL: ' + clip([s.livingSituation, s.tobacco && ('Tobacco: ' + [s.tobacco.status, s.tobacco.packYears && s.tobacco.packYears + ' pack-years', s.tobacco.quitDate && 'quit ' + day(s.tobacco.quitDate)].filter(Boolean).join(', ')), s.alcohol && ('Alcohol: ' + s.alcohol.status), s.exercise].filter(Boolean).join(' | '), 600));
        }
        return out.join('\n');
    }

    function memorySection(md) {
        if (!md) return '';
        const out = ['LONG-TERM MEMORY (written by the coworker\'s chart review; may contain errors, and the structured lists above win where they disagree):'];
        if (md.clinicalGestalt) out.push('Gestalt: ' + md.clinicalGestalt);
        if (md.patientOverview) out.push('Overview: ' + clip(md.patientOverview, 2200));
        if (md.safetyProfile) {
            const sp = Object.assign({}, md.safetyProfile);
            delete sp.allergies; // structured list above is authoritative
            const txt = asText(sp);
            if (txt) out.push('Safety notes:\n' + clip(txt, 1800).replace(/ - /g, '\n- '));
        }
        if (Array.isArray(md.problemAnalysis)) {
            out.push('Problems in depth:');
            for (const p of md.problemAnalysis) {
                out.push('- ' + clip([p.problem, p.status && '[' + p.status + ']', p.trajectory].filter(Boolean).join(' '), 260));
                if (p.keyData) out.push('  data: ' + clip([].concat(p.keyData).join('; '), 260));
                const plan = p.plan || p.currentPlan || p.management;
                if (plan) out.push('  plan: ' + clip([].concat(plan).join('; '), 260));
                const why = p.rationale || p.reasoning || p.considerations;
                if (why) out.push('  notes: ' + clip([].concat(why).join('; '), 260));
            }
        }
        if (Array.isArray(md.medicationRationale)) {
            out.push('Why each medicine:');
            for (const m of md.medicationRationale) out.push('- ' + clip([m.name, m.rationale, m.monitoring && 'monitor: ' + m.monitoring, m.concerns && 'concerns: ' + m.concerns].filter(Boolean).join(' — '), 300));
        }
        if (Array.isArray(md.pendingItems) && md.pendingItems.length) {
            out.push('Open items from the chart review:');
            for (const p of md.pendingItems.slice(0, 14)) out.push('- ' + clip(typeof p === 'string' ? p : [p.text, p.urgency && '(' + p.urgency + ')'].filter(Boolean).join(' '), 220));
        }
        return out.join('\n');
    }

    /**
     * build({ chart, memoryDocument?, extractedFacts? }) -> { digest, longTerm, meta }
     */
    function build(opts) {
        const o = opts || {};
        const chart = o.chart;
        const md = o.memoryDocument || null;
        const digest = [chartSection(chart), md ? '\n' + memorySection(md) : ''].join('\n');
        const parts = [];
        if (md) parts.push('AI MEMORY DOCUMENT (full):\n' + asText(md));
        if (Array.isArray(o.extractedFacts) && o.extractedFacts.length) {
            parts.push('FACTS EXTRACTED FROM EACH CHART DOCUMENT (Deep Learn):');
            for (const f of o.extractedFacts) {
                const label = [f.date && day(f.date), f.source || f.sourceType || f.type, f.id || f.sourceId || f.docId].filter(Boolean).join(' ');
                const body = typeof f === 'string' ? f : (f.text || f.fact || f.facts || f.summary || f);
                parts.push('- ' + (label ? '[' + label + '] ' : '') + (typeof body === 'string' ? body : asText(body)).replace(/\n/g, ' '));
            }
        }
        const longTerm = parts.join('\n\n');
        return { digest, longTerm, meta: { digestChars: digest.length, longTermChars: longTerm.length, hasMemory: !!md, facts: (o.extractedFacts || []).length } };
    }

    const api = { build, chartSection, memorySection, asText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LiveMemory = api;
})(typeof window !== 'undefined' ? window : globalThis);
