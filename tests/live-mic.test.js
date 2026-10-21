// The live coworker's room mic (lab, 21 Oct 2026; Kevin approved the relay change):
// Deepgram's medical model, listening for this patient's drug names. Callers that
// pass nothing (classic dictation) must connect exactly as before.
// The relay itself is tested in tests/server-routes.test.js.
// Run: node tests/live-mic.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const LiveChart = require(path.join(ROOT, 'js/live/live-chart.js'));

let fail = 0;
const check = async (name, fn) => {
    try { await fn(); console.log('PASS  ' + name); } catch (e) { fail++; console.log('FAIL  ' + name + ' -> ' + ((e && e.stack) || e)); }
};

// The relay's rule for one key term (server.js deepgramOptions).
const RELAY_OK = /^[A-Za-z0-9][A-Za-z0-9 .'\/-]{1,39}$/;

/** Load js/services/deepgram-client.js with stand-ins for the browser's mic and sockets. */
function loadClient() {
    const opened = [];
    class FakeWebSocket { constructor(url) { opened.push(url); this.readyState = 0; } send() {} close() {} }
    FakeWebSocket.OPEN = 1;
    class FakeAudioContext {
        constructor() { this.destination = {}; }
        createMediaStreamSource() { return { connect() {} }; }
        createScriptProcessor() { return { connect() {}, disconnect() {} }; }
        close() { return Promise.resolve(); }
    }
    const window = { location: { protocol: 'https:', host: 'lab.example' }, AudioContext: FakeAudioContext };
    const ctx = vm.createContext({
        window, WebSocket: FakeWebSocket, URLSearchParams,
        navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
        console: { log() {}, warn() {}, error() {} },
    });
    const code = fs.readFileSync(path.join(ROOT, 'js/services/deepgram-client.js'), 'utf8');
    const client = vm.runInContext(code + '\n;DeepgramClient', ctx);
    return { client, opened };
}

(async () => {
    const dir = path.join(ROOT, 'data/patients/PAT001');
    const chart = LiveChart.create({ patientId: 'PAT001', loadJSON: async (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')) });
    await chart.load();

    await check('key terms: this patient\'s medicines (brand and generic), allergies and common inpatient drugs, within the caps', () => {
        const terms = chart.speechTerms();
        for (const t of ['Entresto', 'sacubitril valsartan', 'furosemide', 'Lantus', 'penicillin', 'lisinopril', 'Zosyn', 'diltiazem', 'heparin', 'pneumonia']) {
            assert.ok(terms.includes(t), 'missing ' + t + ' in ' + terms.join(', '));
        }
        assert.ok(terms.length <= 50, terms.length + ' terms');
        assert.ok(terms.join('').length <= 900, terms.join('').length + ' characters');
        assert.strictEqual(new Set(terms.map((t) => t.toLowerCase())).size, terms.length, 'duplicates');
        for (const t of terms) assert.match(t, RELAY_OK, 'the relay would drop ' + JSON.stringify(t));
        assert.ok(!terms.some((t) => /hcl|succinate|acetylsalicylic|cholecalciferol/i.test(t)), 'salts and unspoken generics are left out');
    });

    await check('key terms: a chart with nothing in it still gets the inpatient list', async () => {
        const empty = LiveChart.create({ patientId: 'X', loadJSON: async () => { throw new Error('missing'); } });
        await empty.load().catch(() => {});
        const terms = empty.speechTerms();
        assert.ok(terms.includes('Zosyn') && terms.length === LiveChart.INPATIENT_TERMS.length, terms.join(', '));
    });

    await check('mic client: no options connects exactly as before (classic dictation unchanged)', async () => {
        const { client, opened } = loadClient();
        await client.start();
        assert.deepStrictEqual(opened, ['wss://lab.example/ws/transcribe']);
    });

    await check('mic client: the live coworker asks for the medical model and passes its key terms', async () => {
        const { client, opened } = loadClient();
        await client.start({ model: 'medical', keyterms: ['Entresto', 'sacubitril valsartan', 'Zosyn'] });
        const u = new URL(opened[0]);
        assert.strictEqual(u.origin + u.pathname, 'wss://lab.example/ws/transcribe');
        assert.strictEqual(u.searchParams.get('model'), 'medical');
        assert.deepStrictEqual(u.searchParams.getAll('keyterm'), ['Entresto', 'sacubitril valsartan', 'Zosyn']);
    });

    process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  crashed -> ' + ((e && e.stack) || e)); process.exit(1); });
