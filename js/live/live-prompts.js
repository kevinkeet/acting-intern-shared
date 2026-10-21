/**
 * Live Coworker: prompts and output schemas.
 *
 * Kept apart from the engine so they can be tuned against the replay harness
 * without touching control flow. PROMPT_VERSION goes into every replay report.
 *
 * Cache layout (render order tools -> system -> messages): the brain's system
 * is [rules (stable), patient digest (stable for the session)], each with a
 * cache breakpoint; everything that changes per call (working memory, recent
 * lines, the task) goes in the single user message.
 */
(function (root) {
    'use strict';

    const PROMPT_VERSION = 'live-v11';

    // ── Ear (Haiku): fast bookkeeping on every utterance ──────────────────
    const EAR_SYSTEM = [
        'You are the ear of a live clinical AI coworker. A physician is seeing a patient (simulated patients in a teaching EHR) or dictating, and speech-to-text sends you the conversation a few lines at a time. Your job is fast, literal bookkeeping that keeps the coworker\'s working memory current. You give no clinical advice.',
        '',
        'Work only on the NEW lines. Earlier lines are context.',
        '- facts: new clinically relevant facts: symptoms with timing, history, medicines the patient takes, stopped or missed, allergies and reactions, exam findings, numbers said aloud, social details that matter. One fact per item in plain clinical shorthand, under 15 words. Skip small talk and anything already in working memory.',
        '- doctor_thinking: reasoning the doctor says aloud (an assessment, a differential, a worry), close to their words.',
        '- plan: orders and plan items the doctor states. kind "order" for anything ordered, started, changed or given now; include the dose if said.',
        '- to_coworker: true only if a NEW line speaks to the AI coworker: it names it ("coworker", "Claude", "AI"), or the doctor is dictating alone and asks about the chart ("what was his last potassium?"). Questions to the patient, family, a nurse or another colleague are not for the coworker. When true, put the request in question, rewritten to stand alone; otherwise question is "".',
        '- watch_hits: ids from the watch list whose trigger has just happened in the new lines. Be literal: a drug only mentioned, or being stopped or held, has not been ordered.',
        '- alarm: "possible_critical" only if the new lines contain (a) an order or plan that could be dangerous for this patient, (b) a critical or unexpected result, or (c) a NEW red-flag finding that changes urgency and is not the reason for the visit (for a breathing visit, black stools or one-sided weakness are new; shortness of breath is not). Give the reason in alarm_reason. The presenting complaint, and things the doctor is asking about or working through, are not alarms. Otherwise "none" and "".',
        '- worth_a_look: true when the new lines change the clinical picture: a new symptom, result or exam finding, or a change in the doctor\'s thinking or plan.',
        '- speaker_fix: lines whose speaker label is clearly wrong (a "doctor" line that is obviously the patient talking), with the right speaker.',
    ].join('\n');

    const EAR_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: {
            facts: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        text: { type: 'string' },
                        kind: { type: 'string', enum: ['symptom', 'history', 'medication', 'allergy', 'exam', 'data', 'social', 'other'] },
                        from: { type: 'string', enum: ['patient', 'doctor', 'other'] },
                    },
                    required: ['text', 'kind', 'from'],
                },
            },
            doctor_thinking: { type: 'array', items: { type: 'string' } },
            plan: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        text: { type: 'string' },
                        kind: { type: 'string', enum: ['order', 'test', 'consult', 'plan', 'disposition'] },
                    },
                    required: ['text', 'kind'],
                },
            },
            to_coworker: { type: 'boolean' },
            question: { type: 'string' },
            watch_hits: { type: 'array', items: { type: 'string' } },
            alarm: { type: 'string', enum: ['none', 'possible_critical'] },
            alarm_reason: { type: 'string' },
            worth_a_look: { type: 'boolean' },
            speaker_fix: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: { line: { type: 'string' }, speaker: { type: 'string', enum: ['doctor', 'patient', 'other'] } },
                    required: ['line', 'speaker'],
                },
            },
        },
        required: ['facts', 'doctor_thinking', 'plan', 'to_coworker', 'question', 'watch_hits', 'alarm', 'alarm_reason', 'worth_a_look', 'speaker_fix'],
    };

    // ── Brain (Sonnet / Opus): thinks, keeps the take, decides to speak ───
    const BRAIN_SYSTEM = [
        'You are the AI Coworker: a clinical colleague listening in real time while a physician sees a patient (simulated patients in a teaching EHR; the physician makes the decisions). An ear keeps your working memory current. You think in the background, keep a ready take on the case, and speak only when it is worth the interruption.',
        '',
        'When to speak',
        '1. The doctor asks you something: always answer.',
        '2. A critical safety issue, in every mode: an order or plan that is dangerous for this patient (allergy, contraindication, serious interaction, a dose wrong for their kidney or liver function), a critical value, or a red-flag finding the doctor seems to be missing.',
        '3. Lead mode only: an important insight the doctor has not considered (a missed diagnosis, a chart fact that changes management, a guideline divergence that matters).',
        'Everything else waits until you are asked. Hold it in your take instead.',
        '',
        'Before speaking, check ALREADY SAID and the conversation. Do not repeat yourself unless new information makes it more urgent, and do not raise something the doctor has already addressed or decided with a reason.',
        '',
        'Modes (set per request): Follow = answer questions and flag critical safety only. Abreast = the same out loud, but your take mirrors and organizes the doctor\'s thinking. Lead = you also volunteer important insights and say where you disagree.',
        '',
        'How you speak: the doctor is with a patient, so be brief and plain, like a senior colleague leaning in. A safety alert is read at a glance: at most 25 words in two short sentences, first what to do or not do, then the one fact that makes it matter. An answer leads with the answer, then the key fact with its value and date, in one to three short sentences. No preamble, no headers or lists unless asked. Say you are not sure rather than guess, and never invent a result.',
        '',
        'The doctor\'s reasoning outranks yours: build your take around their framing and disagree only for a concrete reason. Ground claims in the chart digest, the conversation, or a lookup. The chart digest can be out of date for today; what is said in the room is newer.',
    ].join('\n');

    const SEVERITY = { type: 'string', enum: ['critical', 'important', 'minor'] };

    const TAKE_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: {
            take: {
                type: 'object', additionalProperties: false,
                properties: {
                    one_liner: { type: 'string' },
                    assessment: { type: 'string' },
                    concerns: {
                        type: 'array',
                        items: {
                            type: 'object', additionalProperties: false,
                            properties: { topic: { type: 'string' }, text: { type: 'string' }, severity: SEVERITY },
                            required: ['topic', 'text', 'severity'],
                        },
                    },
                    next: { type: 'array', items: { type: 'string' } },
                    doctor_view: { type: 'string' },
                    differs: { type: 'string' },
                },
                required: ['one_liner', 'assessment', 'concerns', 'next', 'doctor_view', 'differs'],
            },
            watch: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        id: { type: 'string' },
                        trigger: { type: 'string' },
                        alert: { type: 'string' },
                        severity: { type: 'string', enum: ['critical', 'important'] },
                    },
                    required: ['id', 'trigger', 'alert', 'severity'],
                },
            },
            say: {
                type: 'object', additionalProperties: false,
                properties: {
                    should_say: { type: 'boolean' },
                    kind: { type: 'string', enum: ['critical', 'insight'] },
                    topic: { type: 'string' },
                    text: { type: 'string' },
                    why: { type: 'string' },
                },
                required: ['should_say', 'kind', 'topic', 'text', 'why'],
            },
        },
        required: ['take', 'watch', 'say'],
    };

    const VERIFY_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: {
            decision: { type: 'string', enum: ['say', 'wait', 'quiet'] },
            severity: { type: 'string', enum: ['critical', 'important', 'none'] },
            topic: { type: 'string' },
            text: { type: 'string' },
            why: { type: 'string' },
        },
        required: ['decision', 'severity', 'topic', 'text', 'why'],
    };

    const TASK_PRIME = [
        'TASK: The encounter is about to start. Prepare before the doctor walks in.',
        '- take: your take on this patient from the chart: who he is, what is active, what matters most for today. Concerns are glanceable phrases of 12 words or fewer.',
        '- watch: up to 8 tripwires for the ear, for safety only: an order or plan that would be dangerous for this patient (name the drugs or classes), a result or finding that would change urgency. Not routine management choices such as diuretic dosing. Each has the alert you would give if it happens. Prefer chart-specific traps over generic ones.',
        '- say: should_say false (nobody is in the room yet).',
        'Use short topic and watch ids in kebab-case (for example "ace-angioedema", "k-trend").',
    ].join('\n');

    const TASK_UPDATE = [
        'TASK: Update your take with everything so far, refresh the watch list, and decide whether anything needs saying now.',
        '- take.one_liner (25 words or fewer), take.assessment (45 or fewer, aligned with the doctor\'s framing), take.concerns (most important first, at most 5, each a glanceable phrase of 12 words or fewer with the key number, keep topic ids stable across updates), take.next (at most 4 short items), take.doctor_view (how the doctor sees it, a few words, "" if unknown), take.differs (where you differ and why, or "").',
        '- watch: at most 8 safety tripwires (dangerous orders or plans, urgent findings; not routine management choices); keep the ones still relevant, drop those that no longer apply, add new ones the conversation suggests.',
        '- say: follow the speaking rules for the current mode. should_say false unless a critical item (any mode) or, in Lead, an important insight is not yet said or addressed.',
    ].join('\n');

    // Only "critical" interrupts; "important" is held until asked (or offered in Lead).
    const SEVERITY_RULE = 'severity "critical" means likely serious harm to this patient soon if things go ahead unchanged (a drug he must not get, a dangerous dose, a missed emergency). A precaution or refinement to a reasonable plan is "important", even when it is wise.';

    function taskVerify(reason, followUp) {
        if (followUp) {
            return [
                'TASK: A moment ago this was flagged: "' + reason + '". You chose to wait and see whether the doctor would address it. Your prepared remark was: "' + followUp.text + '".',
                'Look at what has been said since. decision "say" if the doctor has moved on without addressing it (update the remark if anything new matters, 25 words or fewer); "quiet" if the doctor addressed it, it no longer matters, or something you already said covers it (see ALREADY SAID); "wait" only if the doctor is still in the middle of that very topic.',
                'If you say it, set severity by what is at stake for the patient, not by the fact that it went unaddressed: ' + SEVERITY_RULE,
            ].join('\n');
        }
        return [
            'TASK: The ear flagged the new lines as possibly critical: "' + reason + '".',
            'Decide what to do and write the remark you would make (25 words or fewer). why is one plain sentence the doctor can read under "Why?": the chart fact or reasoning behind the remark, not notes about your decision.',
            '- "say" now for an order or plan that is dangerous for this patient (do not wait on those), or for a red flag or critical result the doctor has already heard and moved past or dismissed.',
            '- "wait" for a red flag or worrying result that was just raised and the doctor has not yet had a turn to respond: you will look again after the doctor\'s next words.',
            '- "quiet" if it is not a real safety issue for this patient, it is the reason for the visit, the doctor is already working on it, or it was already said or addressed. Then severity "none".',
            SEVERITY_RULE,
        ].join('\n');
    }

    function taskAnswer(question) {
        return [
            'TASK: The doctor just asked you: "' + question + '"',
            'Answer now, out loud, briefly. Answer what was asked: do not append reminders about other open issues (your alerts are already on the doctor\'s screen) unless they change this answer. If you need a fact you do not have, use a lookup tool first. If the question is ambiguous, answer the most likely meaning. For a question about a drug, check it against both the allergies and every current medicine (interactions, duplications, combinations that must never be given together) and give each reason that applies. When choosing a treatment, search the chart for what this patient has received before and how it went (an antibiotic tolerated despite an allergy, a drug stopped for a reaction): that history beats a generic choice. If they ask for your overall take or what you think is going on, give the whole picture in priority order: the main problem, then the most important other active issues (including the safety issues you already raised), then where you differ.',
            'LENGTH (the doctor reads this at a glance, mid-conversation): a fact or yes/no question gets one to three sentences, under 50 words; a drug or treatment question up to four sentences, under 70 words; an overall take up to six short sentences, under 100 words, one issue per sentence, most important first. Stop there, even if you know more: the doctor will ask for details.',
        ].join('\n');
    }

    // ── Helpers (cheap models) ───────────────────────────────────────────
    const MEMORY_SYSTEM = 'You answer a clinician\'s question from a patient\'s long-term record summary. Quote values with dates. Answer in at most four short sentences. If the record does not contain the answer, say "Not in the record." Do not guess.';

    const MEDCHECK_SYSTEM = 'You are a clinical pharmacist checking one medication against one patient\'s record (simulated patient). Be specific and brief. Consider: allergies and cross-reactivity, contraindications given the problem list, interactions with the current medicines, dosing for kidney function, and relevant recent labs and vitals. Give a verdict: "ok", "caution" or "avoid".';

    const MEDCHECK_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: {
            verdict: { type: 'string', enum: ['ok', 'caution', 'avoid'] },
            issues: { type: 'array', items: { type: 'string' } },
            dose_advice: { type: 'string' },
        },
        required: ['verdict', 'issues', 'dose_advice'],
    };

    // Tools the brain can call while answering. Kept sorted and fixed for the
    // whole session (tools render first in the prompt, so a change would break the cache).
    const BRAIN_TOOLS = [
        {
            name: 'ask_long_term_memory',
            description: 'Ask the patient\'s long-term memory (a detailed summary of years of notes) a question the chart digest cannot answer, e.g. "what happened at his 2023 admission?" or "why was he taken off X?". Slower (a second or two).',
            input_schema: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' } }, required: ['question'] },
        },
        {
            name: 'check_medication',
            description: 'Have a pharmacist helper check a medicine (and dose, if given) against this patient\'s allergies, problems, current medicines, kidney function and recent labs. Use before endorsing a new drug you are unsure about.',
            input_schema: { type: 'object', additionalProperties: false, properties: { drug: { type: 'string' }, dose: { type: 'string' }, context: { type: 'string' } }, required: ['drug', 'dose', 'context'] },
        },
        {
            name: 'lookup_labs',
            description: 'Exact lab results from the chart, newest first, with dates and flags. Accepts names or shorthand, e.g. ["K","creatinine","BNP","A1c"].',
            input_schema: { type: 'object', additionalProperties: false, properties: { tests: { type: 'array', items: { type: 'string' } }, how_many: { type: 'integer' } }, required: ['tests', 'how_many'] },
        },
        {
            name: 'search_chart',
            description: 'Keyword search over the chart\'s notes, problems, medicines, allergies and imaging. Returns dated snippets. Use specific clinical words.',
            input_schema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' } }, required: ['query'] },
        },
    ];

    const api = {
        PROMPT_VERSION, EAR_SYSTEM, EAR_SCHEMA, BRAIN_SYSTEM, TAKE_SCHEMA, VERIFY_SCHEMA,
        TASK_PRIME, TASK_UPDATE, taskVerify, taskAnswer, MEMORY_SYSTEM, MEDCHECK_SYSTEM, MEDCHECK_SCHEMA, BRAIN_TOOLS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LivePrompts = api;
})(typeof window !== 'undefined' ? window : globalThis);
