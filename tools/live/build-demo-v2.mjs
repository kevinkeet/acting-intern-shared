#!/usr/bin/env node
// Builds data/live/morrison-admission-02.json from 01: thinking aloud (T*), an
// ending at the workstation (Z*) with EHR actions (X*), one Aura voice per
// speaker through the lab's /api/tts route, and timing from the real audio.
// Simulated patient only. Writes the MP3s to data/live/audio/morrison-admission-02/,
// the script, and its review sheet (data/live/morrison-admission-02.md).
//   node tools/live/build-demo-v2.mjs [--no-tts]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NO_TTS = process.argv.includes('--no-tts');
const v1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/live/morrison-admission-01.json'), 'utf8'));
const AUDIO_DIR = 'data/live/audio/morrison-admission-02/';
const VOICES = { doctor: 'aura-2-arcas-en', patient: 'aura-2-orpheus-en', wife: 'aura-2-harmonia-en', nurse: 'aura-2-thalia-en' };
const TTS = 'https://acting-intern-lab.onrender.com/api/tts';

// ── thinking out loud: inserted after the 01 line named ─────────────────
const THINK = [
    ['U41', 'T1', "So he's wet from head to toe. Orthopnea, waking up gasping, ten pounds up, JVP to his jaw, crackles, and pitting to the knees. He needs to be diuresed hard."],
    ['U44', 'T2', "BNP almost twenty-seven hundred, and a troponin of 0.08 with that tightness when he walks. Probably demand from all this fluid, but I don't want to miss a heart attack."],
    ['U45', 'T3', 'Creatinine 2.4, BUN 45. That looks like congestion. The fix for his kidneys is the same as the fix for his lungs: get the fluid off, and follow the creatinine every day.'],
    ['U47', 'T4', "He takes 60 in the morning and 40 at night by mouth, so 80 IV is a lot more than he's used to. That should get things moving."],
    ['U48', 'T5', "And a repeat troponin in three hours. If it's flat, this is demand, not a heart attack."],
    ['U55', 'T6', "And we'll weigh you every morning. I'd like to see about two pounds a day come off."],
    ['U59', 'T7', "A hundred forty-two in A-fib, on top of all this fluid. His heart can't fill at that rate, so I want the rate down now."],
    ['U60', 'T8', "And he's in A-fib with diabetes, heart failure, high blood pressure, and he's seventy-four. That's a high stroke risk, and he'll be lying in a hospital bed."],
    ['U63', 'T9', '38.6. He did mention a cough with some white sputum, and the film showed small effusions.'],
];

