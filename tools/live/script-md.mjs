#!/usr/bin/env node
// Renders a scripted encounter (data/live/*.json) as a Markdown review sheet:
// the conversation with the planted moments marked, then the answer key.
//   node tools/live/script-md.mjs [data/live/morrison-admission-01.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = path.resolve(ROOT, process.argv[2] || 'data/live/morrison-admission-01.json');
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
const t = (x) => Math.floor(x / 60) + ':' + String(Math.round(x % 60)).padStart(2, '0');
const byCue = {};
for (const e of s.expect) (byCue[e.cue] = byCue[e.cue] || []).push(e);
for (const q of s.quiet) (byCue[q.cue] = byCue[q.cue] || []).push(Object.assign({ type: 'quiet' }, q));
const tag = (e) => (e.type === 'speak' ? (e.level === 'must' ? '🚨 ' : '💡 ') + e.id : e.type === 'answer' ? '💬 ' + e.id : '🤫 ' + e.id);

const out = [];
out.push('# ' + s.title, '');
out.push(s.setting, '');
out.push('Speakers: ' + Object.values(s.speakers).join(', ') + '. Length ' + t(s.duration_s) + ', ' + s.lines.length + ' lines.', '');
out.push('Markers: 🚨 the coworker must speak up unprompted (every mode) · 💡 speak up in Lead mode · 💬 a question to the coworker · 🤫 it should stay quiet.', '');
out.push('## The conversation', '');
out.push('| Time | Who | Line | Key |', '|---|---|---|---|');
for (const l of s.lines) {
    const marks = (byCue[l.id] || []).map(tag).join(' ');
    out.push('| ' + t(l.t) + ' | ' + (s.speakers[l.speaker] || l.speaker).split(' (')[0] + ' | ' + l.text.replace(/\|/g, '/') + ' | ' + marks + ' |');
}
out.push('', '## What the coworker should say', '');
for (const e of s.expect.filter((x) => x.type === 'speak')) {
    out.push('- **' + tag(e) + '** (after ' + e.cue + ', within ' + e.window_s + ' s' + (e.level === 'lead' ? '; Lead mode, optional in the others' : '') + '): ' + e.summary);
}
out.push('', '## Questions and the answers expected', '');
for (const q of s.expect.filter((x) => x.type === 'answer')) {
    const line = s.lines.find((l) => l.id === q.cue);
    out.push('- **' + q.id + '** "' + (line ? line.text.replace(/^Coworker, /, '') : q.cue) + '": ' + q.summary);
}
out.push('', '## Moments to stay quiet', '');
for (const q of s.quiet) out.push('- **' + q.id + '** (' + q.cue + '): ' + q.why);
out.push('', '## Scoring', '');
for (const [k, v] of Object.entries(s.scoring)) out.push('- **' + k + '**: ' + v);
const md = out.join('\n') + '\n';
const dest = file.replace(/\.json$/, '.md');
fs.writeFileSync(dest, md);
console.log('Wrote ' + path.relative(ROOT, dest) + ' (' + md.length + ' chars)');
