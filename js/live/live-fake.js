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
                    const plan = lines.filter((l) => /DOCTOR: .*(furosemide 80|push|start a heparin|start zosyn|potassium chloride|hold the spironolactone|repeat bmp)/i.test(l)).map((l) => ({ text: l.replace(/^L\d+ \[[^\]]+\] \w+: /, '').slice(0, 100), kind: 'order' }));
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