// ── the ending: at the workstation, thinking aloud, acting in the EHR ────
// Each Z line may carry actions that follow it; "after" is seconds after the line ends,
// "span" how long the action group takes before the next line may start.
const ENDING = [
    { id: 'Z1', text: 'Okay. Let me sit down and get these orders in.', gap: 3.0, acts: [{ do: 'radar-open' }], span: 2.0 },
    { id: 'Z2', text: 'First, the flags. I should have stopped on the black stools. With his ulcer bleed in 2023, the aspirin and the Aleve, and a hemoglobin of 10.2, this could be an upper GI bleed.' },
    { id: 'Z3', text: 'So the heparin drip comes off.', acts: [{ do: 'remove', match: ['heparin'] }], span: 1.5 },
    { id: 'Z4', text: 'No diltiazem, not with his ejection fraction.', acts: [{ do: 'remove', match: ['diltiazem'] }], span: 1.5 },
    { id: 'Z5', text: "No potassium either. It's already 5.1.", acts: [{ do: 'remove', match: ['potassium'] }], span: 1.5 },
    { id: 'Z6', text: "And no Zosyn. That's a penicillin, and he had anaphylaxis.", acts: [{ do: 'remove', match: ['zosyn'] }], span: 1.5 },
    // The coworker may have flagged the furosemide to wait for the labs; the doctor decides it goes ahead (signed even if flagged).
    { id: 'Z18', text: "The furosemide stays, though. He's drowning, and we'll draw the hemoglobin and type and screen alongside it.", acts: [{ do: 'sign', match: ['furosemide'] }], span: 6.0 },
    // about a dozen forms at ~2.8 s each at 1x
    { id: 'Z7', text: 'Now the rest of the plan, the way we said it.', acts: [{ do: 'review-all' }], span: 36 },
    { id: 'Z8', text: "For his rate, digoxin rather than amiodarone. Amiodarone could convert him, and he's not anticoagulated. Digoxin 0.25 milligrams IV now, and we'll dose it carefully for his kidneys.",
        acts: [{ do: 'order', orderType: 'medication', fields: { name: 'Digoxin', dose: '0.25 mg', route: 'IV', frequency: 'Once', indication: 'Atrial fibrillation with rapid ventricular response', notes: 'Renal dosing; check a level before any repeat dose' } }], span: 3.5 },
    { id: 'Z9', text: 'For the pneumonia, ceftriaxone and azithromycin. He tolerated that combination in 2021.',
        acts: [
            { do: 'order', orderType: 'medication', fields: { name: 'Ceftriaxone', dose: '1 g', route: 'IV Piggyback', frequency: 'Daily', indication: 'Community-acquired pneumonia', notes: 'Tolerated 2/2021 despite penicillin anaphylaxis' } },
            { do: 'order', orderType: 'medication', fields: { name: 'Azithromycin', dose: '500 mg', route: 'IV Piggyback', frequency: 'Daily', indication: 'Community-acquired pneumonia' } },
        ], span: 3.5 },
    { id: 'Z10', text: 'Hold the metformin with a creatinine of 2.4, and cut the gabapentin to 300 twice a day.',
        acts: [
            { do: 'order', orderType: 'nursing', fields: { orderType: 'Other', details: 'Hold metformin (creatinine 2.4, eGFR about 27)', priority: 'Routine' } },
            { do: 'order', orderType: 'medication', fields: { name: 'Gabapentin', dose: '300 mg', route: 'PO', frequency: 'BID', indication: 'Diabetic peripheral neuropathy', notes: 'Reduced from 300 mg three times a day for kidney function' } },
        ], span: 3.5 },
    { id: 'Z11', text: 'For the bleed: hold the aspirin, no more Aleve, pantoprazole 40 IV twice a day, a type and screen, a repeat hemoglobin tonight, and GI to see him.',
        acts: [
            { do: 'order', orderType: 'nursing', fields: { orderType: 'Other', details: 'Hold aspirin; no NSAIDs (possible upper GI bleed)', priority: 'Routine' } },
            { do: 'order', orderType: 'medication', fields: { name: 'Pantoprazole', dose: '40 mg', route: 'IV', frequency: 'BID', indication: 'Possible upper GI bleed' } },
            { do: 'order', orderType: 'lab', fields: { name: 'Other', customName: 'Type and screen', specimen: 'Blood', priority: 'STAT', indication: 'Possible upper GI bleed' } },
            { do: 'order', orderType: 'lab', fields: { name: 'Complete Blood Count', specimen: 'Blood', priority: 'Urgent', indication: 'Possible upper GI bleed', notes: 'Repeat hemoglobin tonight' } },
            { do: 'order', orderType: 'consult', fields: { specialty: 'Gastroenterology', priority: 'Urgent', reason: 'Melena with hemoglobin 10.2 (13.9 in January) and an unexplained INR of 2.3, in a man with a 2023 gastric ulcer bleed who takes aspirin and naproxen. Please evaluate for upper GI bleeding.' } },
            // With metformin, gabapentin, aspirin and the Aleve decided, the med rec is done: tick both tasks.
            { do: 'tick', match: ['home med'] },
            { do: 'tick', match: ['carvedilol'] },
        ], span: 2.0 },
    { id: 'Z12', text: "I'll ask Patricia whether there's any old warfarin at home. Nothing else explains that INR." },
    { id: 'Z13', text: "And last week's episode sounds like a TIA. Head CT tonight, and neurology to see him, since that was the trigger to revisit anticoagulation.",
        acts: [
            { do: 'order', orderType: 'imaging', fields: { modality: 'CT', bodyPart: 'Head', contrast: 'Without contrast', priority: 'Urgent', indication: 'Transient right hand weakness and speech difficulty last week; atrial fibrillation without anticoagulation' } },
            { do: 'order', orderType: 'consult', fields: { specialty: 'Neurology', priority: 'Urgent', reason: 'Possible TIA last week (about 20 minutes of right hand clumsiness and jumbled speech) in atrial fibrillation off anticoagulation since the 2023 GI bleed. Please advise on the workup and, with GI, on anticoagulation.' } },
        ], span: 3.5 },
    { id: 'Z14', text: 'The penicillin allergy is updated to anaphylaxis.', acts: [{ do: 'tick', match: ['allergy'] }], span: 1.5 },
    { id: 'Z15', text: 'The family meeting stays on for tomorrow morning.' },
    { id: 'Z16', text: 'Last thing, the H and P. The draft wrote itself while we talked. Let me read it over.', acts: [{ do: 'note', noteType: 'H&P' }], span: 8.0 },
    { id: 'Z17', text: "That's right. Signing it.", acts: [{ do: 'save-note' }], span: 1.5 },
];

