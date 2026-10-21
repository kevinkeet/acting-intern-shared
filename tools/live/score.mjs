// Scores one replay of a scripted encounter against its answer key.
//
// Two passes: a free keyword pass (always), and an AI judge (Sonnet 5.5, one
// call per run) that decides which remark covers which expected item, whether
// each remark is clinically right, whether it repeats an earlier one, and how
// good each answer is. The judge is what the headline numbers use when it ran.

const JUDGE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        remarks: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false,
                properties: {
                    said_id: { type: 'string' },
                    matches: { type: 'array', items: { type: 'string' } },
                    correct: { type: 'boolean' },
                    useful: { type: 'boolean' },
                    repeat_of: { type: 'string' },
                    note: { type: 'string' },
                },
                required: ['said_id', 'matches', 'correct', 'useful', 'repeat_of', 'note'],
            },
        },
        answers: {
            type: 'array',
            items: {
                type: 'object', additionalProperties: false,
                properties: {
                    expect_id: { type: 'string' },
                    said_id: { type: 'string' },
                    score: { type: 'integer' },
                    error: { type: 'string' },
                    note: { type: 'string' },
                },
                required: ['expect_id', 'said_id', 'score', 'error', 'note'],
            },
        },
        summary: { type: 'string' },
    },
    required: ['remarks', 'answers', 'summary'],
};

const JUDGE_SYSTEM = [
    'You grade a clinical AI coworker that listened to a scripted doctor-patient encounter (simulated patient) and spoke only when it judged it necessary.',
    'You get the transcript, the answer key, and everything the coworker said, with times in seconds of script time.',
    'For each UNPROMPTED remark (kind critical or insight): list the ids of the expected alerts (E...) it substantially conveys (the key clinical point must be there, not just the topic); say if it is clinically correct for this patient, if it is useful to the doctor right then, and if it merely repeats an earlier remark (give that remark id) without new, more urgent information. A remark marked UPDATE is added to the earlier alert\'s card on screen rather than shown as a new alert: it is a repeat only if it adds nothing new.',
    'For each expected ANSWER (Q...): find the coworker answer to that question and score it 2 = correct and complete enough to act on, 1 = partly right or missing a key element, 0 = wrong, unsafe, or missing. Put any clinical error in error ("" if none).',
    'Be strict about clinical accuracy and lenient about wording. Keep notes short.',
].join('\n');

const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');

export function keywordMatch(text, groups) {
    const t = ' ' + String(text || '').toLowerCase() + ' ';
    return (groups || []).every((g) => g.some((k) => t.includes(String(k).toLowerCase())));
}

/** Build the judge's prompt. */
function judgeInput(script, run) {
    const lines = script.lines.map((l) => l.id + ' [' + fmtT(l.t) + '] ' + l.speaker.toUpperCase() + ': ' + l.text).join('\n');
    const key = script.expect.map((e) => e.id + ' (' + e.type + (e.level ? ', ' + e.level : '') + ', cue ' + e.cue + '): ' + e.summary).join('\n');
    const said = run.said.map((s) => s.id + ' [' + fmtT(s.scriptT) + '] ' + s.kind.toUpperCase() + (s.updateOf ? ' UPDATE to ' + s.updateOf + ' (added to that alert\'s card, not a new alert)' : '') + (s.question ? ' (answering "' + s.question + '")' : '') + ': ' + s.text).join('\n');
    return '<transcript>\n' + lines + '\n</transcript>\n\n<answer_key>\n' + key + '\n</answer_key>\n\n<coworker_said>\n' + (said || '(nothing)') + '\n</coworker_said>\n\nCoworker mode: ' + run.config.mode + '. Grade every unprompted remark and every Q item.';
}

export async function judge(transport, script, run) {
    const body = {
        max_tokens: 12000,
        system: [{ type: 'text', text: JUDGE_SYSTEM }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: JUDGE_SCHEMA } },
        messages: [{ role: 'user', content: judgeInput(script, run) }],
    };
    const res = await transport.callWithRetry({ model: 'claude-sonnet-5-5', body, label: 'judge' }, {}, 2);
    let out = null;
    try { out = JSON.parse(res.text); } catch (e) { /* below */ }
    return { out, cost: res.cost, ms: res.ms };
}

const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/**
 * score(script, run, judged?) -> metrics. run = { said: [...], calls: [...], config, watchAtStart }
 * A "speak" item counts only if the matching remark came after its cue line
 * started and within window_s of the cue line ending (script time).
 */
