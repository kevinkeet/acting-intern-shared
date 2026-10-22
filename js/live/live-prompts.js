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

    const PROMPT_VERSION = 'live-v19';

    // ── Ear (Haiku): fast bookkeeping on every utterance ──────────────────
    const EAR_SYSTEM = [
        'You are the ear of a live clinical AI coworker. A physician is seeing a patient (simulated patients in a teaching EHR) or dictating, and speech-to-text sends you the conversation a few lines at a time. Your job is fast, literal bookkeeping that keeps the coworker\'s working memory current. You give no clinical advice.',
        '',
        'Work only on the NEW lines. Earlier lines are context.',
        '- facts: new clinically relevant facts: symptoms with timing, history, medicines the patient takes, stopped or missed, allergies and reactions, exam findings, numbers said aloud, social details that matter. One fact per item in plain clinical shorthand, under 15 words. Skip small talk and anything already in working memory.',
        '  Lines marked "dictating the exam" are the doctor dictating physical exam findings for the note: record each finding as an exam fact from the doctor.',
        '- doctor_thinking: reasoning the doctor says aloud (an assessment, a differential, a worry), close to their words.',
        '- plan: orders and plan items the doctor states, close to their words. kind "order" for anything ordered, started, changed, held or given now (include the dose if said); "test" for labs, imaging and other tests; "consult" for a specialist asked to see the patient; "referral" for an outpatient referral; "message" for something to tell or send someone (the nurse, the PCP, the family, pharmacy); "note" for a note to write; "task" for any other to-do (update the allergy list, set up a family meeting); "cancel" when the doctor takes back or changes an earlier order or plan ("no lisinopril then", "hold off on the heparin").',
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
                        kind: { type: 'string', enum: ['order', 'test', 'consult', 'referral', 'message', 'note', 'task', 'cancel', 'plan', 'disposition'] },
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
                    update_of: { type: 'string' },
                },
                required: ['should_say', 'kind', 'topic', 'text', 'why', 'update_of'],
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
            update_of: { type: 'string' },
        },
        required: ['decision', 'severity', 'topic', 'text', 'why', 'update_of'],
    };

    const TASK_PRIME = [
        'TASK: The encounter is about to start. Prepare before the doctor walks in.',
        '- take: your take on this patient from the chart: who he is, what is active, what matters most for today. Concerns are glanceable phrases of 12 words or fewer.',
        '- watch: up to 8 tripwires for the ear, for safety only: an order or plan that would be dangerous for this patient (name the drugs or classes), a result or finding that would change urgency. Not routine management choices such as diuretic dosing. Each has the alert you would give if it happens. Prefer chart-specific traps over generic ones.',
        '- say: should_say false (nobody is in the room yet).',
        'Use short topic and watch ids in kebab-case (for example "ace-angioedema", "k-trend").',
    ].join('\n');

    // A new point about a problem already on the doctor's screen is an update to that card.
    const SAME_PROBLEM_RULE = 'If it is about the same clinical problem as one of the OPEN SAFETY ALERTS (the same diagnosis or danger: e.g. the possible GI bleed, the fast AF, the penicillin allergy, the possible TIA), set update_of to that alert\'s id and write only what is new; if it adds nothing new, do not say it. A different drug or decision with its own reason (e.g. metformin and kidney function, potassium supplements) is its own problem even when it mentions the same findings: then update_of is "".';

    const TASK_UPDATE = [
        'TASK: Update your take with everything so far, refresh the watch list, and decide whether anything needs saying now.',
        '- take.one_liner (25 words or fewer), take.assessment (45 or fewer, aligned with the doctor\'s framing), take.concerns (most important first, at most 5, each a glanceable phrase of 12 words or fewer with the key number, keep topic ids stable across updates), take.next (at most 4 short items), take.doctor_view (how the doctor sees it, a few words, "" if unknown), take.differs (where you differ and why, or "").',
        '- watch: at most 8 safety tripwires (dangerous orders or plans, urgent findings; not routine management choices); keep the ones still relevant, drop those that no longer apply, add new ones the conversation suggests.',
        '- say: follow the speaking rules for the current mode. should_say false unless a critical item (any mode) or, in Lead, an important insight is not yet said or addressed. ' + SAME_PROBLEM_RULE,
    ].join('\n');

    // Only "critical" interrupts; "important" is held until asked (or offered in Lead).
    const SEVERITY_RULE = 'severity "critical" means likely serious harm to this patient soon if things go ahead unchanged (a drug he must not get, a dangerous dose, a missed emergency). A precaution or refinement to a reasonable plan is "important", even when it is wise.';

    function taskVerify(reason, followUp) {
        if (followUp) {
            return [
                'TASK: A moment ago this was flagged: "' + reason + '". You chose to wait and see whether the doctor would address it. Your prepared remark was: "' + followUp.text + '".',
                'Look at what has been said since. decision "say" if the doctor has moved on without addressing it (update the remark if anything new matters, 25 words or fewer); "quiet" if the doctor addressed it, it no longer matters, or something you already said covers it (see ALREADY SAID); "wait" only if the doctor is still in the middle of that very topic.',
                'If you say it, set severity by what is at stake for the patient, not by the fact that it went unaddressed: ' + SEVERITY_RULE,
                SAME_PROBLEM_RULE,
            ].join('\n');
        }
        return [
            'TASK: The ear flagged the new lines as possibly critical: "' + reason + '".',
            'Decide what to do and write the remark you would make (25 words or fewer). why is one plain sentence the doctor can read under "Why?": the chart fact or reasoning behind the remark, not notes about your decision.',
            '- "say" now for an order or plan that is dangerous for this patient (do not wait on those), or for a red flag or critical result the doctor has already heard and moved past or dismissed.',
            '- "wait" for a red flag or worrying result that was just raised and the doctor has not yet had a turn to respond: you will look again after the doctor\'s next words.',
            '- "quiet" if it is not a real safety issue for this patient, it is the reason for the visit, the doctor is already working on it, or it was already said or addressed. Then severity "none".',
            SEVERITY_RULE,
            SAME_PROBLEM_RULE,
        ].join('\n');
    }

    function taskAnswer(question) {
        return [
            'TASK: The doctor just asked you: "' + question + '"',
            'Answer now, out loud, briefly. Answer what was asked: do not append reminders about other open issues (your alerts are already on the doctor\'s screen) unless they change this answer. If you need a fact you do not have, use a lookup tool first. If the question is ambiguous, answer the most likely meaning. For a question about a drug, check it against both the allergies and every current medicine (interactions, duplications, combinations that must never be given together) and give each reason that applies. When choosing a treatment, search the chart for what this patient has received before and how it went (an antibiotic tolerated despite an allergy, a drug stopped for a reaction): that history beats a generic choice. If they ask for your overall take or what you think is going on, give the whole picture in priority order: the main problem, then the most important other active issues (including the safety issues you already raised), then where you differ. If they ask what is left to do or order, start from ON THE DOCTOR\'S RADAR: the open items (flagged ones first, with why), then at most two things they may have missed.',
            'LENGTH (the doctor reads this at a glance, mid-conversation): a fact or yes/no question gets one to three sentences, under 50 words; a drug or treatment question up to four sentences, under 70 words; an overall take up to six short sentences, under 100 words, one issue per sentence, most important first. Stop there, even if you know more: the doctor will ask for details.',
        ].join('\n');
    }

    // ── Scribe (Haiku): the live note, rewritten every few seconds ─────────
    const NOTE_SYSTEM = [
        'You are the scribe in a live hospital encounter (simulated patient). As the conversation unfolds you keep a short admission note current, so the doctor can glance at it and watch it take shape. Write only what the conversation and the chart support; never invent a finding, value, time or plan. Clinical, concise, no filler. The whole note stays under 450 words: brevity is the point.',
        'problem_representation: at most three sentences and 60 words, like a crisp morning-report summary: age and sex; only the background that matters for today, with the key numbers (e.g. EF 30-35%, CKD 3b, off anticoagulation since a 2023 GI bleed); the presenting syndrome and its tempo; and the two or three findings that matter most so far, with semantic qualifiers (acute, worsening, new, unexplained). No exam laundry list, no date of birth, no medication list. Before anything is heard, write it from the chart alone.',
        'hpi: the history of present illness as told so far, at most 100 words: chief complaint and onset, course, associated symptoms, pertinent negatives that were said, medication and adherence details, what the family added. Past tense, no exam, labs or plan. An empty string until some history has been heard.',
        'exam: the physical exam as the doctor stated or dictated it (lines marked "dictating the exam", or "for my note: ..."). vitals: the latest vital signs heard, in one line ("T 38.6, HR 142 irregular, BP 138/88, SpO2 94% on 2 L"), or "" if none were said. systems: one entry per system the doctor examined, in the usual order (General, HEENT, Neck, Heart, Lungs, Abdomen, Extremities, Skin, Neuro, Psych), each with the findings in standard clinical shorthand, close to the doctor\'s words. Only what was said: never add a normal finding or a system that was not examined. A correction replaces the earlier finding. Empty until the exam is heard.',
        'problems: the problems addressed today, most important first, at most six. name: short ("Acute on chronic HFrEF"). assessment: one sentence of at most 20 words, the working reasoning (the doctor\'s when stated). plan: ONLY what the doctor actually said or ordered in this conversation (see the doctor\'s lines and PLAN HEARD), each item at most 12 words, kept as said even if you disagree; if the doctor said nothing about a problem, plan is empty. Anything the doctor did not say, including standard workup you would expect, never goes in plan. consider: at most two items of at most 12 words, from the coworker\'s take, that the doctor has not addressed; empty if none.',
        'Keep it stable: keep the previous wording unless something new changes it, and add new details where they belong instead of rewriting everything.',
    ].join('\n\n');

    const NOTE_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: {
            problem_representation: { type: 'string' },
            hpi: { type: 'string' },
            exam: {
                type: 'object', additionalProperties: false,
                properties: {
                    vitals: { type: 'string' },
                    systems: {
                        type: 'array',
                        items: { type: 'object', additionalProperties: false, properties: { system: { type: 'string' }, findings: { type: 'string' } }, required: ['system', 'findings'] },
                    },
                },
                required: ['vitals', 'systems'],
            },
            problems: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        name: { type: 'string' },
                        assessment: { type: 'string' },
                        plan: { type: 'array', items: { type: 'string' } },
                        consider: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['name', 'assessment', 'plan', 'consider'],
                },
            },
        },
        required: ['problem_representation', 'hpi', 'exam', 'problems'],
    };

    const TASK_NOTE = 'TASK: Bring the note up to date with everything heard so far. Return the whole note.';

    // ── Radar (Haiku): the doctor's orders and to-dos, ready to act on ────
    // Field names and choices of the EHR's order form (js/components/order-entry.js;
    // tests/live-core.test.js checks they still match). A value that is not one of
    // the choices is mapped or left blank in code (LiveCore.toOrderForm).
    const ORDER_FIELDS = {
        medication: { name: null, dose: null, route: ['PO', 'IV', 'IV Push', 'IV Piggyback', 'IM', 'SC', 'SL', 'PR', 'Topical', 'Inhaled', 'Intranasal'], frequency: ['Once', 'Daily', 'BID', 'TID', 'QID', 'Q2H', 'Q4H', 'Q6H', 'Q8H', 'Q12H', 'Q24H', 'Q4H PRN', 'Q6H PRN', 'Q8H PRN', 'PRN', 'At bedtime', 'Before meals', 'After meals', 'With meals', 'Continuous'], duration: null, indication: null, notes: null },
        lab: { name: ['Complete Blood Count', 'Basic Metabolic Panel', 'Comprehensive Metabolic Panel', 'Lipid Panel', 'Liver Function Tests', 'Coagulation Panel (PT/INR/PTT)', 'Thyroid Panel', 'Troponin', 'BNP', 'Pro-BNP', 'Magnesium', 'Phosphorus', 'Lactate', 'Ammonia', 'Uric Acid', 'Iron Studies', 'Ferritin', 'Vitamin B12', 'Folate', 'Vitamin D', 'Hemoglobin A1c', 'C-Reactive Protein', 'ESR', 'Procalcitonin', 'Arterial Blood Gas', 'Venous Blood Gas', 'Urinalysis', 'Urine Culture', 'Urine Electrolytes', 'Blood Culture', 'Sputum Culture', 'Other'], customName: null, specimen: ['Blood', 'Urine', 'Stool', 'CSF', 'Sputum', 'Swab', 'Arterial Blood', 'Venous Blood', 'Other'], priority: ['Routine', 'Urgent', 'STAT'], indication: null, notes: null },
        imaging: { modality: ['X-Ray', 'CT', 'MRI', 'Ultrasound', 'Echo', 'Nuclear Medicine', 'Fluoroscopy'], bodyPart: null, contrast: ['Without contrast', 'With contrast', 'With and without contrast', 'N/A'], priority: ['Routine', 'Urgent', 'STAT'], indication: null, notes: null },
        procedure: { name: null, priority: ['Routine', 'Urgent', 'STAT'], indication: null, schedulingNotes: null, notes: null },
        consult: { specialty: ['Cardiology', 'Nephrology', 'Endocrinology', 'Pulmonology', 'Gastroenterology', 'Neurology', 'Infectious Disease', 'Oncology', 'Rheumatology', 'Psychiatry', 'Surgery', 'Other'], customSpecialty: null, priority: ['Routine', 'Urgent', 'STAT'], reason: null, notes: null },
        nursing: { orderType: ['Vital Signs', 'Activity', 'Diet', 'I&O Monitoring', 'Fall Precautions', 'Isolation', 'Wound Care', 'Foley Care', 'Other'], details: null, priority: ['Routine', 'Urgent'], duration: null, notes: null },
    };
    const fieldGuide = () => Object.entries(ORDER_FIELDS).map(([type, f]) => '- ' + type + ': ' + Object.entries(f).map(([k, v]) => k + (v ? ' [' + v.join(' | ') + ']' : '')).join(', ')).join('\n');

    const ACTIONS_SYSTEM = [
        'You keep the doctor\'s to-do list ("On my radar") during a live hospital encounter (simulated patient). Each time the doctor asks for something, you put it on the list, ready to act on with one click, so nothing said is lost. Only what the doctor asked for or committed to, and orders placed in the EHR: never your own ideas or the coworker\'s suggestions, unless the doctor takes one up ("let\'s do that": resolve "that" from COWORKER SAID).',
        '',
        'Kinds',
        '- order: medicines (start, give, change, hold or stop), labs, imaging, procedures (an EKG is a procedure), nursing and diet orders (oxygen goal, telemetry, strict I&O, daily weights, diet, fluid restriction). An instruction to the nurse at the bedside ("keep his sats above 92") is a nursing order. To hold or stop a medicine: a nursing order, orderType Other, details like "Hold spironolactone tonight".',
        '- consult: a specialist asked to see the patient here. referral: an outpatient referral.',
        '- message: something to tell or send someone (the nurse, the PCP, the family, pharmacy, another team).',
        '- note: a clinical note the doctor will write (H&P, progress note, goals-of-care note, procedure note); never an instruction or a remark.',
        '- task: any other to-do (update the allergy list, continue home medicines in the medication reconciliation, set up a family meeting).',
        'Not on the list: what was only discussed, considered or asked about, questions to the coworker, decisions that need no new action (keep using a drug he already takes), and anything the doctor decided against.',
        'One item per thing to order: "BMP and magnesium in the morning" is two lab orders; "furosemide 80 IV now, then 40 IV twice a day" is two medication orders. Nursing orders said together (strict I&O and daily weights) may share one item.',
        '',
        'Order form fields (order_type, then field keys; where choices are listed use one exactly, else ""):',
        fieldGuide(),
        'Fill only what was said or is plainly implied (a drip is IV and Continuous; "now" is Once, and STAT for a test or consult; "today" is Urgent); leave the rest "". indication: the doctor\'s reason in a few words, or the obvious one from the conversation. For a consult, reason is the clinical question. notes: only instructions the doctor gave (timing, "AM labs"); never your own advice.',
        '',
        'Each item',
        '- title: at most 8 words, as a doctor writes it, with the dose: "Furosemide 80 mg IV now", "BMP in the morning", "Hold spironolactone tonight".',
        '- next: for a task, note, message or referral, the next step in at most 12 words ("Add penicillin anaphylaxis to the allergy list"). For an order or consult, "" (the form shows what it still needs).',
        '- to, draft, note_type: for a message or referral, the recipient ("nurse", "PCP") and the message in the doctor\'s voice (at most 40 words, saying only what the doctor asked to say); for a note, note_type names it ("H&P", "Goals of Care Note") and draft is a short start (at most 80 words) from what was said. Otherwise "".',
        '- status: "done" if a line shows it was placed in the EHR (saying "I will" is still "todo"); "dropped" only when the doctor\'s own words take it back or replace it ("no lisinopril then", "make it ceftriaxone instead"); otherwise "todo". A coworker alert never drops an item: it flags it, and the doctor decides.',
        '- flag: if the coworker raised a safety concern about this item (OPEN SAFETY ALERTS, COWORKER SAID), the concern in at most 10 words ("Penicillin anaphylaxis in 1985"), and alert is that alert\'s id. Keep the flag until the doctor changes or drops the item. Otherwise flag and alert are "".',
        '- line: the id of the line where the doctor said it (or the EHR line).',
        '',
        'Return only changes: new items with id "", and existing items whose content or status changed, with their id and all their fields (when only the status changes, keep the title as it was). Leave unchanged items out. If nothing changed, return an empty list.',
    ].join('\n');

    const ACTIONS_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: {
            changes: {
                type: 'array',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        id: { type: 'string' },
                        kind: { type: 'string', enum: ['order', 'consult', 'referral', 'message', 'note', 'task'] },
                        title: { type: 'string' },
                        order_type: { type: 'string', enum: ['medication', 'lab', 'imaging', 'procedure', 'consult', 'nursing', 'none'] },
                        fields: {
                            type: 'array',
                            items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
                        },
                        to: { type: 'string' },
                        note_type: { type: 'string' },
                        draft: { type: 'string' },
                        next: { type: 'string' },
                        status: { type: 'string', enum: ['todo', 'done', 'dropped'] },
                        flag: { type: 'string' },
                        alert: { type: 'string' },
                        line: { type: 'string' },
                    },
                    required: ['id', 'kind', 'title', 'order_type', 'fields', 'to', 'note_type', 'draft', 'next', 'status', 'flag', 'alert', 'line'],
                },
            },
        },
        required: ['changes'],
    };

    const TASK_ACTIONS = 'TASK: Update the list. NEW PLAN ITEMS are what was just heard; take exact doses and anything taken back from the conversation, and flags from the coworker\'s alerts. Return only the changes.';

    // ── Helpers (cheap models) ───────────────────────────────────────────
    const MEMORY_SYSTEM = 'You answer a clinician\'s question from a patient\'s long-term record summary. Quote values with dates. Answer in at most four short sentences. If the record does not contain the answer, say "Not in the record." Do not guess.';

    const RELATE_SYSTEM = 'A clinical AI coworker (simulated patient) is about to show a doctor a new safety alert, but other alerts went up on the doctor\'s screen seconds ago. Decide how the new one relates to them. same_as: the id of the alert that is about the same clinical problem (e.g. the possible GI bleed, the fast AF, the penicillin allergy), or "" if it is a different problem. adds_new: true if, for that same problem, the new alert tells the doctor something more to act on now (a new order to stop, a new finding); false if a doctor who read the earlier alert would gain nothing from it.';

    const RELATE_SCHEMA = {
        type: 'object',
        additionalProperties: false,
        properties: { same_as: { type: 'string' }, adds_new: { type: 'boolean' } },
        required: ['same_as', 'adds_new'],
    };

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
        TASK_PRIME, TASK_UPDATE, taskVerify, taskAnswer, NOTE_SYSTEM, NOTE_SCHEMA, TASK_NOTE, ORDER_FIELDS, ACTIONS_SYSTEM, ACTIONS_SCHEMA, TASK_ACTIONS,
        MEMORY_SYSTEM, RELATE_SYSTEM, RELATE_SCHEMA, MEDCHECK_SYSTEM, MEDCHECK_SCHEMA, BRAIN_TOOLS,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.LivePrompts = api;
})(typeof window !== 'undefined' ? window : globalThis);