// ── assemble the lines in order (01 lines keep their ids and text) ───────
const lines = [];
const isNew = new Set();
for (const l of v1.lines) {
    lines.push({ id: l.id, speaker: l.speaker, text: l.text, v1: l });
    for (const [after, id, text] of THINK) if (after === l.id) { lines.push({ id, speaker: 'doctor', text }); isNew.add(id); }
}
for (const z of ENDING) { lines.push({ id: z.id, speaker: 'doctor', text: z.text, z }); isNew.add(z.id); }
const ids = new Set();
for (const l of lines) { if (ids.has(l.id)) throw new Error('duplicate id ' + l.id); ids.add(l.id); if (l.text.length > 1000) throw new Error('too long ' + l.id); }

// ── voices ───────────────────────────────────────────────────────────────
const dir = path.join(ROOT, AUDIO_DIR);
fs.mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function speak(l) {
    const file = path.join(dir, l.id + '.mp3');
    if (fs.existsSync(file) && fs.statSync(file).size > 2000) return 'kept';
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const r = await fetch(TTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: l.text, voice: VOICES[l.speaker] }) });
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
            const type = r.headers.get('content-type') || '';
            const buf = Buffer.from(await r.arrayBuffer());
            if (!/audio/.test(type) || buf.length < 2000) throw new Error('not audio: ' + type + ' ' + buf.length + ' bytes');
            fs.writeFileSync(file, buf);
            return 'made';
        } catch (e) {
            if (attempt === 5) throw new Error(l.id + ': ' + e.message);
            await sleep(1500 * attempt);
        }
    }
    return 'failed';
}
if (!NO_TTS) {
    const queue = lines.slice();
    const done = { made: 0, kept: 0 };
    await Promise.all([0, 1, 2].map(async () => {
        while (queue.length) {
            const l = queue.shift();
            const how = await speak(l);
            done[how]++;
            if (how === 'made') process.stdout.write('.');
        }
    }));
    console.log('\naudio: ' + done.made + ' made, ' + done.kept + ' kept');
}