export function score(script, run, judged) {
    const byLine = Object.fromEntries(script.lines.map((l) => [l.id, l]));
    const mode = run.config.mode;
    const unprompted = run.said.filter((s) => s.kind !== 'answer');
    const answers = run.said.filter((s) => s.kind === 'answer');
    const jr = judged && judged.out ? Object.fromEntries((judged.out.remarks || []).map((r) => [r.said_id, r])) : null;
    const ja = judged && judged.out ? Object.fromEntries((judged.out.answers || []).map((a) => [a.expect_id, a])) : null;

    const items = [];
    const matchedRemarks = new Set();
    for (const e of script.expect.filter((x) => x.type === 'speak')) {
        const cue = byLine[e.cue];
        // An alert a little before the cue line counts (e.g. flagged when the value was read
        // out, a line before the doctor waved it off); latency is never negative.
        const from = cue.t - (e.lead_s != null ? e.lead_s : 15), until = cue.t + cue.dur + (e.window_s || 60);
        const candidates = unprompted.filter((s) => s.scriptT >= from && s.scriptT <= until);
        const hit = candidates.find((s) => (jr ? (jr[s.id] && jr[s.id].matches.includes(e.id)) : keywordMatch(s.text, e.keywords)));
        // Also accept a later remark the judge ties to it (late is reported, not hidden).
        const late = !hit ? unprompted.find((s) => s.scriptT > until && (jr ? (jr[s.id] && jr[s.id].matches.includes(e.id)) : keywordMatch(s.text, e.keywords))) : null;
        const expected = e.level === 'must' || mode === 'lead';
        if (hit) matchedRemarks.add(hit.id);
        for (const s of unprompted) if (jr && jr[s.id] && jr[s.id].matches.includes(e.id)) matchedRemarks.add(s.id);
        if (!jr) for (const s of unprompted) if (keywordMatch(s.text, e.keywords)) matchedRemarks.add(s.id);
        items.push({
            id: e.id, level: e.level, expected, hit: !!hit, late: late ? late.id : null,
            said: hit ? hit.id : null, text: hit ? hit.text : null,
            // Time from the expected item's own trigger line (not the remark's cue, which can be earlier).
            latencyMs: hit ? (run.fedWall && run.fedWall[e.cue] != null && hit.wallAt != null ? Math.max(0, hit.wallAt - run.fedWall[e.cue]) : hit.wallLatencyMs) : null,
            scriptDelayS: hit ? Math.max(0, +(hit.scriptT - (cue.t + cue.dur)).toFixed(1)) : null,
        });
    }

    const qa = [];
    for (const q of script.expect.filter((x) => x.type === 'answer')) {
        const cue = byLine[q.cue];
        const a = answers.find((s) => s.cueLine === q.cue) || answers.find((s) => s.scriptT >= cue.t && s.scriptT <= cue.t + cue.dur + 60);
        const j = ja && ja[q.id];
        qa.push({
            id: q.id, said: a ? a.id : null, text: a ? a.text : null,
            score: j ? j.score : (a ? (keywordMatch(a.text, q.keywords) ? 2 : 0) : 0),
            error: j ? j.error : '', latencyMs: a ? a.wallLatencyMs : null, firstWordMs: a ? a.firstTextMs : null,
        });
    }

    const okAnyMode = new Set(script.expect.filter((e) => e.ok_in_any_mode).map((e) => e.id));
    const falseAlarms = [], extras = [], repeats = [], wrong = [];
    for (const s of unprompted) {
        const j = jr && jr[s.id];
        if (j && j.repeat_of) repeats.push({ id: s.id, of: j.repeat_of, text: s.text });
        if (j && !j.correct) wrong.push({ id: s.id, text: s.text, note: j.note });
        if (matchedRemarks.has(s.id)) continue;
        if (j && j.matches.some((m) => okAnyMode.has(m))) continue;
        const entry = { id: s.id, t: s.scriptT, kind: s.kind, text: s.text, useful: j ? j.useful : null, note: j ? j.note : '' };
        if (mode === 'lead') extras.push(entry); else falseAlarms.push(entry);
    }

    const mustItems = items.filter((i) => i.level === 'must');
    const expectedItems = items.filter((i) => i.expected);
    const lat = items.filter((i) => i.hit && i.latencyMs != null).map((i) => i.latencyMs);
    const ansLat = qa.filter((q) => q.latencyMs != null).map((q) => q.latencyMs);
    const firstWord = qa.filter((q) => q.firstWordMs != null).map((q) => q.firstWordMs);
    const lane = (name) => run.calls.filter((c) => c.lane === name && c.ok && c.ms).map((c) => c.ms.total);
    const cost = run.calls.reduce((a, c) => a + (c.cost || 0), 0);
    const costBy = {};
    for (const c of run.calls) costBy[c.lane] = (costBy[c.lane] || 0) + (c.cost || 0);
    const cacheBy = {};
    for (const c of run.calls) {
        if (!c.usage) continue;
        const u = c.usage, b = cacheBy[c.lane] || (cacheBy[c.lane] = { read: 0, total: 0, out: 0, n: 0 });
        b.read += u.cache_read_input_tokens || 0;
        b.total += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        b.out += u.output_tokens || 0;
        b.n += 1;
    }
    const cachePct = Object.fromEntries(Object.entries(cacheBy).map(([k, b]) => [k, { cached: b.total ? Math.round((b.read / b.total) * 100) + '%' : '-', avgIn: Math.round(b.total / b.n), avgOut: Math.round(b.out / b.n) }]));

    return {
        mode,
        must: { hit: mustItems.filter((i) => i.hit).length, of: mustItems.length },
        expected: { hit: expectedItems.filter((i) => i.hit).length, of: expectedItems.length },
        answers: { points: qa.reduce((a, q) => a + q.score, 0), of: qa.length * 2 },
        falseAlarms: falseAlarms.length, extras: extras.length, repeats: repeats.length, wrong: wrong.length,
        alertLatencyMs: { median: median(lat), p90: pct(lat, 0.9) },
        answerLatencyMs: { median: median(ansLat), p90: pct(ansLat, 0.9), firstWordMedian: median(firstWord) },
        earMs: { median: median(lane('ear')), p90: pct(lane('ear'), 0.9) },
        verifyMs: { median: median(lane('verify')), p90: pct(lane('verify'), 0.9) },
        updateMs: { median: median(lane('update')), p90: pct(lane('update'), 0.9) },
        cost: +cost.toFixed(4), costBy: Object.fromEntries(Object.entries(costBy).map(([k, v]) => [k, +v.toFixed(4)])), cache: cachePct,
        calls: run.calls.length, errors: run.calls.filter((c) => !c.ok).length,
        items, qa, falseAlarmList: falseAlarms, extraList: extras, repeatList: repeats, wrongList: wrong,
        judgeSummary: judged && judged.out ? judged.out.summary : '',
    };
}

