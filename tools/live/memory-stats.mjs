// Precomputes the numbers behind "How it thinks" (js/live/live-about*.js): how big
// the raw chart is, what Deep Learn extracted from each record, what the memory
// document holds, what the chart digest holds, and which records mention which
// problem over time. Writes data/live/<patient>-memory-stats.json (commit it).
//   node tools/live/memory-stats.mjs [PAT001]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PID = process.argv[2] || 'PAT001';
const LiveChart = require(path.join(ROOT, 'js/live/live-chart.js'));
const LiveMemory = require(path.join(ROOT, 'js/live/live-memory.js'));

const dir = path.join(ROOT, 'data/patients', PID);
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/live', PID + '-deep-memory.json'), 'utf8'));
const md = fx.memoryDocument || {};
const facts = fx.extractedFacts || [];
const dl = fx.deepLearn || {};
const day = (d) => (d ? String(d).slice(0, 10) : null);

// ── the raw chart ─────────────────────────────────────────────────────
const raw = { files: 0, bytes: 0, byFolder: {} };
(function walk(d, top) {
    for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, top || f);
        else if (f.endsWith('.json')) {
            raw.files++; raw.bytes += st.size;
            const k = top || 'patient';
            raw.byFolder[k] = (raw.byFolder[k] || 0) + st.size;
        }
    }
})(dir, null);

// ── the records Deep Learn read, and what it pulled out of each ───────────
const kindOf = (id) => (/^LAB/.test(id) ? 'lab' : /^IMG/.test(id) ? 'imaging' : 'note');
const byKind = { note: 0, lab: 0, imaging: 0 };
for (const id of dl.processedIds || []) byKind[kindOf(id)]++;
const FIELDS = [
    ['key_findings', 'Findings'], ['lab_values', 'Lab values'], ['problems_mentioned', 'Problem mentions'], ['action_items', 'Action items'],
    ['vital_signs', 'Vital signs'], ['safety_concerns', 'Safety concerns'], ['medication_changes', 'Medicine changes'],
];
const items = FIELDS.map(([key, label]) => ({ key, label, n: facts.reduce((a, x) => a + (Array.isArray(x[key]) ? x[key].length : 0), 0) }));
const cardChars = JSON.stringify(facts).length;
const dates = facts.map((x) => day(x.date)).filter(Boolean).sort();

// ── the memory document (Sonnet's synthesis) ──────────────────────────────
const SECTIONS = [
    ['clinicalGestalt', 'Gestalt'], ['patientOverview', 'Overview'], ['safetyProfile', 'Safety profile'], ['problemAnalysis', 'Problems'],
    ['medicationRationale', 'Why each medicine'], ['labTrends', 'Lab trends'], ['pendingItems', 'Open items'], ['changesSinceLastReview', 'Recent changes'],
];
const mdSections = SECTIONS.filter(([k]) => md[k] != null).map(([key, label]) => {
    const v = md[key];
    return { key, label, chars: JSON.stringify(v).length, count: Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null) };
});

