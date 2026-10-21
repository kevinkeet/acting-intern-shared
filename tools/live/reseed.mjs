#!/usr/bin/env node
// Reloads a saved full Deep Learn into the classic coworker by copying
// data/live/<PATIENT>-ai-seed-full.json over data/patients/<PATIENT>/ai-seed.json
// (the app applies that file whenever a browser has no memory for the patient,
// which is every fresh page load). The live coworker needs no reseed: it reads
// data/live/<PATIENT>-deep-memory.json directly.
//
//   node tools/live/reseed.mjs            PAT001
//   node tools/live/reseed.mjs PAT001 --check   only validate the saved file
//
// Both files are in git, so an earlier seed can always be restored with
// `git checkout <commit> -- data/patients/PAT001/ai-seed.json`. When this goes
// to main, bump the cache version in index.html (no study files change: PAT001
// is not a study patient).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const patient = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'PAT001';
const checkOnly = process.argv.includes('--check');
if (/^PAT00[3-7]$/.test(patient)) { console.error(patient + ' is a study patient (study-protected); not touching it.'); process.exit(1); }

const src = path.join(ROOT, 'data/live', patient + '-ai-seed-full.json');
const dest = path.join(ROOT, 'data/patients', patient, 'ai-seed.json');
if (!fs.existsSync(src)) { console.error('No saved Deep Learn at ' + path.relative(ROOT, src) + ' (run tools/live/deeplearn.mjs first).'); process.exit(1); }

const seed = JSON.parse(fs.readFileSync(src, 'utf8'));
const md = seed.longitudinalDoc && seed.longitudinalDoc.aiMemory && seed.longitudinalDoc.aiMemory.memoryDocument;
const problems = [];
if (!md) problems.push('no memoryDocument');
if (!seed.deepLearn || !(seed.deepLearn.processedCount > 0)) problems.push('no Deep Learn progress');
if (md && !(md.problemAnalysis || []).length) problems.push('empty problem analysis');
if (problems.length) { console.error('Saved file looks wrong: ' + problems.join(', ')); process.exit(1); }

console.log(path.relative(ROOT, src) + ': ' + seed.deepLearn.processedCount + '/' + seed.deepLearn.totalItems + ' items, '
    + md.problemAnalysis.length + ' problems, ' + (md.medicationRationale || []).length + ' medicines, generated ' + seed.generated);
if (checkOnly) process.exit(0);
fs.writeFileSync(dest, JSON.stringify(seed));
console.log('Copied to ' + path.relative(ROOT, dest) + '. Commit it; fresh browsers will load the full memory in the classic coworker.');