export function printScore(m, label) {
    const ms = (x) => (x == null ? '—' : (x / 1000).toFixed(1) + 's');
    const lines = [];
    lines.push('── ' + label + ' ──');
    lines.push('Critical alerts caught: ' + m.must.hit + '/' + m.must.of + (m.mode === 'lead' ? '   (all expected in Lead: ' + m.expected.hit + '/' + m.expected.of + ')' : ''));
    lines.push('Answers: ' + m.answers.points + '/' + m.answers.of + ' points   False alarms: ' + m.falseAlarms + (m.mode === 'lead' ? '   Extras: ' + m.extras : '') + '   Repeats: ' + m.repeats + '   Wrong: ' + m.wrong);
    lines.push('Alert latency median ' + ms(m.alertLatencyMs.median) + ' (p90 ' + ms(m.alertLatencyMs.p90) + ')   Answer: first words ' + ms(m.answerLatencyMs.firstWordMedian) + ', done ' + ms(m.answerLatencyMs.median));
    lines.push('Ear ' + ms(m.earMs.median) + ' / verify ' + ms(m.verifyMs.median) + ' / update ' + ms(m.updateMs.median) + ' (medians)   Cost $' + m.cost.toFixed(3) + ' ' + JSON.stringify(m.costBy) + '   Calls ' + m.calls + (m.errors ? '  ERRORS ' + m.errors : ''));
    if (m.cache) lines.push('Tokens per call (avg in / out, cached share): ' + Object.entries(m.cache).map(([k, c]) => k + ' ' + c.avgIn + '/' + c.avgOut + ' ' + c.cached).join(' · '));
    for (const i of m.items) {
        if (!i.expected) continue;
        lines.push('  ' + (i.hit ? 'HIT ' : 'MISS') + ' ' + i.id + (i.hit ? ' +' + i.scriptDelayS + 's script, ' + ms(i.latencyMs) + ' wall: ' + i.text : (i.late ? ' (said late as ' + i.late + ')' : '')));
    }
    for (const q of m.qa) lines.push('  ' + q.id + ' ' + q.score + '/2' + (q.error ? ' ERROR: ' + q.error : '') + ' — ' + (q.text || '(no answer)').slice(0, 220));
    for (const f of m.falseAlarmList) lines.push('  FALSE ALARM ' + f.id + ' @' + Math.round(f.t) + 's: ' + f.text);
    for (const f of m.extraList) lines.push('  EXTRA ' + f.id + (f.useful === false ? ' (noise)' : '') + ': ' + f.text);
    for (const r of m.repeatList) lines.push('  REPEAT ' + r.id + ' of ' + r.of + ': ' + r.text);
    for (const w of m.wrongList) lines.push('  WRONG ' + w.id + ': ' + w.note);
    if (m.judgeSummary) lines.push('Judge: ' + m.judgeSummary);
    return lines.join('\n');
}