// ── timing from the real audio ───────────────────────────────────────────
const durOf = (id) => {
    const out = execFileSync('afinfo', [path.join(dir, id + '.mp3')], { encoding: 'utf8' });
    const m = out.match(/estimated duration: ([\d.]+) sec/);
    if (!m) throw new Error('no duration for ' + id);
    return +(+m[1]).toFixed(2);
};
// The gap after a line: kept from 01 between two 01 lines (the pauses where the
// coworker answers, the exam); for a new line, the gap 01 had before the line it now precedes.
const gap01 = {};
for (let i = 0; i + 1 < v1.lines.length; i++) {
    const a = v1.lines[i], b = v1.lines[i + 1];
    gap01[a.id] = +(b.t - (a.t + a.dur)).toFixed(2);
}
let t = v1.lines[0].t;
const actions = [];
let xn = 0;
for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    l.dur = durOf(l.id);
    if (i > 0) {
        const prev = lines[i - 1];
        let gap;
        if (l.z) gap = l.z.gap != null ? l.z.gap : 0.9;
        else if (isNew.has(l.id)) gap = 0.7;                                   // a thought follows the line before it
        else if (isNew.has(prev.id)) {
            // back to the 01 flow: the gap 01 had before this line
            const before = v1.lines[v1.lines.findIndex((x) => x.id === l.id) - 1];
            gap = Math.max(0.7, gap01[before.id]);
        } else gap = Math.max(0.6, gap01[prev.id]);
        t = +(t + gap).toFixed(2);
        // after a line with actions, wait for them
        if (prev.z && prev.z.acts) t = +(Math.max(t, prev._actsEnd + 0.8)).toFixed(2);
    }
    l.t = t;
    t = +(t + l.dur).toFixed(2);
    if (l.z && l.z.acts) {
        let at = +(t + 1.2).toFixed(2);
        const step = l.z.acts.length > 1 ? 3.0 : 0;
        l.z.acts.forEach((a, k) => {
            actions.push(Object.assign({ id: 'X' + (++xn), t: +(at + k * step).toFixed(2) }, a));
        });
        l._actsEnd = +(at + (l.z.acts.length - 1) * step + (l.z.span || 2)).toFixed(2);
    }
}
const last = lines[lines.length - 1];
const duration_s = +(Math.max(last.t + last.dur, ...actions.map((a) => a.t + 3)) + 2).toFixed(1);

const out = {
    id: 'morrison-admission-02',
    title: 'Robert Morrison: admission for a heart failure flare, with voices, thinking aloud and the orders (scripted, ~' + Math.round(duration_s / 60) + ' min)',
    patient: v1.patient,
    version: 2,
    setting: v1.setting + ' Version 2: the doctor thinks out loud more while working up the plan (T lines, which never catch a planted problem), and after the visit sits at the workstation (Z lines): takes off the orders the coworker flagged, signs the rest, orders safer choices, and signs the H&P. "actions" are what the demo does in the EHR at time t.',
    speakers: v1.speakers,
    duration_s,
    audio: { dir: AUDIO_DIR, voices: VOICES, format: 'mp3' },
    lines: lines.map((l) => ({ id: l.id, t: l.t, dur: l.dur, speaker: l.speaker, text: l.text, audio: l.id + '.mp3' })),
    actions,
    expect: v1.expect,
    quiet: v1.quiet,
    scoring: v1.scoring,
};
fs.writeFileSync(path.join(ROOT, 'data/live/morrison-admission-02.json'), JSON.stringify(out, null, 1) + '\n');
console.log('wrote morrison-admission-02.json: ' + out.lines.length + ' lines, ' + actions.length + ' actions, ' + duration_s + ' s');