// ── the chart digest (what the brain always has in mind) ──────────────────
const chart = LiveChart.create({ patientId: PID, loadJSON: async (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')) });
await chart.load();
const mem = LiveMemory.build({ chart, memoryDocument: md, extractedFacts: facts });
const HEAD = /^(PATIENT|CHART DATA THROUGH|ALLERGIES|ACTIVE PROBLEMS|HOME MEDICATIONS|STOPPED MEDICATIONS|LABS|LAST VITALS|IMAGING|RECENT ENCOUNTERS|SOCIAL|LONG-TERM MEMORY|Gestalt|Overview|Safety notes|Problems in depth|Why each medicine|Open items from the chart review)\b/;
const LABEL = {
    PATIENT: 'Patient', 'CHART DATA THROUGH': 'Patient', ALLERGIES: 'Allergies', 'ACTIVE PROBLEMS': 'Problem list', 'HOME MEDICATIONS': 'Medicines',
    'STOPPED MEDICATIONS': 'Medicines', LABS: 'Labs', 'LAST VITALS': 'Vitals', IMAGING: 'Imaging', 'RECENT ENCOUNTERS': 'Visits', SOCIAL: 'Social',
    'LONG-TERM MEMORY': 'Summary', Gestalt: 'Summary', Overview: 'Summary', 'Safety notes': 'Safety notes', 'Problems in depth': 'Problems in depth',
    'Why each medicine': 'Why each medicine', 'Open items from the chart review': 'Open items',
};
const digestParts = [];
let cur = null;
for (const line of mem.digest.split('\n')) {
    const m = line.match(HEAD);
    if (m) {
        const label = LABEL[m[1]] || m[1];
        cur = digestParts.find((x) => x.label === label) || (digestParts.push({ label, chars: 0, from: label === 'Summary' || /in depth|each medicine|Open items|Safety notes/.test(label) ? 'memory' : 'chart' }), digestParts[digestParts.length - 1]);
    }
    if (cur) cur.chars += line.length + 1;
}

// ── problem threads: which records mention which problem, when ────────────
const RULES = [
    [/heart failure|hfref|cardiomyopathy|\bchf\b|\badhf\b|volume overload|ejection fraction/i],
    [/kidney|\bckd\b|renal|\baki\b|nephro|egfr|creatinine/i],
    [/atrial fib|\bafib\b|a-fib|\baf\b|atrial flutter/i],
    [/gi bleed|gastrointestinal (bleed|hemorrhage)|ulcer|melena|hematemesis|upper gi|peptic/i],
    [/coronary|\bcad\b|angina|\bnstemi\b|\bstemi\b|myocardial infarction|ischemic heart|cabg|stent/i],
    [/\bfall|mobility|gait|balance|frailty/i],
    [/diabet|\bt2dm\b|\bdm2?\b|hyperglyc|hypoglyc|\ba1c\b|insulin/i],
    [/neuropath/i],
    [/\bbph\b|prostat|nocturia|\bluts\b|urinary (frequency|retention|symptom)/i],
    [/depress|mood|adjustment disorder/i],
    [/steatosis|fatty liver|nafld|masld|\bnash\b/i],
    [/carotid|cerebrovascular|\btia\b|transient ischemic|stroke/i],
    [/anemia/i],
    [/hyponatr|hypernatr|sodium/i],
    [/sleep apnea|\bosa\b|cpap/i],
    [/dyspnea|pneumonia|\bcap\b|pulmonary|lung|copd/i],
    [/knee|osteoarthritis|\boa\b/i],
    [/advance care|goals of care|code status|polst|advance directive|dnr|hospice|palliative/i],
];
const problems = (md.problemAnalysis || []).map((p, i) => ({ i, name: p.problem, status: p.status || '', rule: (RULES[i] || [null])[0] }));
const docType = new Map(facts.map((x) => [x.documentId, x.documentType]));
const threads = problems.map((p) => ({ problem: p.name, status: p.status, mentions: [] }));
let matched = 0, total = 0;
for (const card of facts) {
    const d = day(card.date);
    if (!d) continue;
    const said = (card.problems_mentioned || []).map(String);
    total += said.length;
    const hit = new Set();
    for (const s of said) {
        let any = false;
        problems.forEach((p, i) => { if (p.rule && p.rule.test(s)) { hit.add(i); any = true; } });
        if (any) matched++;
    }
    for (const i of hit) threads[i].mentions.push({ d, k: kindOf(card.documentId), id: card.documentId, t: docType.get(card.documentId) || '' });
}
threads.forEach((t) => t.mentions.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)));

// Hospital stays (inpatient encounters with a discharge date).
const enc = JSON.parse(fs.readFileSync(path.join(dir, 'encounters/index.json'), 'utf8'));
const admissions = (enc.encounters || enc).filter((e) => /inpatient/i.test(e.type || '') && (e.dischargeDate || e.endDate))
    .map((e) => ({ start: day(e.date), end: day(e.dischargeDate || e.endDate), label: (e.diagnoses || [])[0] || e.chiefComplaint || '' }))
    .sort((a, b) => (a.start < b.start ? -1 : 1));

const out = {
    patient: PID,
    generated: new Date().toISOString(),
    chart: { files: raw.files, bytes: raw.bytes, tokens: Math.round(raw.bytes / 4), byFolder: raw.byFolder },
    records: { read: dl.processedCount || (dl.processedIds || []).length, total: dl.totalItems || null, byKind, first: dates[0] || null, last: dates[dates.length - 1] || null },
    factCards: { cards: facts.length, items, totalItems: items.reduce((a, x) => a + x.n, 0), chars: cardChars, tokens: Math.round(cardChars / 3) },
    passes: { levels: dl.totalLevels || null, extraction: (fx.models || {}).extraction || '', synthesis: (fx.models || {}).synthesis || '', calls: (fx.runStats || {}).calls || null, cost: (fx.runStats || {}).cost || null },
    memoryDocument: { chars: JSON.stringify(md).length, sections: mdSections, problems: (md.problemAnalysis || []).length, meds: (md.medicationRationale || []).length, pending: (md.pendingItems || []).length },
    longTerm: { chars: mem.meta.longTermChars, tokens: Math.round(mem.meta.longTermChars / 2.25) },
    digest: { chars: mem.meta.digestChars, tokens: Math.round(mem.meta.digestChars / 4), parts: digestParts.map((x) => ({ label: x.label, chars: x.chars, from: x.from })) },
    threads,
    threadCoverage: { mentions: total, matched },
    admissions,
};
const file = path.join(ROOT, 'data/live', PID + '-memory-stats.json');
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log('Wrote ' + path.relative(ROOT, file) + ' (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
console.log('chart ' + raw.files + ' files ' + Math.round(raw.bytes / 1024) + ' KB · records ' + JSON.stringify(byKind) + ' · cards ' + facts.length + ' (' + out.factCards.totalItems + ' items)'
    + ' · memory doc ' + Math.round(out.memoryDocument.chars / 1024) + ' KB · digest ' + out.digest.tokens + ' tokens · long-term ' + out.longTerm.tokens + ' tokens');
console.log('digest parts: ' + digestParts.map((x) => x.label + ' ' + x.chars).join(', '));
console.log('threads: ' + threads.map((t) => t.problem.split(/[,(/]/)[0].trim() + ' ' + t.mentions.length).join(' | '));
console.log('problem mentions matched to the 18 problems: ' + matched + ' of ' + total + ' · admissions: ' + admissions.map((a) => a.start + ' ' + a.label).join('; '));
