#!/usr/bin/env node
// Prints tools/live/runs/index.tsv (one line per scored replay) as an aligned table.
//   node tools/live/runs-table.mjs [--last=10]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = path.join(ROOT, 'tools/live/runs/index.tsv');
if (!fs.existsSync(file)) { console.log('No runs yet.'); process.exit(0); }
const last = parseInt((process.argv.find((a) => a.startsWith('--last=')) || '--last=12').split('=')[1], 10);
const [head, ...rows] = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const keep = ['run', 'prompts', 'brain', 'mode', 'memory', 'must', 'answers', 'false_alarms', 'extras', 'repeats', 'wrong', 'alert_ms_med', 'answer_first_ms', 'cost', 'label'];
const idx = keep.map((k) => head.indexOf(k));
const table = [keep].concat(rows.slice(-last).map((r) => idx.map((i) => {
    const v = i < 0 ? '' : (r[i] || '');
    return /^\d+(\.\d+)?$/.test(v) && v.includes('.') ? (+v).toFixed(v.length > 6 ? 3 : 2) : v;
})));
table.forEach((r) => { r[0] = r[0].slice(5, 16).replace('T', ' '); });
const w = keep.map((_, c) => Math.max(...table.map((r) => String(r[c]).length)));
for (const r of table) console.log(r.map((v, c) => String(v).padEnd(w[c])).join('  '));
