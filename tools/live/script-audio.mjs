#!/usr/bin/env node
// Turns a scripted encounter into one mono 16 kHz WAV with a different
// macOS system voice per speaker, so the live-audio path (mic -> Deepgram
// speaker separation -> ear -> brain) can be tested with no one speaking.
// Simulated patient only. Writes <out>.wav and <out>.timing.json (when each
// line actually starts and ends in the audio).
//
//   node tools/live/script-audio.mjs [data/live/morrison-admission-01.json] [--out=tools/live/runs/audio/morrison]
//   node tools/live/script-audio.mjs --until=U12      (a short clip for a quick check)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
const scriptFile = path.resolve(ROOT, argv.find((a) => !a.startsWith('--')) || 'data/live/morrison-admission-01.json');
const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const out = path.resolve(ROOT, opt.out || ('tools/live/runs/audio/' + script.id + (opt.until ? '-' + opt.until : '')));
const VOICES = { doctor: ['Reed (English (US))', 185], patient: ['Grandpa (English (US))', 165], wife: ['Grandma (English (US))', 175], nurse: ['Moira', 185], other: ['Samantha', 180] };
const RATE = 16000;

function readWavPcm(file) {
    const b = fs.readFileSync(file);
    let off = 12;
    while (off < b.length) {
        const id = b.toString('ascii', off, off + 4);
        const size = b.readUInt32LE(off + 4);
        if (id === 'data') return b.subarray(off + 8, off + 8 + size);
        off += 8 + size + (size % 2);
    }
    throw new Error('no data chunk in ' + file);
}

function wavHeader(dataBytes) {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
    h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
    return h;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-audio-'));
const lines = opt.until ? script.lines.slice(0, script.lines.findIndex((l) => l.id === opt.until) + 1) : script.lines;
const clips = [];
for (const l of lines) {
    const [voice, rate] = VOICES[l.speaker] || VOICES.other;
    const f = path.join(tmp, l.id + '.wav');
    execFileSync('say', ['-v', voice, '-r', String(rate), '--file-format=WAVE', '--data-format=LEI16@' + RATE, '-o', f, l.text]);
    clips.push({ line: l, pcm: readWavPcm(f) });
}
// Place each line at its scripted time, but never over the previous line.
const timing = [];
let cursor = 0.8;
const chunks = [];
let written = 0;
const pad = (sec) => { const n = Math.max(0, Math.round(sec * RATE)) * 2; chunks.push(Buffer.alloc(n)); written += n; };
for (const c of clips) {
    const start = Math.max(c.line.t, cursor);
    pad(start - written / 2 / RATE);
    chunks.push(c.pcm);
    written += c.pcm.length;
    const end = written / 2 / RATE;
    timing.push({ id: c.line.id, speaker: c.line.speaker, start: +start.toFixed(2), end: +end.toFixed(2), text: c.line.text });
    // Keep the scripted pause after this line (including the pauses left for answers).
    const next = lines[lines.indexOf(c.line) + 1];
    const scriptedGap = next ? Math.max(0.5, next.t - (c.line.t + c.line.dur)) : 1;
    cursor = end + scriptedGap;
}
pad(3);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out + '.wav', Buffer.concat([wavHeader(written), ...chunks]));
fs.writeFileSync(out + '.timing.json', JSON.stringify({ script: script.id, voices: VOICES, duration_s: +(written / 2 / RATE).toFixed(1), lines: timing }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Wrote ' + path.relative(ROOT, out) + '.wav (' + (written / 2 / RATE / 60).toFixed(1) + ' min, ' + Math.round(written / 1024 / 1024) + ' MB) and .timing.json');