// ── the review sheet (for a clinical check) ──────────────────────────────
{
    const s = out;
    const t = (x) => Math.floor(x / 60) + ':' + String(Math.round(x % 60)).padStart(2, '0');
    const who = (sp) => (s.speakers[sp] || sp).split(' (')[0];
    const byCue = {};
    for (const e of s.expect) (byCue[e.cue] = byCue[e.cue] || []).push(e);
    for (const q of s.quiet) (byCue[q.cue] = byCue[q.cue] || []).push(Object.assign({ type: 'quiet' }, q));
    const tag = (e) => (e.type === 'speak' ? (e.level === 'must' ? '🚨 ' : '💡 ') + e.id : e.type === 'answer' ? '💬 ' + e.id : '🤫 ' + e.id);
    const actText = (a) => {
        if (a.do === 'radar-open') return 'Opens "On my radar".';
        if (a.do === 'review-all') return 'Review all: signs every unflagged order on the radar, one form at a time.';
        if (a.do === 'remove') return 'Removes the radar item with "' + a.match.join(' ') + '".';
        if (a.do === 'tick') return 'Ticks off the radar task with "' + a.match.join(' ') + '".';
        if (a.do === 'sign') return 'Signs the radar\'s ' + a.match.join(' ') + ' orders, flagged or not (the doctor has decided), one form at a time.';
        if (a.do === 'note') return 'Opens the ' + a.noteType + ' draft (the live note).';
        if (a.do === 'save-note') return 'Saves the note to the chart (goes to the Notes page).';
        const f = a.fields || {};
        const what = a.orderType === 'medication' ? [f.name, f.dose, f.route, f.frequency].filter(Boolean).join(' ')
            : a.orderType === 'lab' ? (f.name === 'Other' ? f.customName : f.name) + ', ' + f.priority
                : a.orderType === 'imaging' ? f.modality + ' ' + f.bodyPart + ', ' + f.contrast.toLowerCase() + ', ' + f.priority
                    : a.orderType === 'consult' ? f.specialty + ' consult, ' + f.priority
                        : f.details;
        return 'Orders ' + what + (f.notes ? ' (' + f.notes + ')' : '') + '.';
    };
    const isNew = (id) => /^[TZ]\d+$/.test(id);

    const md = [];
    md.push('# ' + s.title, '');
    md.push('Version 2 of the Morrison demo, for a clinical check. Version 1 (morrison-admission-01) stays the benchmark the replays score against; every version 1 line, its planted moments and the expected answers are unchanged here, only the timing moves.', '');
    md.push('Length ' + t(s.duration_s) + ', ' + s.lines.length + ' lines (' + s.lines.filter((l) => /^T/.test(l.id)).length + ' new thinking-aloud lines, ' + s.lines.filter((l) => /^Z/.test(l.id)).length + ' new lines at the workstation), ' + s.actions.length + ' things the demo does in the EHR.', '');
    md.push('## What is new', '');
    md.push('**Voices.** Every line is a recorded voice (Deepgram Aura, made once through the lab\'s speech route and saved with the demo): Dr. Rivera ' + s.audio.voices.doctor + ', Robert ' + s.audio.voices.patient + ', Patricia ' + s.audio.voices.wife + ', the nurse ' + s.audio.voices.nurse + '. The coworker keeps its own voice (aura-2-athena-en). Timing follows the real audio; the pauses where the coworker answers a question are the same as in version 1.', '');
    md.push('**Thinking out loud (T lines).** Dr. Rivera reasons aloud while working up the plan. None of these lines catches a planted problem: the black-stool bleed, the unexplained INR, metformin, the potassium, the TIA, diltiazem, heparin and Zosyn are still missed, and some reasoning leads into them on purpose (T7 into diltiazem, T8 into heparin, T9 into Zosyn).', '');
    md.push('| Time | After | Line |', '|---|---|---|');
    for (const l of s.lines.filter((x) => /^T/.test(x.id))) {
        const i = s.lines.indexOf(l);
        md.push('| ' + t(l.t) + ' | ' + s.lines[i - 1].id + ' | ' + l.id + ': ' + l.text + ' |');
    }
    md.push('', '**At the workstation (Z lines and the actions).** After the visit Dr. Rivera sits down, thinks aloud through the coworker\'s flags and acts in the EHR: takes off the heparin drip, IV diltiazem, potassium chloride and Zosyn; keeps the furosemide (signed even if the coworker flagged it to wait for the labs); signs the rest of the plan with "Review all"; orders digoxin for rate control (rather than amiodarone, which could cardiovert a patient who is not anticoagulated), ceftriaxone and azithromycin (tolerated 2/2021), holds metformin, lowers gabapentin to 300 twice a day (home 300 three times a day), holds aspirin and NSAIDs, starts IV pantoprazole, sends a type and screen and a repeat CBC, consults GI, ticks off the med rec, gets a head CT and a neurology consult for last week\'s episode, plans to ask Patricia about leftover warfarin, ticks off the penicillin allergy update, keeps tomorrow\'s family meeting, then reads and signs the H&P the coworker drafted.', '');
    md.push('| Time | Line or action |', '|---|---|');
    const items = s.lines.filter((x) => /^Z/.test(x.id)).map((l) => ({ t: l.t, text: l.id + ' (Dr. Rivera): ' + l.text }))
        .concat(s.actions.map((a) => ({ t: a.t, text: a.id + ' → ' + actText(a) })))
        .sort((a, b) => a.t - b.t);
    for (const x of items) md.push('| ' + t(x.t) + ' | ' + x.text.replace(/\|/g, '/') + ' |');
    md.push('', 'Please check in particular: the reasoning in T1 to T9 (plausible, and still leaves every trap in place); Z18, diuresis going ahead with a possible GI bleed, the labs drawn alongside; digoxin 0.25 mg IV once for rate control in CKD 3b with no anticoagulation (vs amiodarone); gabapentin 300 mg twice a day for an eGFR around 27; IV pantoprazole 40 mg twice a day; urgent rather than STAT for the head CT and the consults.', '');
    md.push('## The whole conversation', '');
    md.push('Markers: 🚨 the coworker must speak up unprompted (every mode) · 💡 speak up in Lead mode · 💬 a question to the coworker · 🤫 it should stay quiet · ✨ new in version 2 · → something the demo does in the EHR.', '');
    md.push('| Time | Who | Line | Key |', '|---|---|---|---|');
    const rows = s.lines.map((l) => ({ t: l.t, row: '| ' + t(l.t) + ' | ' + who(l.speaker) + ' | ' + (isNew(l.id) ? '✨ ' : '') + l.text.replace(/\|/g, '/') + ' | ' + (byCue[l.id] || []).map(tag).join(' ') + ' |' }))
        .concat(s.actions.map((a) => ({ t: a.t, row: '| ' + t(a.t) + ' | (EHR) | → ' + actText(a).replace(/\|/g, '/') + ' |  |' })))
        .sort((a, b) => a.t - b.t);
    for (const r of rows) md.push(r.row);
    md.push('', '## What the coworker should say (unchanged from version 1)', '');
    for (const e of s.expect.filter((x) => x.type === 'speak')) md.push('- **' + tag(e) + '** (after ' + e.cue + ', within ' + e.window_s + ' s' + (e.level === 'lead' ? '; Lead mode, optional in the others' : '') + '): ' + e.summary);
    md.push('', '## Questions and the answers expected (unchanged)', '');
    for (const q of s.expect.filter((x) => x.type === 'answer')) {
        const line = s.lines.find((l) => l.id === q.cue);
        md.push('- **' + q.id + '** "' + (line ? line.text.replace(/^Coworker, /, '') : q.cue) + '": ' + q.summary);
    }
    md.push('', '## Moments to stay quiet (unchanged)', '');
    for (const q of s.quiet) md.push('- **' + q.id + '** (' + q.cue + '): ' + q.why);
    md.push('', 'Not scored yet: the new lines. The coworker should also stay quiet through T1 to T9 (the doctor\'s own reasoning) and through the workstation lines, where the doctor fixes what it flagged; the orders placed there each get its usual safety check.', '');
    fs.writeFileSync(path.join(ROOT, 'data/live/morrison-admission-02.md'), md.join('\n') + '\n');
    console.log('wrote morrison-admission-02.md (' + md.length + ' lines)');
}
