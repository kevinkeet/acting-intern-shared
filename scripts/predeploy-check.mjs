#!/usr/bin/env node
// Checks before a push to main, which deploys actingintern.com while the TEACH-AI study is
// running (guardrails, 21 Oct 2026). The pre-push hook (scripts/git-hooks/pre-push) calls this
// with the range being pushed. By hand:
//   node scripts/predeploy-check.mjs                 (checks origin/main..HEAD)
//   node scripts/predeploy-check.mjs <base> <head>
// 1. Freeze windows: scripts/deploy-freeze.json.
// 2. Study-protected files: scripts/study-protected.txt (index.html may change cache versions only).
// 3. Exports <head> to a temp folder and runs there, so the checks see exactly what is pushed:
//    node --check on changed JS, every tests/*.test.js, and the browser smoke test.
// Overrides for one push, only after Kevin's OK in chat:
//   TEACHAI_FREEZE_OK=1  TEACHAI_STUDY_OK=1  TEACHAI_SKIP_SMOKE=1 (e.g. no Chrome on this machine)
// TEACHAI_NOW=<ISO time> pretends it is another time (for testing the freeze windows).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOP = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const COMMON = path.resolve(TOP, execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', cwd: TOP }).trim());
const git = (...a) => execFileSync('git', ['-C', TOP, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const [base = 'origin/main', headArg = 'HEAD'] = process.argv.slice(2);
const head = git('rev-parse', headArg).trim();
const env = process.env;
const blockers = [];
const say = (s) => console.log(s);
const showAt = (file) => { try { return git('show', head + ':' + file); } catch (e) { return null; } };

// 1. Freeze windows
const now = env.TEACHAI_NOW ? Date.parse(env.TEACHAI_NOW) : Date.now();
let freeze = { windows: [] };
try { freeze = JSON.parse(showAt('scripts/deploy-freeze.json') || fs.readFileSync(path.join(TOP, 'scripts/deploy-freeze.json'), 'utf8')); }
catch (e) { blockers.push('could not read scripts/deploy-freeze.json: ' + e.message); }
for (const w of freeze.windows || []) {
    if (now >= Date.parse(w.from) && now < Date.parse(w.until)) {
        if (env.TEACHAI_FREEZE_OK === '1') say('FREEZE  ' + w.label + ' (TEACHAI_FREEZE_OK=1 set, continuing)');
        else blockers.push('deploy freeze: ' + w.label + '. No pushes to main until ' + w.until + '. Override for one push with TEACHAI_FREEZE_OK=1, only with Kevin\'s OK.');
    }
}

// 2. Study-protected files
const changed = git('diff', '--name-only', base, head).split('\n').filter(Boolean);
const patterns = (showAt('scripts/study-protected.txt') || '').split('\n')
    .map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
const toRegex = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
const rules = patterns.map((p) => ({ p, re: toRegex(p) }));
const onlyCacheVersionChanged = () => {
    const removed = [], added = [];
    for (const line of git('diff', '-U0', base, head, '--', 'index.html').split('\n')) {
        if (line.startsWith('---') || line.startsWith('+++')) continue;
        if (line.startsWith('-')) removed.push(line.slice(1));
        else if (line.startsWith('+')) added.push(line.slice(1));
    }
    const norm = (l) => l.replace(/\?v=\d{8}[A-Za-z]*/g, '?v=X').replace(/__CACHE_V = '\d{8}[A-Za-z]*'/g, "__CACHE_V = 'X'");
    return removed.length === added.length && removed.every((l, i) => norm(l) === norm(added[i]));
};
const touched = changed.filter((f) => rules.some((r) => r.re.test(f)))
    .filter((f) => !(f === 'index.html' && onlyCacheVersionChanged()));
say('Pushing ' + base.slice(0, 12) + '..' + head.slice(0, 12) + ': ' + changed.length + ' file(s) changed');
if (touched.length) {
    say('STUDY-PROTECTED files in this push:\n' + touched.map((f) => '        ' + f).join('\n'));
    if (env.TEACHAI_STUDY_OK === '1') say('        (TEACHAI_STUDY_OK=1 set, continuing)');
    else blockers.push(touched.length + ' study-protected file(s) changed. Get Kevin\'s OK for these changes, then push once with TEACHAI_STUDY_OK=1.');
}

if (blockers.length) {
    for (const b of blockers) say('BLOCKED ' + b);
    process.exit(1);
}

// Who is working right now (informational; never blocks). study_pulse() is readable with the
// site's public key and shows each code's latest case start or finish, not names or arms.
try {
    const html = fs.readFileSync(path.join(TOP, 'index.html'), 'utf8') + fs.readFileSync(path.join(TOP, 'js/services/supabase-sync.js'), 'utf8');
    const anon = (html.match(/__SUPABASE_ANON_KEY\s*=\s*["']([^"']+)/) || [])[1];
    const supa = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
    const res = await fetch(supa + '/rest/v1/rpc/study_pulse', { method: 'POST', body: '{}',
        headers: { apikey: anon, Authorization: 'Bearer ' + anon, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000) });
    const d = await res.json();
    const asOf = Date.parse(d.as_of);
    const mins = (t) => Math.round((asOf - Date.parse(t)) / 60000);
    const active = (d.progress || []).filter((p) => p.done < 3 && mins(p.last) <= 90);
    say('Residents: last case start or finish ' + mins(d.last_activity) + ' min ago; ' +
        (active.length ? active.length + ' unfinished participant(s) active in the last 90 min.' : 'nobody active in the last 90 min.'));
    if (active.length) say('WARNING someone may be mid-case. Their open page keeps working and answers save straight to the database, but a quiet moment is better (mornings have been quiet).');
} catch (e) {
    say('Residents: could not check recent activity (' + e.message + ').');
}

// 3. Tests on exactly what is being pushed
const marker = path.join(COMMON, 'teachai-checked', head + (env.TEACHAI_SKIP_SMOKE === '1' ? '-nosmoke' : ''));
if (fs.existsSync(marker) && Date.now() - fs.statSync(marker).mtimeMs < 60 * 60 * 1000) {
    say('Tests and smoke test already passed for ' + head.slice(0, 12) + ' in the last hour (pushing to the second remote).');
    process.exit(0);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teachai-predeploy-'));
let failed = false;
try {
    const ex = spawnSync('sh', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'sh', TOP, head, tmp], { encoding: 'utf8' });
    if (ex.status !== 0) throw new Error('could not export ' + head + ': ' + ex.stderr);
    if (fs.existsSync(path.join(TOP, 'node_modules'))) fs.symlinkSync(path.join(TOP, 'node_modules'), path.join(tmp, 'node_modules'));
    else {
        say('Installing server dependencies for the tests (npm ci)...');
        const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund', '--silent'], { cwd: tmp, encoding: 'utf8' });
        if (ci.status !== 0) throw new Error('npm ci failed: ' + ci.stderr);
    }

    for (const f of changed.filter((x) => /\.(m|c)?js$/.test(x) && fs.existsSync(path.join(tmp, x)))) {
        const r = spawnSync(process.execPath, ['--check', path.join(tmp, f)], { encoding: 'utf8' });
        if (r.status !== 0) { failed = true; say('SYNTAX  ' + f + '\n' + r.stderr); }
    }
    for (const t of fs.readdirSync(path.join(tmp, 'tests')).filter((x) => x.endsWith('.test.js')).sort()) {
        const r = spawnSync(process.execPath, [path.join('tests', t)], { cwd: tmp, encoding: 'utf8', timeout: 120000 });
        if (r.status === 0) say('ok      tests/' + t);
        else { failed = true; say('FAILED  tests/' + t + '\n' + (r.stdout + r.stderr).split('\n').filter((l) => !l.startsWith('PASS')).join('\n')); }
    }
    if (env.TEACHAI_SKIP_SMOKE === '1') say('SKIPPED browser smoke test (TEACHAI_SKIP_SMOKE=1)');
    else {
        say('Running the browser smoke test (about a minute)...');
        const r = spawnSync(process.execPath, ['scripts/smoke-study.mjs'], { cwd: tmp, encoding: 'utf8', timeout: 300000 });
        const lines = (r.stdout + r.stderr).split('\n').filter((l) => /^(PASS|FAIL|SMOKE|Smoke| {6})/.test(l));
        say(lines.join('\n'));
        if (r.status !== 0) failed = true;
    }
} catch (e) {
    failed = true;
    say('ERROR   ' + e.message);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
if (failed) { say('BLOCKED checks failed; nothing was pushed.'); process.exit(1); }
fs.mkdirSync(path.dirname(marker), { recursive: true });
fs.writeFileSync(marker, new Date().toISOString() + '\n');
say('All pre-deploy checks passed.');
