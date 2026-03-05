/**
 * Simulation Score Tracker
 * Central scoring service that passively tracks all user actions during a simulation.
 * Scores across 6 domains: Patient History, Nurse Interaction, Chart Review,
 * Medication Management, Safety/Allergy Awareness, and Empathy/Communication.
 */

const SimulationScoreTracker = {

    // ========== PATIENT HISTORY ITEMS ==========
    patientHistoryItems: {
        breathing:          { asked: false, keywords: ['breath', 'breathing', 'short of breath', 'dyspnea', 'winded', 'air', 'sob'], points: 8, label: 'Asked about breathing/dyspnea' },
        swelling:           { asked: false, keywords: ['swell', 'ankle', 'leg', 'feet', 'edema', 'puffy', 'fluid'], points: 8, label: 'Asked about swelling/edema' },
        orthopnea:          { asked: false, keywords: ['sleep', 'lie flat', 'pillow', 'bed', 'recline', 'propped up', 'lying down'], points: 6, label: 'Asked about orthopnea/sleep position' },
        weight:             { asked: false, keywords: ['weight', 'gained', 'heavier', 'pounds', 'kilo'], points: 5, label: 'Asked about weight changes' },
        medications:        { asked: false, keywords: ['medication', 'pill', 'medicine', 'taking', 'compliance', 'prescri'], points: 8, label: 'Asked about medication compliance' },
        diureticCompliance: { asked: false, keywords: ['water pill', 'furosemide', 'lasix', 'diuretic', 'pee pill', 'ran out', 'run out'], points: 8, label: 'Asked about diuretic specifically' },
        bleedingHistory:    { asked: false, keywords: ['bleed', 'blood', 'stomach', 'gi', 'ulcer', 'vomit blood', 'black stool', 'melena', 'hematemesis'], points: 10, label: 'Asked about bleeding history' },
        bloodThinnerHx:     { asked: false, keywords: ['blood thinner', 'anticoagul', 'warfarin', 'coumadin', 'thin the blood', 'clot'], points: 8, label: 'Asked about blood thinner history' },
        dietSalt:           { asked: false, keywords: ['diet', 'salt', 'sodium', 'eating', 'food', 'fluid intake', 'drinking'], points: 5, label: 'Asked about diet/salt/fluid intake' },
        chestPain:          { asked: false, keywords: ['chest', 'pain', 'pressure', 'squeeze', 'angina', 'tightness'], points: 4, label: 'Asked about chest pain' },
        palpitations:       { asked: false, keywords: ['heart racing', 'palpitation', 'flutter', 'irregular', 'skip', 'pounding'], points: 4, label: 'Asked about palpitations' }
    },

    // ========== NURSE INTERACTION ITEMS ==========
    nurseHistoryItems: {
        vitalsAssessment: { asked: false, keywords: ['vitals', 'blood pressure', 'heart rate', 'oxygen', 'spo2', 'status', 'how is he', 'how\'s he'], points: 8, label: 'Asked about current vitals/assessment' },
        urineOutput:      { asked: false, keywords: ['urine', 'output', 'foley', 'uop', 'peeing', 'voiding', 'i&o', 'intake and output', 'intake output'], points: 10, label: 'Asked about urine output/I&O' },
        physicalExam:     { asked: false, keywords: ['exam', 'lung', 'crackle', 'jvp', 'jugular', 'edema', 'heart sound', 'auscult', 'listen'], points: 8, label: 'Asked about physical exam findings' },
        wifeReport:       { asked: false, keywords: ['wife', 'patricia', 'family', 'spouse', 'brought him', 'what did she', 'what she said'], points: 8, label: 'Asked what wife reported' },
        recentChanges:    { asked: false, keywords: ['change', 'different', 'worse', 'better', 'trend', 'overnight', 'since admission', 'getting'], points: 6, label: 'Asked about recent changes/trends' },
        holdMeds:         { asked: false, keywords: ['hold metformin', 'stop metformin', 'discontinue metformin', 'no metformin', 'hold the metformin', 'hold his metformin'], points: 6, label: 'Communicated holding metformin' }
    },

    // ========== CHART REVIEW ITEMS ==========
    chartReviewItems: {
        problemList:       { viewed: false, points: 8, label: 'Viewed Problem List' },
        resolvedProblems:  { viewed: false, points: 10, label: 'Viewed Resolved Problems (GI bleed)' },
        medicationList:    { viewed: false, points: 8, label: 'Viewed Medication List' },
        allergyList:       { viewed: false, points: 10, label: 'Viewed Allergy List' },
        labResults:        { viewed: false, points: 8, label: 'Viewed Lab Results' },
        notes:             { viewed: false, points: 5, label: 'Viewed Clinical Notes' },
        giConsultNote:     { viewed: false, points: 12, label: 'Read GI Consult Note (anticoag recommendation)' }
    },

    // ========== MEDICATION ORDER ITEMS ==========
    medicationOrders: {
        // Critical
        ivFurosemide:       { ordered: false, timely: false, correctDose: false, points: 15, category: 'critical', label: 'IV Furosemide ordered' },

        // Important
        potassiumMonitor:   { ordered: false, points: 6, category: 'important', label: 'Potassium monitoring/replacement' },
        holdMetformin:      { ordered: false, points: 6, category: 'important', label: 'Communicated holding metformin' },
        rateControlAfib:    { ordered: false, points: 8, category: 'important', label: 'Rate control for A-fib (when triggered)' },
        oxygenTherapy:      { ordered: false, points: 5, category: 'important', label: 'Oxygen therapy ordered' },
        fluidRestriction:   { ordered: false, points: 5, category: 'important', label: 'Fluid restriction ordered' },
        dailyWeightsIO:     { ordered: false, points: 5, category: 'important', label: 'Daily weights + strict I&O' },

        // Safety (negative scoring if violated)
        noAnticoagulation:  { safe: true, points: 15, category: 'safety', label: 'Avoided anticoagulation (GI bleed contraindication)' },
        noACEInhibitor:     { safe: true, points: 10, category: 'safety', label: 'Avoided ACE inhibitor (angioedema allergy)' },
        noPenicillin:       { safe: true, points: 10, category: 'safety', label: 'Avoided penicillin (anaphylaxis allergy)' },

        // Bonus
        telemetry:          { ordered: false, points: 3, category: 'bonus', label: 'Telemetry monitoring' },
        bmpMonitoring:      { ordered: false, points: 3, category: 'bonus', label: 'BMP/metabolic panel monitoring' },
        magnesiumCheck:     { ordered: false, points: 3, category: 'bonus', label: 'Magnesium level check' },
        cardiologyConsult:  { ordered: false, points: 3, category: 'bonus', label: 'Cardiology consult' },
        vteProphylaxis:     { ordered: false, points: 3, category: 'bonus', label: 'VTE prophylaxis (SCDs)' }
    },

    // ========== ALLERGY VIOLATIONS ==========
    allergyViolations: [],

    // ========== EMPATHY ITEMS ==========
    empathyItems: {
        empathyResponse:    { earned: false, points: 40, label: 'Responded empathetically to patient distress' },
        explainedPlan:      { earned: false, points: 30, label: 'Explained treatment plan to anxious patient' },
        addressedFears:     { earned: false, points: 20, label: 'Addressed specific fears (brother\'s death)' },
        rapport:            { earned: false, points: 10, label: 'Maintained rapport (meaningful conversation)' }
    },

    // ========== EKG INTERPRETATION ==========
    ekgInterpretation: {
        submitted: false,
        text: '',
        score: 0,
        details: []
    },

    // ========== NOTE QUALITY ==========
    noteQuality: {
        submitted: false,
        noteText: '',
        thoroughnessScore: 0,
        reasoningScore: 0,
        details: []
    },

    // Track whether emotional trigger has fired
    emotionalTriggerFired: false,
    patientMessageCount: 0,

    // ========== INITIALIZATION ==========
    init() {
        this.reset();
        console.log('SimulationScoreTracker initialized');
    },

    reset() {
        // Reset all patient history items
        for (const item of Object.values(this.patientHistoryItems)) {
            item.asked = false;
        }
        // Reset all nurse history items
        for (const item of Object.values(this.nurseHistoryItems)) {
            item.asked = false;
        }
        // Reset all chart review items
        for (const item of Object.values(this.chartReviewItems)) {
            item.viewed = false;
        }
        // Reset medication orders
        for (const item of Object.values(this.medicationOrders)) {
            if ('ordered' in item) item.ordered = false;
            if ('safe' in item) item.safe = true;
            if ('timely' in item) item.timely = false;
            if ('correctDose' in item) item.correctDose = false;
        }
        // Reset empathy
        for (const item of Object.values(this.empathyItems)) {
            item.earned = false;
        }
        this.allergyViolations = [];
        this.emotionalTriggerFired = false;
        this.patientMessageCount = 0;
        // Reset EKG interpretation
        this.ekgInterpretation = { submitted: false, text: '', score: 0, details: [] };
        // Reset note quality
        this.noteQuality = { submitted: false, noteText: '', thoroughnessScore: 0, reasoningScore: 0, details: [] };
    },

    // ========== TRACKING METHODS ==========

    /**
     * Track a user message sent to the patient
     */
    trackPatientQuestion(text) {
        const lower = text.toLowerCase();
        this.patientMessageCount++;

        for (const [key, item] of Object.entries(this.patientHistoryItems)) {
            if (!item.asked && item.keywords.some(k => lower.includes(k))) {
                item.asked = true;
                console.log(`[Score] Patient history: "${item.label}" - EARNED`);
            }
        }

        // Track empathy keywords (after emotional trigger)
        if (this.emotionalTriggerFired) {
            const empathyKeywords = ['understand', 'sorry', 'hear', 'feel', 'scared', 'worry', 'concern',
                'here for you', 'together', 'help', 'okay', 'normal to feel', 'reassure', 'safe'];
            if (empathyKeywords.some(k => lower.includes(k))) {
                this.empathyItems.empathyResponse.earned = true;
            }

            const planKeywords = ['plan', 'going to', 'we will', 'test', 'treatment', 'medicine', 'help you', 'give you'];
            if (planKeywords.some(k => lower.includes(k))) {
                this.empathyItems.explainedPlan.earned = true;
            }

            const fearKeywords = ['brother', 'die', 'death', 'home', 'not going to', 'won\'t'];
            if (fearKeywords.some(k => lower.includes(k))) {
                this.empathyItems.addressedFears.earned = true;
            }
        }

        // Rapport: at least 5 meaningful exchanges
        if (this.patientMessageCount >= 5) {
            this.empathyItems.rapport.earned = true;
        }
    },

    /**
     * Track a user message sent to the nurse
     */
    trackNurseQuestion(text) {
        const lower = text.toLowerCase();

        for (const [key, item] of Object.entries(this.nurseHistoryItems)) {
            if (!item.asked && item.keywords.some(k => lower.includes(k))) {
                item.asked = true;
                console.log(`[Score] Nurse interaction: "${item.label}" - EARNED`);
            }
        }

        // Also track if user tells nurse to hold metformin (counts for medication scoring too)
        if (this.nurseHistoryItems.holdMeds.asked) {
            this.medicationOrders.holdMetformin.ordered = true;
        }
    },

    /**
     * Track navigation to chart sections
     */
    trackChartNavigation(route) {
        const routeMap = {
            '/problems': 'problemList',
            '/medications': 'medicationList',
            '/allergies': 'allergyList',
            '/labs': 'labResults',
            '/notes': 'notes'
        };

        const itemKey = routeMap[route];
        if (itemKey && !this.chartReviewItems[itemKey].viewed) {
            this.chartReviewItems[itemKey].viewed = true;
            console.log(`[Score] Chart review: "${this.chartReviewItems[itemKey].label}" - EARNED`);
        }
    },

    /**
     * Track when resolved problems tab is viewed
     */
    trackResolvedProblemsViewed() {
        if (!this.chartReviewItems.resolvedProblems.viewed) {
            this.chartReviewItems.resolvedProblems.viewed = true;
            console.log('[Score] Chart review: "Viewed Resolved Problems" - EARNED');
        }
    },

    /**
     * Track when a specific note is opened
     */
    trackNoteViewed(noteId) {
        if (noteId === 'NOTE100' && !this.chartReviewItems.giConsultNote.viewed) {
            this.chartReviewItems.giConsultNote.viewed = true;
            console.log('[Score] Chart review: "Read GI Consult Note" - EARNED');
        }
    },

    /**
     * Track an order submission
     */
    trackOrder(order) {
        const name = (order.name || '').toLowerCase();
        const formData = order.formData || {};
        const type = order.type;

        // ---- MEDICATION ORDERS ----
        if (type === 'medication') {
            // IV Furosemide / loop diuretic
            if (name.includes('furosemide') || name.includes('lasix') || name.includes('bumetanide') || name.includes('bumex')) {
                this.medicationOrders.ivFurosemide.ordered = true;
                const elapsed = typeof SimulationEngine !== 'undefined' ? SimulationEngine.getElapsedMinutes() : 999;
                if (elapsed <= 30) this.medicationOrders.ivFurosemide.timely = true;
                const dose = this._parseDose(formData.dose);
                if (dose >= 40 && dose <= 200) this.medicationOrders.ivFurosemide.correctDose = true;
                console.log(`[Score] Medication: IV Furosemide ordered (timely: ${elapsed <= 30}, dose: ${dose}mg)`);
            }

            // Potassium replacement
            if (name.includes('potassium') || name.includes('kcl') || name.includes('k-dur') || name.includes('klor')) {
                this.medicationOrders.potassiumMonitor.ordered = true;
                console.log('[Score] Medication: Potassium replacement - EARNED');
            }

            // Rate control for A-fib
            if (name.includes('metoprolol') || name.includes('diltiazem') || name.includes('amiodarone') || name.includes('cardizem')) {
                this.medicationOrders.rateControlAfib.ordered = true;
                console.log('[Score] Medication: Rate control - EARNED');
            }

            // Oxygen
            if (name.includes('oxygen') || name.includes('o2')) {
                this.medicationOrders.oxygenTherapy.ordered = true;
            }

            // SAFETY: Anticoagulation
            const anticoagulants = ['heparin', 'enoxaparin', 'lovenox', 'warfarin', 'coumadin',
                'apixaban', 'eliquis', 'rivaroxaban', 'xarelto', 'dabigatran', 'pradaxa',
                'edoxaban', 'fondaparinux'];
            if (anticoagulants.some(ac => name.includes(ac))) {
                this.medicationOrders.noAnticoagulation.safe = false;
                console.log('[Score] SAFETY VIOLATION: Anticoagulation ordered despite GI bleed history');
            }

            // SAFETY: ACE Inhibitor
            const aceInhibitors = ['lisinopril', 'enalapril', 'ramipril', 'benazepril', 'captopril',
                'quinapril', 'fosinopril', 'perindopril', 'trandolapril', 'moexipril'];
            if (aceInhibitors.some(ace => name.includes(ace))) {
                this.medicationOrders.noACEInhibitor.safe = false;
                this.allergyViolations.push({
                    medication: order.name,
                    allergen: 'ACE Inhibitor (Lisinopril)',
                    reaction: 'Angioedema',
                    severity: 'critical',
                    time: new Date().toISOString()
                });
                console.log('[Score] ALLERGY VIOLATION: ACE Inhibitor ordered - patient has angioedema allergy');
            }

            // SAFETY: Penicillin class
            const penicillins = ['amoxicillin', 'ampicillin', 'penicillin', 'augmentin', 'piperacillin',
                'nafcillin', 'oxacillin', 'dicloxacillin', 'amoxil', 'unasyn', 'zosyn'];
            if (penicillins.some(pen => name.includes(pen))) {
                this.medicationOrders.noPenicillin.safe = false;
                this.allergyViolations.push({
                    medication: order.name,
                    allergen: 'Penicillin',
                    reaction: 'Anaphylaxis',
                    severity: 'critical',
                    time: new Date().toISOString()
                });
                console.log('[Score] ALLERGY VIOLATION: Penicillin ordered - patient has anaphylaxis allergy');
            }
        }

        // ---- NURSING ORDERS ----
        if (type === 'nursing') {
            const details = (formData.details || '').toLowerCase();
            const orderType = (formData.orderType || '').toLowerCase();

            if (details.includes('i&o') || details.includes('strict') || orderType.includes('i&o') || orderType.includes('intake')) {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (details.includes('weight') || details.includes('daily weight') || orderType.includes('weight')) {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (details.includes('fluid restrict') || details.includes('restrict fluid') || orderType.includes('fluid')) {
                this.medicationOrders.fluidRestriction.ordered = true;
            }
        }

        // ---- ADMISSION ORDER SET ----
        if (type === 'admission') {
            if (formData.oxygen && formData.oxygen !== 'Room Air') {
                this.medicationOrders.oxygenTherapy.ordered = true;
            }
            if (formData.telemetry === 'Yes') {
                this.medicationOrders.telemetry.ordered = true;
            }
            if (formData.io === 'Strict I&O') {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (formData.dailyWeight === 'Yes') {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (formData.diet && (formData.diet.includes('Sodium') || formData.diet.includes('Fluid'))) {
                this.medicationOrders.fluidRestriction.ordered = true;
            }
            if (formData.vte === 'SCDs Only' || formData.vte === 'Contraindicated - SCDs Only') {
                this.medicationOrders.vteProphylaxis.ordered = true;
            }
        }

        // ---- LAB ORDERS ----
        if (type === 'lab') {
            if (name.includes('basic metabolic') || name.includes('bmp') || name.includes('comprehensive metabolic') || name.includes('cmp')) {
                this.medicationOrders.bmpMonitoring.ordered = true;
                this.medicationOrders.potassiumMonitor.ordered = true;
            }
            if (name.includes('magnesium') || name.includes('mag level')) {
                this.medicationOrders.magnesiumCheck.ordered = true;
            }
        }

        // ---- CONSULT ORDERS ----
        if (type === 'consult') {
            if ((formData.specialty || '').toLowerCase().includes('cardiology')) {
                this.medicationOrders.cardiologyConsult.ordered = true;
            }
        }
    },

    /**
     * Mark that the emotional trigger has fired
     */
    markEmotionalTrigger() {
        this.emotionalTriggerFired = true;
    },

    // ========== EKG INTERPRETATION TRACKING ==========

    /**
     * Score the user's EKG interpretation via keyword matching
     */
    trackEKGInterpretation(text) {
        if (this.ekgInterpretation.submitted) return; // Only score first submission

        this.ekgInterpretation.submitted = true;
        this.ekgInterpretation.text = text;

        const lower = text.toLowerCase();
        let score = 0;
        const details = [];

        // Primary diagnosis (50 points)
        const afibKeywords = ['a-fib', 'afib', 'a fib', 'atrial fib', 'atrial fibrillation'];
        if (afibKeywords.some(k => lower.includes(k))) {
            score += 50;
            details.push({ text: 'Correctly identified atrial fibrillation', earned: true, points: 50 });
        } else {
            details.push({ text: 'Identify atrial fibrillation', earned: false, points: 50, critical: true });
        }

        // Rate characterization (20 points)
        const rvrKeywords = ['rapid', 'rvr', 'rapid ventricular', 'tachycardic', 'tachycardia', 'fast rate', 'rapid rate', 'rate of 14'];
        if (rvrKeywords.some(k => lower.includes(k))) {
            score += 20;
            details.push({ text: 'Noted rapid ventricular response', earned: true, points: 20 });
        } else {
            details.push({ text: 'Note rapid ventricular rate', earned: false, points: 20 });
        }

        // Supporting features (15 points each)
        const irregularKeywords = ['irregularly irregular', 'irregular rhythm', 'irregular'];
        if (irregularKeywords.some(k => lower.includes(k))) {
            score += 15;
            details.push({ text: 'Noted irregularly irregular rhythm', earned: true, points: 15 });
        } else {
            details.push({ text: 'Note irregular rhythm', earned: false, points: 15 });
        }

        const pWaveKeywords = ['no p wave', 'absent p wave', 'no discernible p', 'without p wave', 'p waves absent', 'no p-wave'];
        if (pWaveKeywords.some(k => lower.includes(k))) {
            score += 15;
            details.push({ text: 'Noted absence of P waves', earned: true, points: 15 });
        } else {
            details.push({ text: 'Note absence of P waves', earned: false, points: 15 });
        }

        this.ekgInterpretation.score = score;
        this.ekgInterpretation.details = details;

        console.log(`[Score] EKG Interpretation: ${score}/100 - "${text}"`);
    },

    // ========== NOTE QUALITY TRACKING ==========

    /**
     * Score a clinical note for thoroughness and clinical reasoning
     */
    trackNoteSubmission(noteText, noteType) {
        if (this.noteQuality.submitted) return; // Only score first note

        this.noteQuality.submitted = true;
        this.noteQuality.noteText = noteText;

        const lower = noteText.toLowerCase();
        const details = [];
        let thoroughnessPoints = 0;
        let thoroughnessTotal = 0;
        let reasoningPoints = 0;
        let reasoningTotal = 0;

        // ---- THOROUGHNESS: Check for key note sections ----
        const sections = [
            { name: 'Chief Complaint / HPI', keywords: ['chief complaint', 'hpi', 'history of present illness', 'presenting', 'presents with', 'shortness of breath', 'dyspnea'], points: 10 },
            { name: 'Past Medical History', keywords: ['past medical', 'pmh', 'medical history', 'history of heart failure', 'history of atrial'], points: 8 },
            { name: 'Medications', keywords: ['medication', 'home meds', 'current medications', 'carvedilol', 'entresto', 'furosemide', 'lantus'], points: 8 },
            { name: 'Allergies', keywords: ['allerg', 'nkda', 'penicillin', 'sulfa', 'lisinopril'], points: 8 },
            { name: 'Social History', keywords: ['social', 'lives with', 'wife', 'retired', 'smoking', 'alcohol', 'tobacco'], points: 5 },
            { name: 'Vital Signs', keywords: ['vital', 'blood pressure', 'heart rate', 'bp ', 'hr ', 'spo2', 'oxygen sat', 'respiratory rate', 'temp'], points: 8 },
            { name: 'Physical Exam', keywords: ['physical exam', 'exam:', 'lung', 'crackle', 'jvp', 'jugular', 'edema', 's3', 'gallop', 'murmur'], points: 10 },
            { name: 'Labs / Results', keywords: ['lab', 'bnp', 'troponin', 'creatinine', 'potassium', 'sodium', 'hemoglobin', 'cbc', 'bmp'], points: 8 },
            { name: 'Assessment', keywords: ['assessment', 'impression', 'diagnosis', 'diagnoses'], points: 10 },
            { name: 'Plan', keywords: ['plan', 'treatment plan', 'disposition', 'orders', 'will continue', 'will start'], points: 10 }
        ];

        for (const section of sections) {
            thoroughnessTotal += section.points;
            const found = section.keywords.some(k => lower.includes(k));
            if (found) {
                thoroughnessPoints += section.points;
                details.push({ text: 'Included: ' + section.name, earned: true, points: section.points });
            } else {
                details.push({ text: 'Missing: ' + section.name, earned: false, points: section.points });
            }
        }

        // ---- CLINICAL REASONING: Check for key clinical concepts ----
        const reasoningItems = [
            { name: 'CHF exacerbation identified', keywords: ['chf', 'heart failure', 'hf exacerbation', 'decompensated', 'volume overload', 'acute on chronic'], points: 15 },
            { name: 'Medication non-compliance as trigger', keywords: ['ran out', 'non-compliance', 'noncompliance', 'noncompliant', 'missed doses', 'not taking', 'stopped taking', 'without furosemide'], points: 10 },
            { name: 'Diuresis rationale', keywords: ['diuresis', 'diuretic', 'furosemide', 'volume removal', 'fluid removal', 'decongestion', 'iv lasix'], points: 10 },
            { name: 'A-fib identification/management', keywords: ['atrial fibrillation', 'a-fib', 'afib', 'rate control', 'rhythm control'], points: 10 },
            { name: 'Anticoagulation reasoning', keywords: ['anticoagul', 'gi bleed', 'bleeding risk', 'cha2ds2', 'stroke risk', 'contraindicated', 'not a candidate', 'high rebleed', 'hold anticoag'], points: 15 },
            { name: 'Renal considerations', keywords: ['renal', 'kidney', 'creatinine', 'ckd', 'gfr', 'aki', 'nephro', 'renal function'], points: 10 },
            { name: 'Electrolyte monitoring plan', keywords: ['electrolyte', 'potassium', 'magnesium', 'monitor', 'bmp', 'metabolic panel', 'replete'], points: 5 }
        ];

        for (const item of reasoningItems) {
            reasoningTotal += item.points;
            const found = item.keywords.some(k => lower.includes(k));
            if (found) {
                reasoningPoints += item.points;
                details.push({ text: 'Reasoning: ' + item.name, earned: true, points: item.points });
            } else {
                details.push({ text: 'Reasoning: ' + item.name, earned: false, points: item.points });
            }
        }

        // Calculate scores
        const thoroughnessPct = thoroughnessTotal > 0 ? (thoroughnessPoints / thoroughnessTotal) * 100 : 0;
        const reasoningPct = reasoningTotal > 0 ? (reasoningPoints / reasoningTotal) * 100 : 0;

        this.noteQuality.thoroughnessScore = Math.round(thoroughnessPct);
        this.noteQuality.reasoningScore = Math.round(reasoningPct);
        this.noteQuality.details = details;

        const combined = Math.round(thoroughnessPct * 0.5 + reasoningPct * 0.5);
        console.log(`[Score] Note Quality: ${combined}/100 (Thoroughness: ${Math.round(thoroughnessPct)}%, Reasoning: ${Math.round(reasoningPct)}%)`);
    },

    // ========== ALLERGY CHECK ==========

    /**
     * Check if a medication matches any patient allergy
     * Returns { isMatch, allergen, reaction, severity } or null
     */
    checkAllergyMatch(medicationName) {
        const name = (medicationName || '').toLowerCase();

        // Penicillin class
        const penicillins = ['amoxicillin', 'ampicillin', 'penicillin', 'augmentin', 'piperacillin',
            'nafcillin', 'oxacillin', 'dicloxacillin', 'amoxil', 'unasyn', 'zosyn'];
        if (penicillins.some(p => name.includes(p))) {
            return { isMatch: true, allergen: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' };
        }

        // ACE Inhibitor class
        const aceInhibitors = ['lisinopril', 'enalapril', 'ramipril', 'benazepril', 'captopril',
            'quinapril', 'fosinopril', 'perindopril', 'trandolapril', 'moexipril'];
        if (aceInhibitors.some(a => name.includes(a))) {
            return { isMatch: true, allergen: 'ACE Inhibitor (Lisinopril)', reaction: 'Angioedema', severity: 'SEVERE' };
        }

        // Sulfa class
        const sulfas = ['sulfamethoxazole', 'trimethoprim-sulfamethoxazole', 'bactrim', 'septra', 'sulfa'];
        if (sulfas.some(s => name.includes(s))) {
            return { isMatch: true, allergen: 'Sulfa Drugs', reaction: 'Rash/Hives', severity: 'MODERATE' };
        }

        return null;
    },

    // ========== SCORE CALCULATION ==========

    /**
     * Calculate final scores across all 6 categories
     * Returns object with category scores and overall weighted score
     */
    calculateFinalScores() {
        const scores = {};

        // 1. PATIENT HISTORY (15% weight)
        scores.patientHistory = this._calcCategoryScore(this.patientHistoryItems, 'asked');

        // 2. NURSE INTERACTION (10% weight)
        scores.nurseInteraction = this._calcCategoryScore(this.nurseHistoryItems, 'asked');

        // 3. CHART REVIEW (10% weight)
        scores.chartReview = this._calcCategoryScore(this.chartReviewItems, 'viewed');

        // 4. MEDICATION MANAGEMENT (20% weight)
        scores.medicationManagement = this._calcMedicationScore();

        // 5. SAFETY (10% weight)
        scores.safety = this._calcSafetyScore();

        // 6. EMPATHY (10% weight)
        scores.empathy = this._calcEmpathyScore();

        // 7. EKG INTERPRETATION (10% weight)
        scores.ekgInterpretation = this._calcEKGScore();

        // 8. NOTE QUALITY (15% weight)
        scores.noteQuality = this._calcNoteScore();

        // OVERALL weighted score
        scores.overall = {
            score: Math.round(
                scores.patientHistory.score * 0.15 +
                scores.nurseInteraction.score * 0.10 +
                scores.chartReview.score * 0.10 +
                scores.medicationManagement.score * 0.20 +
                scores.safety.score * 0.10 +
                scores.empathy.score * 0.10 +
                scores.ekgInterpretation.score * 0.10 +
                scores.noteQuality.score * 0.15
            ),
            max: 100
        };

        return scores;
    },

    // ========== INTERNAL HELPERS ==========

    _calcCategoryScore(items, field) {
        let earned = 0;
        let total = 0;
        const details = [];

        for (const [key, item] of Object.entries(items)) {
            total += item.points;
            const isEarned = item[field] === true;
            if (isEarned) earned += item.points;
            details.push({
                text: item.label,
                earned: isEarned,
                points: item.points,
                critical: item.points >= 10
            });
        }

        return {
            score: total > 0 ? Math.round((earned / total) * 100) : 0,
            earned,
            total,
            details
        };
    },

    _calcMedicationScore() {
        let earned = 0;
        let total = 0;
        const details = [];

        for (const [key, item] of Object.entries(this.medicationOrders)) {
            if (item.category === 'safety') continue; // Safety scored separately

            total += item.points;

            if (key === 'ivFurosemide') {
                // Special handling for furosemide: base + timely bonus + dose bonus
                let furosemideEarned = 0;
                if (item.ordered) {
                    furosemideEarned += 10; // Base points for ordering
                    details.push({ text: 'IV Furosemide ordered', earned: true, points: 10 });
                } else {
                    details.push({ text: 'IV Furosemide ordered', earned: false, points: 10, critical: true });
                }
                if (item.timely) {
                    furosemideEarned += 3;
                    details.push({ text: 'Furosemide within 30 minutes', earned: true, points: 3 });
                } else {
                    details.push({ text: 'Furosemide within 30 minutes', earned: false, points: 3 });
                }
                if (item.correctDose) {
                    furosemideEarned += 2;
                    details.push({ text: 'Appropriate furosemide dose (40-200mg)', earned: true, points: 2 });
                } else if (item.ordered) {
                    details.push({ text: 'Appropriate furosemide dose (40-200mg)', earned: false, points: 2 });
                }
                earned += furosemideEarned;
            } else {
                if (item.ordered) {
                    earned += item.points;
                    details.push({ text: item.label, earned: true, points: item.points });
                } else {
                    details.push({ text: item.label, earned: false, points: item.points });
                }
            }
        }

        return {
            score: total > 0 ? Math.round((earned / total) * 100) : 0,
            earned,
            total,
            details
        };
    },

    _calcSafetyScore() {
        let score = 100;
        const details = [];

        const safetyItems = {
            noAnticoagulation: { deduction: 40, label: 'Avoided anticoagulation (GI bleed contraindication)' },
            noACEInhibitor: { deduction: 30, label: 'Avoided ACE inhibitor (angioedema allergy)' },
            noPenicillin: { deduction: 30, label: 'Avoided penicillin (anaphylaxis allergy)' }
        };

        for (const [key, config] of Object.entries(safetyItems)) {
            const item = this.medicationOrders[key];
            if (item.safe) {
                details.push({ text: config.label, earned: true, points: config.deduction });
            } else {
                score -= config.deduction;
                details.push({ text: config.label, earned: false, points: config.deduction, critical: true });
            }
        }

        // Add allergy violations as extra detail
        for (const violation of this.allergyViolations) {
            details.push({
                text: `ALLERGY VIOLATION: ${violation.medication} (${violation.allergen} - ${violation.reaction})`,
                earned: false,
                critical: true
            });
        }

        return {
            score: Math.max(0, score),
            details
        };
    },

    _calcEmpathyScore() {
        if (!this.emotionalTriggerFired) {
            return {
                score: 50, // Neutral if trigger hasn't fired yet
                details: [{ text: 'Emotional challenge not yet encountered', earned: null }]
            };
        }

        let earned = 0;
        let total = 0;
        const details = [];

        for (const [key, item] of Object.entries(this.empathyItems)) {
            total += item.points;
            if (item.earned) {
                earned += item.points;
                details.push({ text: item.label, earned: true, points: item.points });
            } else {
                details.push({ text: item.label, earned: false, points: item.points });
            }
        }

        return {
            score: total > 0 ? Math.round((earned / total) * 100) : 0,
            earned,
            total,
            details
        };
    },

    _calcEKGScore() {
        if (!this.ekgInterpretation.submitted) {
            return {
                score: 0,
                details: [{ text: 'EKG interpretation not submitted', earned: false, critical: true }]
            };
        }
        return {
            score: this.ekgInterpretation.score,
            details: this.ekgInterpretation.details
        };
    },

    _calcNoteScore() {
        if (!this.noteQuality.submitted) {
            return {
                score: 0,
                thoroughness: 0,
                reasoning: 0,
                details: [{ text: 'No admission note written', earned: false, critical: true }]
            };
        }

        const combined = Math.round(this.noteQuality.thoroughnessScore * 0.5 + this.noteQuality.reasoningScore * 0.5);
        return {
            score: combined,
            thoroughness: this.noteQuality.thoroughnessScore,
            reasoning: this.noteQuality.reasoningScore,
            details: this.noteQuality.details
        };
    },

    _parseDose(doseStr) {
        if (!doseStr) return 0;
        const match = String(doseStr).match(/(\d+\.?\d*)/);
        return match ? parseFloat(match[1]) : 0;
    },

    /**
     * Get a summary of current tracking state (for debug)
     */
    getDebugSummary() {
        const patientAsked = Object.values(this.patientHistoryItems).filter(i => i.asked).length;
        const nurseAsked = Object.values(this.nurseHistoryItems).filter(i => i.asked).length;
        const chartViewed = Object.values(this.chartReviewItems).filter(i => i.viewed).length;
        const medsOrdered = Object.values(this.medicationOrders).filter(i => i.ordered).length;
        const safetyViolations = Object.values(this.medicationOrders).filter(i => 'safe' in i && !i.safe).length;

        return {
            patientHistory: `${patientAsked}/${Object.keys(this.patientHistoryItems).length}`,
            nurseInteraction: `${nurseAsked}/${Object.keys(this.nurseHistoryItems).length}`,
            chartReview: `${chartViewed}/${Object.keys(this.chartReviewItems).length}`,
            medicationsOrdered: medsOrdered,
            safetyViolations,
            allergyViolations: this.allergyViolations.length,
            emotionalTriggerFired: this.emotionalTriggerFired
        };
    },

    // ========== COPILOT SUPPORT METHODS ==========

    /**
     * Get progress summary for each scoring domain
     * Returns { domainName: { earned, total, percentage, count, countTotal } }
     */
    getProgressSummary() {
        const summary = {};

        // Patient History
        const phItems = Object.values(this.patientHistoryItems);
        const phEarned = phItems.filter(i => i.asked).reduce((s, i) => s + i.points, 0);
        const phTotal = phItems.reduce((s, i) => s + i.points, 0);
        summary.patientHistory = {
            earned: phEarned, total: phTotal,
            percentage: phTotal > 0 ? Math.round((phEarned / phTotal) * 100) : 0,
            count: phItems.filter(i => i.asked).length, countTotal: phItems.length,
            label: 'Hx', fullLabel: 'Patient History'
        };

        // Nurse Interaction
        const niItems = Object.values(this.nurseHistoryItems);
        const niEarned = niItems.filter(i => i.asked).reduce((s, i) => s + i.points, 0);
        const niTotal = niItems.reduce((s, i) => s + i.points, 0);
        summary.nurseInteraction = {
            earned: niEarned, total: niTotal,
            percentage: niTotal > 0 ? Math.round((niEarned / niTotal) * 100) : 0,
            count: niItems.filter(i => i.asked).length, countTotal: niItems.length,
            label: 'Nurse', fullLabel: 'Nurse Interaction'
        };

        // Chart Review
        const crItems = Object.values(this.chartReviewItems);
        const crEarned = crItems.filter(i => i.viewed).reduce((s, i) => s + i.points, 0);
        const crTotal = crItems.reduce((s, i) => s + i.points, 0);
        summary.chartReview = {
            earned: crEarned, total: crTotal,
            percentage: crTotal > 0 ? Math.round((crEarned / crTotal) * 100) : 0,
            count: crItems.filter(i => i.viewed).length, countTotal: crItems.length,
            label: 'Chart', fullLabel: 'Chart Review'
        };

        // Medication Orders (exclude safety items)
        const moItems = Object.entries(this.medicationOrders).filter(([k, v]) => v.category !== 'safety');
        const moEarned = moItems.filter(([k, v]) => v.ordered).reduce((s, [k, v]) => s + v.points, 0);
        const moTotal = moItems.reduce((s, [k, v]) => s + v.points, 0);
        summary.orders = {
            earned: moEarned, total: moTotal,
            percentage: moTotal > 0 ? Math.round((moEarned / moTotal) * 100) : 0,
            count: moItems.filter(([k, v]) => v.ordered).length, countTotal: moItems.length,
            label: 'Orders', fullLabel: 'Medication Management'
        };

        // Safety
        const safetyItems = Object.entries(this.medicationOrders).filter(([k, v]) => v.category === 'safety');
        const allSafe = safetyItems.every(([k, v]) => v.safe);
        summary.safety = {
            earned: allSafe ? 100 : 0, total: 100,
            percentage: allSafe ? 100 : (100 - this.allergyViolations.length * 30),
            count: safetyItems.filter(([k, v]) => v.safe).length, countTotal: safetyItems.length,
            label: 'Safety', fullLabel: 'Safety & Allergies',
            isSafe: allSafe
        };

        // Empathy
        if (!this.emotionalTriggerFired) {
            summary.empathy = {
                earned: 0, total: 0, percentage: -1, // -1 = not yet applicable
                count: 0, countTotal: 0,
                label: 'Empathy', fullLabel: 'Empathy & Communication'
            };
        } else {
            const emItems = Object.values(this.empathyItems);
            const emEarned = emItems.filter(i => i.earned).reduce((s, i) => s + i.points, 0);
            const emTotal = emItems.reduce((s, i) => s + i.points, 0);
            summary.empathy = {
                earned: emEarned, total: emTotal,
                percentage: emTotal > 0 ? Math.round((emEarned / emTotal) * 100) : 0,
                count: emItems.filter(i => i.earned).length, countTotal: emItems.length,
                label: 'Empathy', fullLabel: 'Empathy & Communication'
            };
        }

        // EKG Interpretation
        summary.ekgInterpretation = {
            earned: this.ekgInterpretation.submitted ? this.ekgInterpretation.score : 0,
            total: 100,
            percentage: this.ekgInterpretation.submitted ? this.ekgInterpretation.score : -1,
            count: this.ekgInterpretation.submitted ? 1 : 0, countTotal: 1,
            label: 'EKG', fullLabel: 'EKG Interpretation'
        };

        // Note Quality
        if (this.noteQuality.submitted) {
            const noteCombined = Math.round(this.noteQuality.thoroughnessScore * 0.5 + this.noteQuality.reasoningScore * 0.5);
            summary.noteQuality = {
                earned: noteCombined, total: 100,
                percentage: noteCombined,
                count: 1, countTotal: 1,
                label: 'Note', fullLabel: 'Note Quality'
            };
        } else {
            summary.noteQuality = {
                earned: 0, total: 100, percentage: -1,
                count: 0, countTotal: 1,
                label: 'Note', fullLabel: 'Note Quality'
            };
        }

        // Overall (updated weights)
        const weights = { patientHistory: 0.15, nurseInteraction: 0.10, chartReview: 0.10, orders: 0.20, safety: 0.10, empathy: 0.10, ekgInterpretation: 0.10, noteQuality: 0.15 };
        let overall = 0;
        for (const [key, weight] of Object.entries(weights)) {
            const pct = summary[key].percentage === -1 ? 50 : summary[key].percentage;
            overall += pct * weight;
        }
        summary.overall = Math.round(overall);

        return summary;
    },

    /**
     * Get top priority nudges — highest-point uncompleted items
     */
    getTopNudges(count = 3) {
        const nudges = [];

        // Patient history items not yet asked
        for (const [key, item] of Object.entries(this.patientHistoryItems)) {
            if (!item.asked) {
                nudges.push({
                    domain: 'Patient', text: item.label.replace('Asked about ', 'Ask about '),
                    points: item.points, action: null, domainColor: '#3b82f6'
                });
            }
        }

        // Nurse items not yet asked
        for (const [key, item] of Object.entries(this.nurseHistoryItems)) {
            if (!item.asked) {
                nudges.push({
                    domain: 'Nurse', text: item.label.replace('Asked ', 'Ask ').replace('Communicated ', 'Communicate '),
                    points: item.points, action: null, domainColor: '#8b5cf6'
                });
            }
        }

        // Chart review items not viewed
        const routeMap = {
            problemList: '/problems', resolvedProblems: '/problems',
            medicationList: '/medications', allergyList: '/allergies',
            labResults: '/labs', notes: '/notes', giConsultNote: '/notes'
        };
        for (const [key, item] of Object.entries(this.chartReviewItems)) {
            if (!item.viewed) {
                nudges.push({
                    domain: 'Chart', text: item.label.replace('Viewed ', 'Review ').replace('Read ', 'Read '),
                    points: item.points, action: `#${routeMap[key] || '/chart-review'}`, domainColor: '#10b981'
                });
            }
        }

        // Critical/important medication orders not yet placed
        for (const [key, item] of Object.entries(this.medicationOrders)) {
            if ('ordered' in item && !item.ordered && (item.category === 'critical' || item.category === 'important')) {
                nudges.push({
                    domain: 'Orders', text: `Order: ${item.label}`,
                    points: item.points, action: '#/orders', domainColor: '#f59e0b'
                });
            }
        }

        // Sort by points descending
        nudges.sort((a, b) => b.points - a.points);
        return nudges.slice(0, count);
    },

    /**
     * Get time-sensitive nudges based on elapsed simulation time
     */
    getTemporalNudges() {
        if (typeof SimulationEngine === 'undefined' || !SimulationEngine.isRunning) return [];

        const elapsed = SimulationEngine.getElapsedMinutes();
        const nudges = [];

        // After 15 min, if no diuretic ordered
        if (elapsed >= 15 && !this.medicationOrders.ivFurosemide.ordered) {
            nudges.push({
                text: `${Math.round(elapsed)} min elapsed — no diuretic ordered yet`,
                severity: elapsed >= 30 ? 'critical' : 'warning'
            });
        }

        // After 10 min, if allergies not reviewed
        if (elapsed >= 10 && !this.chartReviewItems.allergyList.viewed) {
            nudges.push({
                text: 'Review the allergy list before ordering medications',
                severity: 'warning'
            });
        }

        // After 20 min, if patient history sparse
        const historyAsked = Object.values(this.patientHistoryItems).filter(i => i.asked).length;
        if (elapsed >= 20 && historyAsked < 4) {
            nudges.push({
                text: 'Limited patient history gathered — keep asking questions',
                severity: 'info'
            });
        }

        return nudges;
    }
};

window.SimulationScoreTracker = SimulationScoreTracker;
