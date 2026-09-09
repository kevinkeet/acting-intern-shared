/**
 * AssessmentChartGate — restricts chart visibility during an active assessment
 * by filtering dataLoader's outputs to entries on/before the AP's anchorDate.
 *
 * Monkey-patches the global `dataLoader` instance so BOTH the chart UI and the
 * AI assistant's tools (which read through dataLoader) see the same gated view.
 *
 * Usage:
 *   AssessmentChartGate.activate({ caseId, anchorDateIso });
 *   ...resident interacts with chart and AI...
 *   AssessmentChartGate.advance(newAnchorDateIso);   // move forward to next AP
 *   AssessmentChartGate.deactivate();                // restore originals
 *
 * The gate only applies to the case it was activated for; if the user switches
 * patients, the gate is automatically deactivated.
 */

const AssessmentChartGate = (() => {
    let _active = false;
    let _caseId = null;
    let _anchorMs = null;   // epoch ms cutoff inclusive
    let _originals = null;  // map: methodName → original dataLoader method
    let _visibleSections = new Set();  // for logger: which sections were viewed

    const LOG = (...args) => console.log('⏳ ChartGate', ...args);

    // ── helpers ────────────────────────────────────────────────────────

    /**
     * Pull a usable date string out of an arbitrary chart item.
     * We check common field names in priority order.
     */
    function _itemDate(item) {
        if (!item || typeof item !== 'object') return null;
        return (
            item.date ||
            item.collectedDate ||
            item.resultedDate ||
            item.studyDate ||
            item.orderDate ||
            item.performedDate ||
            item.encounterDate ||
            item.startDate ||  // medications — only show if started ≤ anchor
            null
        );
    }

    /**
     * True if item's date is on/before the gate's anchor.
     * Items without any recognizable date pass through (we don't want to
     * accidentally hide static documents like demographics or family history).
     */
    function _passesGate(item) {
        if (!_active) return true;
        const d = _itemDate(item);
        if (!d) return true;
        const ms = Date.parse(d);
        if (Number.isNaN(ms)) return true;
        return ms <= _anchorMs;
    }

    function _filterArray(arr) {
        if (!Array.isArray(arr)) return arr;
        return arr.filter(_passesGate);
    }

    // An encounter can START before the anchor yet carry a retrospective
    // status written after it ("Discharged 7/11 on apixaban", "made CMO at
    // 2 weeks, then unexpectedly recovered"). The date gate lets the
    // encounter through, and the status hands the participant the case's
    // outcome (pilot report 6718, 9 Sep). Redact any outcome text that
    // reaches past the anchor and present the encounter as still open.
    function _sanitizeEncounter(enc) {
        if (!enc || typeof enc !== 'object' || !_anchorMs) return enc;
        const endIso = enc.dischargeDate || enc.endDate || enc.end || null;
        const endMs = endIso ? Date.parse(endIso) : NaN;
        const endsAfterAnchor = !Number.isNaN(endMs) && endMs > _anchorMs;
        const anchorYear = new Date(_anchorMs).getUTCFullYear();
        const textAfterAnchor = (txt) => {
            if (!txt) return false;
            // M/D/YYYY, or year-less M/D ("as of 6/14") read in the anchor's year
            const re = /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d))?\b/g;
            let m;
            while ((m = re.exec(String(txt))) !== null) {
                const y = m[3] || String(anchorYear);
                const ms = Date.parse(`${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T00:00:00Z`);
                if (!Number.isNaN(ms) && ms > _anchorMs) return true;
            }
            return false;
        };
        const leaky = endsAfterAnchor ||
            ['status', 'disposition', 'outcome', 'summary', 'hospitalCourse'].some((k) => textAfterAnchor(enc[k]));
        if (!leaky) return enc;
        const out = { ...enc };
        const started = enc.date ? new Date(enc.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : null;
        out.status = started ? `In progress (admitted ${started})` : 'In progress';
        ['disposition', 'outcome', 'summary', 'hospitalCourse', 'dischargeDate', 'endDate', 'end', 'dischargeDisposition', 'lengthOfStay'].forEach((k) => { if (k in out) delete out[k]; });
        return out;
    }

    function _markSection(name) {
        _visibleSections.add(name);
    }

    // ── activation ─────────────────────────────────────────────────────

    function activate({ caseId, anchorDateIso }) {
        if (!anchorDateIso) {
            console.warn('ChartGate.activate called without anchorDateIso');
            return;
        }
        _caseId = caseId || null;
        _anchorMs = Date.parse(anchorDateIso);
        if (Number.isNaN(_anchorMs)) {
            console.warn('ChartGate.activate: invalid anchorDateIso', anchorDateIso);
            return;
        }

        if (typeof dataLoader === 'undefined') {
            console.warn('ChartGate.activate: dataLoader not available');
            return;
        }

        // Clear any cached, un-gated results from prior loads.
        try { dataLoader.clearCache(); } catch (e) { /* ignore */ }

        if (!_originals) _installPatches();
        _active = true;
        LOG('Activated for', caseId, '@', anchorDateIso);
    }

    function advance(newAnchorDateIso) {
        if (!_active) return activate({ caseId: _caseId, anchorDateIso: newAnchorDateIso });
        const ms = Date.parse(newAnchorDateIso);
        if (Number.isNaN(ms)) {
            console.warn('ChartGate.advance: invalid date', newAnchorDateIso);
            return;
        }
        _anchorMs = ms;
        try { dataLoader.clearCache(); } catch (e) { /* ignore */ }
        LOG('Advanced to', newAnchorDateIso);
    }

    function deactivate() {
        if (!_active) return;
        _restorePatches();
        _active = false;
        _caseId = null;
        _anchorMs = null;
        try { dataLoader.clearCache(); } catch (e) { /* ignore */ }
        LOG('Deactivated');
    }

    function isActive() { return _active; }
    function getAnchor() { return _anchorMs ? new Date(_anchorMs).toISOString() : null; }
    function getCaseId() { return _caseId; }

    function getVisibleSections() {
        return Array.from(_visibleSections);
    }

    function resetVisibleSections() {
        _visibleSections = new Set();
    }

    // ── patches ────────────────────────────────────────────────────────

    function _installPatches() {
        _originals = {};

        const wrap = (name, transform) => {
            _originals[name] = dataLoader[name].bind(dataLoader);
            dataLoader[name] = async function (...args) {
                const result = await _originals[name](...args);
                return transform(result);
            };
        };

        // Notes
        wrap('loadNotesIndex', (data) => {
            _markSection('notes');
            if (!data) return data;
            return { ...data, notes: _filterArray(data.notes) };
        });
        wrap('loadNote', (data) => {
            _markSection('notes');
            if (!data) return data;
            // Hide note content for future notes by throwing.
            if (!_passesGate(data)) {
                const err = new Error('Note not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });

        // Labs (index + panel)
        wrap('loadLabsIndex', (data) => {
            _markSection('labs');
            if (!data) return data;
            return { ...data, panels: _filterArray(data.panels) };
        });
        wrap('loadLabPanel', (data) => {
            _markSection('labs');
            if (!data) return data;
            if (!_passesGate(data)) {
                const err = new Error('Lab panel not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });
        // loadAllLabs aggregates panels — the panel calls above will filter
        // upstream via loadLabsIndex(), so just re-mark the section.
        wrap('loadAllLabs', (data) => {
            _markSection('labs');
            if (!Array.isArray(data)) return data;
            return data.filter(_passesGate);
        });

        // Encounters
        wrap('loadEncounters', (data) => {
            _markSection('encounters');
            if (!data) return data;
            const list = _filterArray(data.encounters);
            return { ...data, encounters: Array.isArray(list) ? list.map(_sanitizeEncounter) : list };
        });
        wrap('loadEncounter', (data) => {
            _markSection('encounters');
            if (!data) return data;
            if (!_passesGate(data)) {
                const err = new Error('Encounter not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            data = _sanitizeEncounter(data);
            return data;
        });

        // Imaging
        wrap('loadImaging', (data) => {
            _markSection('imaging');
            if (!data) return data;
            return { ...data, studies: _filterArray(data.studies) };
        });
        wrap('loadImagingReport', (data) => {
            _markSection('imaging');
            if (!data) return data;
            if (!_passesGate(data)) {
                const err = new Error('Imaging report not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });

        // Vitals
        wrap('loadVitals', (data) => {
            _markSection('vitals');
            if (!data) return data;
            return { ...data, vitals: _filterArray(data.vitals) };
        });

        // Procedures
        wrap('loadProcedures', (data) => {
            _markSection('procedures');
            if (!data) return data;
            return { ...data, procedures: _filterArray(data.procedures) };
        });

        // Orders — filter by orderDate
        wrap('loadOrders', (data) => {
            _markSection('orders');
            if (!data) return data;
            return {
                ...data,
                active: _filterArray(data.active),
                completed: _filterArray(data.completed),
                discontinued: _filterArray(data.discontinued),
            };
        });

        // Medications — gate by startDate; show active meds whose course
        // had started by anchor date. (Static lists like allergies, demographics,
        // social/family history, immunizations, problems are NOT gated since
        // they're treated as standing chart documents the resident is given.)
        wrap('loadActiveMedications', (data) => {
            _markSection('medications');
            if (!data) return data;
            return { ...data, medications: _filterArray(data.medications) };
        });
        wrap('loadMedications', (data) => {
            _markSection('medications');
            if (!data) return data;
            const filter = (sub) => sub ? { ...sub, medications: _filterArray(sub.medications) } : sub;
            return {
                ...data,
                active: filter(data.active),
                historical: filter(data.historical),
            };
        });

        // Problems — gate by item.date (added per-problem in PAT002 problems/
        // active.json so onset-dated entries are filtered correctly). Problems
        // without a `date` field pass through (we never want to accidentally
        // hide entries that lack a recognizable date).
        wrap('loadProblems', (data) => {
            _markSection('problems');
            if (!data) return data;
            const filter = (sub) => sub ? { ...sub, problems: _filterArray(sub.problems) } : sub;
            return {
                ...data,
                active: filter(data.active),
                resolved: filter(data.resolved),
            };
        });
        wrap('loadActiveProblems', (data) => {
            _markSection('problems');
            if (!data) return data;
            return { ...data, problems: _filterArray(data.problems) };
        });
    }

    function _restorePatches() {
        if (!_originals) return;
        for (const [name, fn] of Object.entries(_originals)) {
            dataLoader[name] = fn;
        }
        _originals = null;
    }

    // ── module bootstrap ───────────────────────────────────────────────

    // If something else triggers a patient switch while the gate is active,
    // deactivate so we don't leak the gate onto an unrelated patient.
    window.addEventListener('assessment:patient-switch-detected', () => {
        if (_active) {
            LOG('Patient switch detected — auto-deactivating gate');
            deactivate();
        }
    });

    return {
        activate,
        advance,
        deactivate,
        isActive,
        getAnchor,
        getCaseId,
        getVisibleSections,
        resetVisibleSections,
    };
})();

window.AssessmentChartGate = AssessmentChartGate;
