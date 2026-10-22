/**
 * Live Coworker: a scripted stand-in for the AI models, for UI work and
 * headless UI tests without spending anything. Loaded only when the page has
 * ?livefake (full-site door). It understands just enough of the Morrison demo
 * to produce realistic events with realistic timing: facts from each line,
 * the planted safety moments, canned answers, and a take.
 */
(function (root) {
    'use strict';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const TRAPS = [
        [/almost black/i, 'melena', 'Black stools with his 2023 ulcer bleed and daily aspirin: this could be an upper GI bleed. Worth checking his hemoglobin now.', 'He bled from a gastric ulcer in 9/2023 (Hgb 7.2, 4 units).'],
        [/inr 2\.3\. okay/i, 'inr', 'INR 2.3 is unexplained: warfarin was stopped in 9/2023 and his INR has run about 1.0. With the dark stools and Hgb 10.2 (13.9 in January), ask whether he has leftover warfarin at home.', 'Off warfarin since the 2023 bleed.'],
        [/metformin and the gabapentin/i, 'metformin-renal', 'Hold the metformin: creatinine 2.4 puts his eGFR around 27, below 30. Gabapentin 900 mg a day is also high for his kidneys.', 'Metformin is contraindicated below eGFR 30.'],
        [/potassium chloride/i, 'kcl-hyperk', 'Skip the potassium: K is already 5.1 with the kidney bump, on Entresto.', 'Hyperkalemia risk.'],
        [/words came out/i, 'tia', 'That sounds like a TIA, in AF with no anticoagulation. He needs an urgent neuro workup, and the 2023 conference said to revisit anticoagulation after a TIA.', 'Similar episode in 10/2020.'],
        [/diltiazem/i, 'diltiazem-hfref', 'Avoid IV diltiazem: his EF is 30 to 35%, and it can tip him into worse failure. Amiodarone or digoxin is safer here.', 'Negative inotrope in decompensated HFrEF.'],
        [/heparin drip/i, 'heparin-bleed', 'No heparin drip: anticoagulation was stopped for good after his 2023 ulcer bleed, and he may be bleeding now.', 'Black stools, Hgb 10.2, INR 2.3.'],
        [/start zosyn/i, 'pcn-anaphylaxis', 'Hold the Zosyn: it is a penicillin, and he had penicillin anaphylaxis in 1985. Ceftriaxone with azithromycin was tolerated in 2021.', 'Documented anaphylaxis with epinephrine.'],
    ];
    const ANSWERS = [
        [/creatinine/i, 'About 2.0: 2.03 on January 11 and 1.96 on January 28, eGFR in the mid-30s. So 2.4 today is a modest bump.'],
        [/lisinopril/i, 'No. Lisinopril gave him angioedema in 2018, and an ACE inhibitor can never be combined with Entresto.'],
        [/anticoagulation|anticoagulated/i, 'He had a major gastric ulcer bleed in September 2023 (Hgb 7.2, INR 3.8, four units). A multidisciplinary conference stopped warfarin for good; he declined a Watchman. They planned to revisit after a TIA or stroke, which makes last week\'s episode important.'],
        [/antibiotic/i, 'Ceftriaxone plus azithromycin. He tolerated that combination in February 2021 despite his penicillin anaphylaxis. Avoid Zosyn and other penicillins.'],
        [/take|think/i, 'Heart failure flare from running out of furosemide, likely worsened by the Aleve, with a kidney bump and K 5.1. The bigger worry is a possible upper GI bleed: black stools, Hgb down to 10.2 and an INR of 2.3 off warfarin. Last week\'s episode sounds like a TIA. For the rapid AF I would avoid diltiazem and heparin, and treat the fever with ceftriaxone and azithromycin.'],
    ];
    const TAKE = {
        take: {
            one_liner: '74M with HFrEF (EF 30-35%), CKD 3b and AF off anticoagulation since a 2023 ulcer bleed, admitted with a heart failure flare.',
            assessment: 'Acute on chronic systolic heart failure after running out of furosemide, with a kidney bump.',
            concerns: [
                { topic: 'melena', text: 'Possible upper GI bleed: black stools, Hgb 10.2', severity: 'critical' },
                { topic: 'k-high', text: 'K 5.1 on Entresto and spironolactone', severity: 'important' },
                { topic: 'nsaid', text: 'Daily Aleve: caused the 2023 bleed', severity: 'important' },
            ],
            next: ['Hemoglobin now and in 6 hours', 'Ask about leftover warfarin', 'Telemetry and daily weights'],
            doctor_view: 'Heart failure flare from missed diuretic',
            differs: '',
        },
        watch: [
            { id: 'pcn', trigger: 'An order for a penicillin or piperacillin', alert: 'Penicillin anaphylaxis 1985', severity: 'critical' },
            { id: 'anticoag', trigger: 'Starting heparin or any anticoagulant', alert: 'Stopped after 2023 major bleed', severity: 'critical' },
            { id: 'nondhp', trigger: 'Diltiazem or verapamil', alert: 'EF 30-35%', severity: 'critical' },
            { id: 'ace', trigger: 'Lisinopril or any ACE inhibitor', alert: 'Angioedema; on Entresto', severity: 'critical' },
            { id: 'k', trigger: 'Potassium supplements', alert: 'K 5.1', severity: 'critical' },
        ],
        say: { should_say: false, kind: 'insight', topic: '', text: '', why: '' },
    };

    // The doctor's orders and to-dos in the demo (stand-in for the radar lane), by what was heard.
    const HF = 'Acute on chronic HFrEF, volume overload';
    const RADAR = [
        [/sats above/i, [{ kind: 'order', order_type: 'nursing', title: 'Oxygen to keep SpO2 above 92%', fields: { orderType: 'Other', details: 'Titrate oxygen to keep SpO2 above 92%', priority: 'Routine' } }]],
        [/furosemide 80/i, [
            { kind: 'order', order_type: 'medication', title: 'Furosemide 80 mg IV now', fields: { name: 'Furosemide', dose: '80 mg', route: 'IV Push', frequency: 'Once', indication: HF } },
            { kind: 'order', order_type: 'medication', title: 'Furosemide 40 mg IV twice daily', fields: { name: 'Furosemide', dose: '40 mg', route: 'IV Push', frequency: 'BID', indication: HF } },
            { kind: 'order', order_type: 'nursing', title: 'Strict I&O and daily weights', fields: { orderType: 'I&O Monitoring', details: 'Strict I&O, daily weights', priority: 'Routine' } },
            { kind: 'order', order_type: 'nursing', title: '2 g sodium diet, fluid restriction', fields: { orderType: 'Diet', details: '2 g sodium diet, fluid restriction', priority: 'Routine' } },
            { kind: 'order', order_type: 'nursing', title: 'Telemetry', fields: { orderType: 'Other', details: 'Continuous telemetry', priority: 'Routine' } },
        ]],
        [/repeat bmp/i, [
            { kind: 'order', order_type: 'lab', title: 'BMP in the morning', fields: { name: 'BMP', specimen: 'Blood', priority: 'Routine', indication: 'Diuresis, AKI on CKD 3b', notes: 'AM labs' } },
            { kind: 'order', order_type: 'lab', title: 'Magnesium in the morning', fields: { name: 'Magnesium', specimen: 'Blood', priority: 'Routine', indication: 'Diuresis', notes: 'AM labs' } },
            { kind: 'order', order_type: 'procedure', title: 'EKG now', fields: { name: '12-lead EKG', priority: 'STAT', indication: 'Atrial fibrillation, heart failure' } },
        ]],
        [/hold the spironolactone/i, [
            { kind: 'order', order_type: 'nursing', title: 'Hold spironolactone tonight', fields: { orderType: 'Other', details: 'Hold spironolactone tonight (K 5.1, kidney bump)', priority: 'Routine' } },
            { kind: 'task', title: 'Continue carvedilol and Entresto', next: 'Mark them continued in the admission med rec' },
        ]],
        [/continue the rest/i, [{ kind: 'task', title: 'Continue his other home medicines', next: 'Admission med rec, including metformin and gabapentin' }]],
        [/potassium chloride/i, [{ kind: 'order', order_type: 'medication', title: 'Potassium chloride 40 mEq PO once', fields: { name: 'Potassium chloride', dose: '40 mEq', route: 'PO', frequency: 'Once', indication: 'Replacement during diuresis' } }]],
        [/diltiazem/i, [{ kind: 'order', order_type: 'medication', title: 'Diltiazem 10 mg IV push now', fields: { name: 'Diltiazem', dose: '10 mg', route: 'IV Push', frequency: 'Once', indication: 'AF with rapid ventricular response' } }]],
        [/heparin drip/i, [{ kind: 'order', order_type: 'medication', title: 'Heparin drip for AF', fields: { name: 'Heparin', route: 'IV', frequency: 'Continuous', indication: 'Atrial fibrillation' } }]],
        [/start zosyn/i, [{ kind: 'order', order_type: 'medication', title: 'Zosyn (piperacillin-tazobactam) IV', fields: { name: 'Piperacillin-tazobactam', route: 'IV Piggyback', indication: 'Possible pneumonia' }, next: 'Choose the dose and frequency' }]],
        [/penicillin as a serious/i, [{ kind: 'task', title: 'Update allergy: penicillin, anaphylaxis', next: 'Add penicillin anaphylaxis (1985, needed epinephrine) to the allergy list' }]],
        [/look into those dark stools/i, [{ kind: 'task', title: 'Work up the dark stools', next: 'Rectal exam, repeat hemoglobin, type and screen' }]],
        [/sit down together/i, [
            { kind: 'task', title: 'Family meeting tomorrow morning', next: 'With Bob and Patricia: goals of care and code status' },
            { kind: 'note', title: 'Goals-of-care note', note_type: 'Goals of Care Note', draft: 'Mr. Morrison said that if it comes to that, he does not want to be kept alive on machines. His wife Patricia was present; they have not talked about this before. Plan: meet tomorrow morning with both of them to talk about what matters to him and his code status.' },
        ]],
        // Not in the demo script; the UI test says them to try a consult and a message.
        [/neurology to see him/i, [{ kind: 'consult', title: 'Neurology consult: possible TIA', fields: { specialty: 'Neurology', priority: 'Urgent', reason: 'Transient right hand weakness and jumbled speech last week, in AF off anticoagulation. Possible TIA.' } }]],
        [/let the nurse know/i, [{ kind: 'message', title: 'Ask the nurse to call for HR over 130', to: 'nurse', draft: 'Please call me if his heart rate stays above 130 or his pressure drops below 100 systolic.' }]],
    ];
    const RADAR_FLAGS = [
        [/zosyn|piperacillin/i, /zosyn|penicillin/i, 'Penicillin anaphylaxis in 1985'],
        [/heparin/i, /heparin/i, 'Anticoagulation stopped after the 2023 bleed'],
        [/diltiazem/i, /diltiazem/i, 'EF 30-35%: can worsen the heart failure'],
        [/potassium/i, /potassium/i, 'K is already 5.1 on Entresto'],
        [/home medicines/i, /metformin/i, 'Metformin with eGFR about 27'],
    ];
    function fakeRadar(user) {
        const sect = (name) => ((user.match(new RegExp('<' + name + '>(.*?)</' + name + '>', 's')) || [])[1] || '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
        const listed = sect('on_my_radar').split('\n').map((l) => l.match(/^(A\d+) \[(\w+)([^\]]*)\] [^:]+: (.*?)(?: · said \w+)?$/)).filter(Boolean)
            .map((m) => ({ id: m[1], status: m[2], flagged: /flag:/.test(m[3]), title: m[4] }));
        const alerts = sect('open_safety_alerts').split('\n').map((l) => l.match(/^- (S\d+) \[[^\]]*\] (.*)$/)).filter(Boolean).map((m) => ({ id: m[1], text: m[2] }));
        const fill = (x, line) => ({
            id: '', kind: x.kind, title: x.title, order_type: x.order_type || (x.kind === 'consult' ? 'consult' : 'none'),
            fields: Object.entries(x.fields || {}).map(([key, value]) => ({ key, value })), to: x.to || '', note_type: x.note_type || '', draft: x.draft || '',
            next: x.next || '', status: 'todo', flag: '', alert: '', line,
        });
        const changes = [];
        for (const p of sect('new_plan_items').split('\n')) {
            const m = p.match(/^P\d+ \[\w+, heard by (L\d+)\] (.*)$/);
            if (!m) continue;
            const hit = RADAR.find(([re]) => re.test(m[2]));
            if (hit) for (const x of hit[1]) if (!listed.some((l) => l.title === x.title)) changes.push(fill(x, m[1]));
        }
        // Flag what an open safety alert is about.
        for (const item of listed.filter((l) => l.status === 'todo' && !l.flagged).concat(changes.map((c) => ({ title: c.title, change: c })))) {
            const f = RADAR_FLAGS.find(([re]) => re.test(item.title));
            const a = f && alerts.find((x) => f[1].test(x.text));
            if (!a) continue;
            if (item.change) Object.assign(item.change, { flag: f[2], alert: a.id });
            else {
                const x = RADAR.flatMap((r) => r[1]).find((y) => y.title === item.title);
                if (x) changes.push(Object.assign(fill(x, ''), { id: item.id, flag: f[2], alert: a.id }));
            }
        }
        return { changes };
    }

    // A note that grows with what has been said (stand-in for the scribe).
    function fakeNote(conv) {
        const has = (re) => re.test(conv);
        const bg = '74-year-old man with ischemic HFrEF (EF 30-35%), CKD 3b and persistent AF off anticoagulation since a 2023 ulcer bleed';
        let pr = bg + (has(/breath/i) ? ', presenting with a week of worsening dyspnea, orthopnea and leg swelling' : ', admitted from the ED');
        if (has(/ran out/i)) pr += ' after six days without furosemide';
        pr += '.';
        if (has(/almost black|dark/i)) pr += ' New dark stools' + (has(/Hemoglobin 10\.2/i) ? ' with Hgb 10.2 (13.9 in January)' : '') + (has(/INR 2\.3/i) ? ' and an unexplained INR of 2.3' : '') + ' raise concern for a recurrent upper GI bleed.';
        const hpi = [];
        if (has(/catch my breath/i)) hpi.push('Mr. Morrison reports a week of progressive shortness of breath.');
        if (has(/lie down flat/i)) hpi.push('He cannot lie flat and has been sleeping in a recliner, waking two to three times a night short of breath.');
        if (has(/tree trunks|shoes don/i)) hpi.push('His legs have swollen; his wife reports a ten-pound weight gain.');
        if (has(/ran out/i)) hpi.push('He ran out of furosemide about six days ago while his wife was away.');
        if (has(/mailbox/i)) hpi.push('He notes chest tightness walking to the mailbox, none at rest.');
        if (has(/almost black/i)) hpi.push('He reports several days of very dark, almost black stools and a sour stomach.');
        if (has(/Aleve/i)) hpi.push('He takes Aleve two to three times a day for knee pain.');
        if (has(/clumsy/i)) hpi.push('His wife describes about twenty minutes of right hand clumsiness and jumbled speech last Tuesday that resolved.');
        const problems = [];
        if (has(/breath|furosemide/i)) problems.push({ name: 'Acute on chronic HFrEF', assessment: 'Volume overload after a lapse in furosemide, likely worsened by NSAIDs.', plan: [has(/furosemide 80/i) ? 'IV furosemide 80 mg now, then 40 mg IV twice daily' : '', has(/ins and outs|daily weights/i) ? 'Strict ins and outs, daily weights, 2 g sodium' : ''].filter(Boolean), consider: [] });
        if (has(/almost black|dark stools/i)) problems.push({ name: 'Possible upper GI bleed', assessment: 'Melena on aspirin and naproxen with a prior ulcer bleed.', plan: [], consider: ['Rectal exam, CBC and type and screen'] });
        if (has(/creatinine 2\.4|kidney/i)) problems.push({ name: 'AKI on CKD 3b with K 5.1', assessment: 'Creatinine 2.4 from about 2.0, likely cardiorenal.', plan: [has(/spironolactone tonight/i) ? 'Hold spironolactone' : '', has(/BMP and magnesium/i) ? 'Repeat BMP and magnesium in the morning' : ''].filter(Boolean), consider: has(/potassium chloride/i) ? ['Skip the potassium chloride'] : [] });
        if (has(/clumsy/i)) problems.push({ name: 'Possible TIA', assessment: 'Transient right hand weakness and speech change in AF without anticoagulation.', plan: [], consider: ['Head imaging and neurology'] });
        if (has(/142/)) problems.push({ name: 'AF with rapid ventricular response', assessment: 'Rate 142 during decompensation.', plan: [has(/diltiazem/i) ? 'IV diltiazem 10 mg (ordered)' : ''].filter(Boolean), consider: has(/diltiazem/i) ? ['Amiodarone instead of diltiazem'] : [] });
        return { problem_representation: pr, hpi: hpi.join(' '), problems };
    }

    function reply(obj, ms) {
        const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
        const usage = { input_tokens: 900, cache_read_input_tokens: 5200, output_tokens: Math.round(text.length / 4) };
        return { message: { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage, model: 'fake' }, text, usage, cost: 0, ms: { ttft: Math.round(ms * 0.4), total: ms }, servedBy: 'fake', fellBack: false };
    }

    function createTransport() {
        let updates = 0;
        return {
            async callWithRetry(req, hooks) {
                // LiveFake.failing = true: every call fails like an overloaded API (tests the "not checking" state).
                if (root.LiveFake && root.LiveFake.failing) {
                    await sleep(300);
                    throw Object.assign(new Error('AI call failed (529): Overloaded'), { name: 'LiveApiError', status: 529, retryable: true });
                }
                const user = JSON.stringify(req.body.messages);
                if (req.label === 'ear') {
                    await sleep(550 + Math.random() * 300);
                    const nl = ((user.match(/<new_lines>(.*?)<\/new_lines>/s) || [])[1] || '').replace(/\\n/g, '\n');
                    const lines = nl.split('\n').filter(Boolean);
                    const facts = lines.filter((l) => /PATIENT|OTHER/.test(l)).map((l) => ({ text: l.replace(/^L\d+ \[[^\]]+\] \w+: /, '').slice(0, 90), kind: /stool|breath|swell|tight|cough|dizzy/i.test(l) ? 'symptom' : /aleve|pill|furosemide|penicillin|sulfa/i.test(l) ? 'medication' : 'history', from: /PATIENT/.test(l) ? 'patient' : 'other' }));
                    const exam = lines.filter((l) => /JVP|crackles|sodium/i.test(l)).map((l) => ({ text: l.replace(/^L\d+ \[[^\]]+\] \w+: /, '').slice(0, 110), kind: /sodium/i.test(l) ? 'data' : 'exam', from: 'doctor' }));
                    const think = lines.filter((l) => /so this is|probably a big part/i.test(l)).map((l) => l.replace(/^L\d+ \[[^\]]+\] \w+: /, ''));
                    const plan = lines.filter((l) => /DOCTOR: .*(sats above|furosemide 80|push|start a heparin|start zosyn|potassium chloride|hold the spironolactone|repeat bmp|continue the rest|penicillin as a serious|look into those dark stools|sit down together|neurology to see him|let the nurse know)/i.test(l))
                        .map((l) => ({ text: l.replace(/^L\d+ \[[^\]]+\] \w+: /, ''), kind: /neurology/i.test(l) ? 'consult' : /nurse know/i.test(l) ? 'message' : /penicillin as|dark stools|sit down|continue the rest/i.test(l) ? 'task' : 'order' }));
                    const trap = TRAPS.find(([re]) => re.test(nl));
                    const q = /coworker,/i.test(nl);
                    return reply({ facts: facts.concat(exam), doctor_thinking: think, plan, to_coworker: q, question: q ? nl.replace(/^.*coworker,\s*/i, '') : '', watch_hits: [], alarm: trap ? 'possible_critical' : 'none', alarm_reason: trap ? trap[1] : '', worth_a_look: !!(think.length || plan.length), speaker_fix: [] }, 700);
                }
                if (req.label === 'verify') {
                    await sleep(1500 + Math.random() * 700);
                    const reason = (user.match(/possibly critical: \\"(.*?)\\"/) || [])[1] || '';
                    const t = TRAPS.find((x) => x[1] === reason);
                    // The INR and heparin points belong to the GI bleed card while it is open.
                    const open = (user.split('OPEN SAFETY ALERTS')[1] || '').split('ALREADY SAID')[0];
                    const gi = /^(inr|heparin-bleed)$/.test(reason) && open.match(/- (S\d+) \[[^\]]*\] Black stools/);
                    return reply({ decision: t ? 'say' : 'quiet', severity: t ? 'critical' : 'none', topic: reason, text: t ? t[2] : '', why: t ? t[3] : '', update_of: gi ? gi[1] : '' }, 1900);
                }
                if (req.label === 'answer') {
                    const q = (user.match(/just asked you: \\"(.*?)\\"/) || [])[1] || '';
                    const a = (ANSWERS.find(([re]) => re.test(q)) || [null, 'I am not sure; let me check the chart.'])[1];
                    await sleep(900);
                    let out = '';
                    for (const w of a.split(' ')) { out += (out ? ' ' : '') + w; if (hooks && hooks.onText) hooks.onText((out === w ? '' : ' ') + w, 0); await sleep(35); }
                    return reply(a, 900 + a.split(' ').length * 35);
                }
                if (req.label === 'helper') { await sleep(800); return reply('{"verdict":"ok","issues":[],"dose_advice":""}', 800); }
                if (req.label === 'actions') {
                    await sleep(900);
                    return reply(fakeRadar(user), 900);
                }
                if (req.label === 'note') {
                    await sleep(1200);
                    const conv = ((user.match(/<conversation>(.*?)<\/conversation>/s) || [])[1] || '').replace(/\\n/g, '\n');
                    return reply(fakeNote(conv), 1200);
                }
                await sleep(req.label === 'prime' ? 3500 : 2600);
                updates++;
                const t = JSON.parse(JSON.stringify(TAKE));
                if (updates > 3) t.take.differs = 'I would hold the aspirin until the bleeding question is settled.';
                return reply(t, 3000);
            },
        };
    }

    root.LiveFake = { createTransport, failing: false };
})(typeof window !== 'undefined' ? window : globalThis);
