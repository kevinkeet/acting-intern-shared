#!/usr/bin/env node
// Local preview of this checkout with the LAB server's AI routes.
//
// Serves the files in this folder on http://127.0.0.1:8787 and forwards
// /api/* (including streamed /api/claude-full replies) and the /ws/transcribe
// audio WebSocket to the lab (https://acting-intern-lab.onrender.com), so the
// page uses the lab's keys and nothing here needs one. Local only (binds to
// 127.0.0.1). For UI work on the Live Coworker:
//   node tools/live/dev-proxy.mjs            then open http://127.0.0.1:8787/?allmodes
//   PORT=8788 LAB=https://other.example node tools/live/dev-proxy.mjs
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = parseInt(process.env.PORT || '8787', 10);
const LAB = new URL(process.env.LAB || 'https://acting-intern-lab.onrender.com');
const WebSocket = require('ws');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

function serveStatic(req, res) {
    const u = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep) || /[\\/]\.(env|git)/.test(file)) { res.writeHead(403).end('forbidden'); return; }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
}

function proxyApi(req, res) {
    const headers = Object.assign({}, req.headers, { host: LAB.host });
    delete headers.origin;
    delete headers.referer;
    const up = https.request({ hostname: LAB.hostname, port: LAB.port || 443, path: req.url, method: req.method, headers }, (ur) => {
        res.writeHead(ur.statusCode || 502, ur.headers);
        ur.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'lab proxy: ' + e.message } })); });
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
}

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return proxyApi(req, res);
    return serveStatic(req, res);
});

// Audio relay: browser <-> lab /ws/transcribe
const wss = new WebSocket.Server({ server, path: '/ws/transcribe' });
wss.on('connection', (browser) => {
    const upstream = new WebSocket('wss://' + LAB.host + '/ws/transcribe');
    const queue = [];
    upstream.on('open', () => { while (queue.length) upstream.send(queue.shift()); });
    browser.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        else queue.push(data);
    });
    upstream.on('message', (data) => { if (browser.readyState === WebSocket.OPEN) browser.send(data.toString()); });
    upstream.on('close', (code, reason) => { if (browser.readyState === WebSocket.OPEN) browser.close(code === 1005 ? 1000 : code, reason); });
    browser.on('close', () => { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(); });
    upstream.on('error', () => { if (browser.readyState === WebSocket.OPEN) browser.close(4002, 'lab relay error'); });
    browser.on('error', () => upstream.terminate());
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('Live preview on http://127.0.0.1:' + PORT + '/?allmodes  (API and audio via ' + LAB.origin + ')');
});
