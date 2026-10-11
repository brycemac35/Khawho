#!/usr/bin/env node
/**
 * Khawho end-to-end test (Playwright driving real Chrome).
 *
 *   node e2e/run.mjs            run everything (local transport, then PeerJS)
 *   node e2e/run.mjs local      only the local (BroadcastChannel) transport
 *   node e2e/run.mjs peerjs     only the real PeerJS cloud transport
 *
 * It drives the real pages (host.html / play.html) the way a teacher and students would:
 * quiz picked from the list, game created, players join by PIN, every question answered
 * (multi-select, true/false, type-answer, poll; right and wrong), reveal -> leaderboard -> podium,
 * CSV downloaded and checked, everything players receive inspected for answer leaks.
 */

import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SHOTS_DIR = process.env.KHAWHO_SHOTS || 'C:\\Users\\bryce\\khawho-wt\\game-shots';
const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SAMPLE = JSON.parse(readFileSync(join(REPO_ROOT, 'samples', 'sample-quiz.json'), 'utf8'));

mkdirSync(SHOTS_DIR, { recursive: true });

// ---------------------------------------------------------------- tiny harness

const results = []; // { section, name, pass, detail }
let section = '';
const consoleProblems = [];

function ok(cond, name, detail = '') {
  results.push({ section, name, pass: !!cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`);
  return !!cond;
}

function log(msg) { console.log(`  ..    ${msg}`); }

// ---------------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(REPO_ROOT, path));
    if (!file.startsWith(REPO_ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// ---------------------------------------------------------------- helpers

function watch(page, label) {
  page.on('console', m => {
    if (m.type() === 'error') consoleProblems.push(`[${section}] ${label} console.error: ${m.text()}`);
  });
  page.on('pageerror', e => consoleProblems.push(`[${section}] ${label} pageerror: ${e.message}`));
  return page;
}

const visible = (id) => `#${id}:not(.hidden)`;
const shot = (page, name) => page.screenshot({ path: join(SHOTS_DIR, name) }).catch(e => log(`screenshot ${name} failed: ${e.message}`));

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const questionByText = (text) => SAMPLE.questions.find(q => q.text === text);

/** Walk any value and return every key name (to prove nothing about correctness is sent). */
function allKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => allKeys(v, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { out.add(k); allKeys(v, out); });
  return out;
}

// ---------------------------------------------------------------- one full game

/**
 * Plays one game through the real UI.
 * opts: { label, kind, ctxHost, newPlayerCtx, strategies:[{name, mode}], perPlayer, base, hostUrl, timeout, shots, ipad, rejoin, pause }
 */
async function playGame(opts) {
  const { label, kind, base, strategies, perPlayer = false, timeout = 15000, shots = false } = opts;
  const rec = { label, questionOrder: [], shared: {}, perPlayerOrders: {}, players: [] };

  // ---- host: pick the quiz exactly as a teacher would
  const host = watch(await opts.ctxHost.newPage(), `${label}/host`);
  host.setDefaultTimeout(timeout);
  await host.goto(`${base}/host.html${kind === 'local' ? '?dev=1' : ''}`);
  await host.evaluate(async (quiz) => {
    const storage = await import('./js/storage.js'); // the app's own storage format
    storage.saveLocalQuiz(quiz);
  }, SAMPLE);
  await host.reload();
  await host.waitForSelector('.quiz-item');
  await shot(host, `${label}-00-quiz-select.png`);
  const items = await host.locator('.quiz-item').allTextContents();
  ok(items.some(t => t.includes(SAMPLE.title)), `${label}: seeded quiz is listed on the host page`, items.join(' / '));
  await host.locator('.quiz-item', { hasText: SAMPLE.title }).click();
  await host.waitForSelector(visible('screen-settings'));

  await host.check(`input[name=transport][value=${kind}]`);
  if (perPlayer) await host.check('#per-player-order');
  await host.click('#create-game-button');
  await host.waitForSelector(visible('screen-lobby'), { timeout: kind === 'peerjs' ? 30000 : timeout });
  const pin = (await host.textContent('#pin-display')).trim();
  ok(/^[1-9]\d{5}$/.test(pin), `${label}: lobby shows a 6-digit PIN`, pin);
  rec.pin = pin;

  // ---- players join by PIN through play.html
  const players = [];
  for (const [i, s] of strategies.entries()) {
    const ctx = await opts.newPlayerCtx(i);
    const page = watch(await ctx.newPage(), `${label}/${s.name}`);
    page.setDefaultTimeout(timeout);
    await page.goto(`${base}/play.html?pin=${pin}&via=${kind}&debug=1`);
    await page.click('#pin-submit');
    await page.waitForSelector(visible('screen-nickname'), { timeout: kind === 'peerjs' ? 30000 : timeout });
    await page.fill('#nickname-input', s.name);
    await page.click('#nickname-submit');
    await page.waitForSelector(visible('screen-waiting'));
    ok((await page.textContent('#waiting-name')).trim() === s.name, `${label}: ${s.name} joined and was welcomed`);
    players.push({ ...s, page, archive: [], exp: [], expAns: [], reveals: [] });
  }
  await host.waitForFunction(n => document.getElementById('player-count').textContent === String(n), strategies.length);
  ok(true, `${label}: host lobby counts ${strategies.length} players`);

  if (shots) {
    await host.waitForSelector('#qr-slot img', { timeout: 10000 }).catch(() => {});
    const qr = await host.locator('#qr-slot img').count();
    ok(qr === 1, `${label}: lobby shows a QR code`, qr ? '' : 'QR image missing (CDN unreachable?)');
    await shot(host, `${label}-01-lobby.png`);
    await shot(players[0].page, `${label}-02-player-waiting.png`);
  }

  await host.click('#start-button');
  const total = SAMPLE.questions.length;

  for (let qi = 0; qi < total; qi++) {
    await host.waitForSelector(visible('screen-question'));
    const hostText = (await host.textContent('#question-text')).trim();
    const quizQ = questionByText(hostText);
    if (!quizQ) throw new Error(`host showed unknown question "${hostText}"`);
    rec.questionOrder.push(hostText);

    // players receive the question
    const payloads = [];
    for (const p of players) {
      await p.page.waitForFunction(n => window.__khawhoLog.some(m => m.t === 'question' && m.qIndex === n), qi);
      const msg = await p.page.evaluate(n => window.__khawhoLog.filter(m => m.t === 'question' && m.qIndex === n).pop(), qi);
      payloads.push(msg);
      ok(msg.text === hostText, `${label} Q${qi + 1}: ${p.name} sees the same question as the host`);
    }

    // host tiles vs player tiles
    const hostTiles = await host.locator('#answer-tiles .answer-tile').count();
    const hostShapes = await host.locator('#answer-tiles .shape').count();
    if (quizQ.type === 'type') {
      ok(hostTiles === 0 && payloads.every(m => m.answers.length === 0), `${label} Q${qi + 1}: type-answer has no tiles`);
    } else if (perPlayer) {
      const hostOrder = await host.locator('#answer-tiles .answer-tile').allTextContents();
      ok(hostShapes === 0 && hostTiles === quizQ.answers.length, `${label} Q${qi + 1}: per-player mode host shows a plain text list (no colors/shapes)`, `${hostShapes} shapes`);
      ok(hostOrder.join('|') === quizQ.answers.map(a => a.text).join('|'), `${label} Q${qi + 1}: host list is in quiz order`);
      rec.perPlayerOrders[hostText] = payloads.map(m => m.answers.map(a => a.text).join('|'));
    } else {
      const hostOrder = await host.locator('#answer-tiles .tile-text').allTextContents();
      const hostShapeList = await host.locator('#answer-tiles .answer-tile').evaluateAll(n => n.map(x => x.dataset.shape));
      ok(hostShapes === quizQ.answers.length, `${label} Q${qi + 1}: host tiles have shapes`);
      for (const [pi, m] of payloads.entries()) {
        const same = m.answers.map(a => a.text).join('|') === hostOrder.join('|')
          && m.answers.map(a => a.shape).join('|') === hostShapeList.join('|');
        if (!same) ok(false, `${label} Q${qi + 1}: ${players[pi].name}'s tile order/shapes match the host screen`);
      }
      rec.shared[hostText] = {
        order: payloads[0].answers.map(a => a.text),
        shapes: Object.fromEntries(payloads[0].answers.map(a => [a.text, a.shape])),
      };
    }

    if (shots && qi === 0) {
      await shot(host, `${label}-03-host-question.png`);
      await shot(players[0].page, `${label}-04-player-question.png`);
    }

    // iPad checks on the player question screen
    if (opts.ipad && qi === 0) {
      const page = players[0].page;
      await shot(page, 'ipad-04-player-question.png');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(overflow <= 0, `${label}: no horizontal scroll at 768x1024`, `overflow ${overflow}px`);
      const boxes = await page.locator('button.answer-tile').evaluateAll(n => n.map(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom }; }));
      ok(boxes.length === 4 && boxes.every(b => b.w >= 100 && b.h >= 80), `${label}: answer tiles are large touch targets`, JSON.stringify(boxes));
      const vh = await page.evaluate(() => window.innerHeight);
      ok(boxes.every(b => b.bottom <= vh), `${label}: all four tiles fit on screen without scrolling`, `viewport ${vh}, bottoms ${boxes.map(b => Math.round(b.bottom))}`);
    }

    // optional pause check on the true/false question
    if (opts.pause && hostText.startsWith('Tokyo')) {
      await host.click('#pause-button');
      for (const p of players) await p.page.waitForSelector(visible('pause-overlay'));
      ok((await host.textContent('#pause-button')).trim() === 'Resume', `${label}: players see "Paused" and host button reads Resume`);
      await host.waitForTimeout(4000);
      await host.click('#pause-button');
      for (const p of players) await p.page.waitForSelector('#pause-overlay.hidden', { state: 'attached' });
      rec.pausedQuestion = qi;
    }

    // answer
    for (const [pi, p] of players.entries()) {
      const wantRight = p.mode === 'right' || (p.mode === 'mixed' && qi % 2 === 0);
      const msg = payloads[pi];
      let exp = null;
      let expAns = '';
      if (quizQ.type === 'type') {
        const text = wantRight ? `  ${quizQ.accepted[0].toUpperCase()}  ` : 'definitely wrong';
        await p.page.fill('#type-answer-input', text);
        await p.page.click('#submit-button');
        exp = wantRight; expAns = text.trim();
      } else if (quizQ.type === 'poll') {
        await p.page.click(`button.answer-tile[data-id="${msg.answers[0].id}"]`);
        expAns = msg.answers[0].text;
      } else {
        const idOf = (t) => msg.answers.find(a => a.text === t).id;
        const good = quizQ.answers.filter(a => a.correct).map(a => a.text);
        const bad = quizQ.answers.filter(a => !a.correct).map(a => a.text);
        let picks;
        if (wantRight) picks = good;
        else picks = msg.multi ? [good[0]] /* partial selection must not count */ : [bad[0]];
        for (const t of picks) await p.page.click(`button.answer-tile[data-id="${idOf(t)}"]`);
        if (msg.multi) await p.page.click('#submit-button');
        exp = wantRight;
        expAns = quizQ.answers.filter(a => picks.includes(a.text)).map(a => a.text).join(' | ');
      }
      p.exp[qi] = exp;
      p.expAns[qi] = expAns;
    }

    await host.waitForSelector(visible('screen-results'));
    for (const p of players) {
      await p.page.waitForFunction(n => window.__khawhoLog.filter(m => m.t === 'reveal').length >= n, (qi + 1) - (p.archivedReveals || 0));
      const reveal = await p.page.evaluate(() => window.__khawhoLog.filter(m => m.t === 'reveal').pop());
      p.reveals[qi] = reveal;
      ok(reveal.correct === p.exp[qi], `${label} Q${qi + 1} (${quizQ.type}): ${p.name} reveal says ${p.exp[qi]}`, `got ${reveal.correct}`);
      if (reveal.correct === true && quizQ.points !== 'none') ok(reveal.points >= 500, `${label} Q${qi + 1}: ${p.name} earned >=500 for a right answer`, String(reveal.points));
      if (reveal.correct !== true) ok(reveal.points === 0, `${label} Q${qi + 1}: ${p.name} earned 0 for no right answer`, String(reveal.points));
    }

    if (shots && qi === 0) {
      await shot(host, `${label}-05-host-results.png`);
      await players[0].page.waitForSelector(visible('screen-reveal'));
      await shot(players[0].page, `${label}-06-player-reveal.png`);
    }

    // rejoin after a refresh (acceptance criterion 8)
    if (opts.rejoin && qi === 2) {
      const p = players[0];
      const before = p.reveals[qi];
      p.archive.push(await p.page.evaluate(() => window.__khawhoLog));
      p.archivedReveals = qi; // the resent reveal for this question counts again in the new page
      await p.page.reload();
      await p.page.waitForFunction(() => window.__khawhoLog.some(m => m.t === 'welcome'));
      const welcome = await p.page.evaluate(() => window.__khawhoLog.find(m => m.t === 'welcome'));
      ok(welcome.name === p.name && welcome.score === before.score, `${label}: ${p.name} refreshed and rejoined with score ${before.score}`, JSON.stringify(welcome));
      await p.page.waitForFunction(() => window.__khawhoLog.some(m => m.t === 'reveal'));
    }

    await host.click('#results-next');
    await host.waitForSelector(visible('screen-leaderboard'));
    if (shots && qi === 1) await shot(host, `${label}-07-host-leaderboard.png`);
    await host.click('#leaderboard-next');
  }

  // ---- final
  await host.waitForSelector(visible('screen-final'));
  if (shots) await shot(host, `${label}-08-podium.png`);
  const podiumNames = await host.locator('.podium-name').allTextContents();
  ok(podiumNames.length === Math.min(3, players.length), `${label}: podium shows ${Math.min(3, players.length)} places`, podiumNames.join(', '));
  const statRows = await host.locator('#stats-table tbody tr').count();
  ok(statRows === total, `${label}: per-question % correct table has ${total} rows`, String(statRows));
  const pcts = await host.locator('#stats-table tbody tr td:last-child').allTextContents();
  ok(pcts.every(t => t === '–' || /^\d+%$/.test(t)), `${label}: % correct cells look right`, pcts.join(','));
  const pollIdx = rec.questionOrder.findIndex(t => questionByText(t).type === 'poll');
  ok(pcts[pollIdx] === '–', `${label}: poll shows no % correct`);

  for (const p of players) {
    await p.page.waitForFunction(() => window.__khawhoLog.some(m => m.t === 'end'));
    p.end = await p.page.evaluate(() => window.__khawhoLog.find(m => m.t === 'end'));
    ok(await p.page.isVisible(visible('screen-final')), `${label}: ${p.name} sees the final screen`);
  }
  if (shots) await shot(players[0].page, `${label}-09-player-final.png`);

  // ---- CSV
  const [download] = await Promise.all([host.waitForEvent('download'), host.click('#download-csv')]);
  const csvPath = join(SHOTS_DIR, `${label}-results.csv`);
  await download.saveAs(csvPath);
  const csv = parseCsv(readFileSync(csvPath, 'utf8'));
  const header = csv[0];
  ok(header.slice(0, 3).join(',') === 'Player,Rank,Score', `${label}: CSV starts with Player,Rank,Score`, header.slice(0, 3).join(','));
  ok(header.length === 3 + 3 * total, `${label}: CSV has ${3 + 3 * total} columns`, String(header.length));
  ok(header.slice(3, 6).join(',') === 'Q1 answer,Q1 correct,Q1 points', `${label}: CSV per-question columns are answer/correct/points`);
  ok(csv.filter(r => r.length > 1).length === players.length + 1, `${label}: CSV has one row per player`, String(csv.length));

  for (const p of players) {
    const row = csv.find(r => r[0] === p.name);
    if (!ok(row, `${label}: CSV has a row for ${p.name}`)) continue;
    let sum = 0;
    let rowOk = true;
    const issues = [];
    for (let qi = 0; qi < total; qi++) {
      const [ans, corr, pts] = [row[3 + 3 * qi], row[4 + 3 * qi], Number(row[5 + 3 * qi])];
      const type = questionByText(rec.questionOrder[qi]).type;
      const wantCorr = type === 'poll' ? '–' : p.exp[qi] ? 'yes' : 'no';
      if (corr !== wantCorr) { rowOk = false; issues.push(`Q${qi + 1} correct ${corr} != ${wantCorr}`); }
      if (ans !== p.expAns[qi]) { rowOk = false; issues.push(`Q${qi + 1} answer "${ans}" != "${p.expAns[qi]}"`); }
      if (pts !== p.reveals[qi].points) { rowOk = false; issues.push(`Q${qi + 1} points ${pts} != ${p.reveals[qi].points}`); }
      sum += pts;
    }
    ok(rowOk, `${label}: CSV answers/correct/points for ${p.name} match what happened`, issues.join('; '));
    ok(Number(row[2]) === sum, `${label}: ${p.name} CSV score equals the sum of per-question points`, `${row[2]} vs ${sum}`);
    ok(Number(row[2]) === p.end.score && Number(row[1]) === p.end.rank, `${label}: ${p.name} final screen (#${p.end.rank}, ${p.end.score}) matches CSV (#${row[1]}, ${row[2]})`);
    p.finalScore = Number(row[2]);
    p.finalRank = Number(row[1]);
  }

  // ---- scoring rules
  for (const p of players) {
    if (p.mode === 'wrong') ok(p.finalScore === 0, `${label}: ${p.name} answered everything wrong -> 0 points`, String(p.finalScore));
    if (p.mode === 'right') ok(p.finalScore > 0, `${label}: ${p.name} answered everything right -> scored`, String(p.finalScore));
  }
  const rightP = players.find(p => p.mode === 'right');
  if (rightP) {
    ok(players.every(p => p.finalScore <= rightP.finalScore), `${label}: all-right player has the top score`);
    ok(rightP.finalRank === 1, `${label}: all-right player is ranked #1`);
    // points sanity: standard 500..1000 (+streak bonus <=500); double 1000..2000 (+bonus); none 0
    let bad = [];
    rightP.reveals.forEach((r, qi) => {
      const q = questionByText(rec.questionOrder[qi]);
      if (q.type === 'poll') return;
      const mult = q.points === 'double' ? 2 : 1;
      const lo = q.points === 'none' ? 0 : 500 * mult;
      const hi = q.points === 'none' ? 0 : 1000 * mult + 500;
      if (r.points < lo || r.points > hi) bad.push(`Q${qi + 1}=${r.points}`);
    });
    ok(bad.length === 0, `${label}: per-question points are within the engine's rules`, bad.join(','));
    ok(rightP.reveals.every(r => r.streak >= 0) && rightP.reveals.filter(r => r.correct === true).at(-1).streak >= 5, `${label}: streak counts up for consecutive right answers`);
  }
  if (opts.pause) {
    const pausedPlayer = rightP;
    const r = pausedPlayer?.reveals[rec.pausedQuestion];
    const base = r ? r.points - Math.min(500, Math.max(0, r.streak - 1) * 100) : 0; // strip streak bonus
    ok(r && base >= 930, `${label}: 4s pause on a 10s question was excluded from scoring (time points ${base}; would be <=800 if counted)`);
  }

  // ---- nothing about correctness may reach a player before the reveal
  for (const p of players) {
    const log = [...p.archive.flat(), ...(await p.page.evaluate(() => window.__khawhoLog))];
    const questions = log.filter(m => m.t === 'question');
    const leakKeys = new Set();
    questions.forEach(m => allKeys(m).forEach(k => { if (/correct|accepted|solution|right/i.test(k)) leakKeys.add(k); }));
    ok(questions.length >= total, `${label}: captured ${questions.length} question messages for ${p.name}`);
    ok(leakKeys.size === 0, `${label}: ${p.name}'s question messages contain no correctness keys`, [...leakKeys].join(','));
    const nonReveal = log.filter(m => m.t !== 'reveal');
    const leaky = nonReveal.filter(m => 'correctIds' in m || 'correctText' in m);
    ok(leaky.length === 0, `${label}: only 'reveal' messages carry correct answers`);
    const idsLookRandom = questions.every(m => m.answers.every(a => /^[0-9a-f]{8}$/.test(a.id)));
    ok(idsLookRandom, `${label}: answer ids are random 8-hex strings, not indices`);
    p.log = log;
  }
  rec.players = players.map(p => ({ name: p.name, log: p.log }));

  await host.context().close().catch(() => {});
  for (const p of players) await p.page.context().close().catch(() => {});
  return rec;
}

// ---------------------------------------------------------------- sections

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function localSection(browser, base) {
  section = 'LOCAL';
  console.log('\n=== LOCAL transport (BroadcastChannel, one browser context) ===');

  const newCtx = () => browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });

  // Game 1: full game, 3 players, with shots, rejoin and pause checks
  let ctx = await newCtx();
  const g1 = await playGame({
    label: 'local-g1', kind: 'local', base, ctxHost: ctx, newPlayerCtx: async () => ctx,
    strategies: [{ name: 'Alice', mode: 'right' }, { name: 'Bob', mode: 'mixed' }, { name: 'Cara', mode: 'wrong' }],
    shots: true, rejoin: true, pause: true, timeout: 20000,
  });
  await ctx.close().catch(() => {});

  // Game 2: same quiz again; the order of everything must differ (this is the whole point of Khawho)
  ctx = await newCtx();
  const g2 = await playGame({
    label: 'local-g2', kind: 'local', base, ctxHost: ctx, newPlayerCtx: async () => ctx,
    strategies: [{ name: 'Dana', mode: 'right' }, { name: 'Eli', mode: 'wrong' }], timeout: 20000,
  });
  await ctx.close().catch(() => {});

  section = 'RANDOMNESS';
  console.log('\n=== Randomness: same quiz, two games ===');
  const texts = Object.keys(g1.shared);
  let orderDiff = 0, shapeDiff = 0;
  for (const t of texts) {
    if (g1.shared[t].order.join('|') !== g2.shared[t].order.join('|')) orderDiff++;
    if (JSON.stringify(g1.shared[t].shapes) !== JSON.stringify(g2.shared[t].shapes)) shapeDiff++;
  }
  log(`${texts.length} tiled questions: answer order differed on ${orderDiff}, shape mapping differed on ${shapeDiff}`);
  ok(orderDiff > 0 && orderDiff >= texts.length - 3, `answer orders are not the same across two games (${orderDiff}/${texts.length} differ)`);
  ok(shapeDiff > 0 && shapeDiff >= texts.length - 3, `shape/color mappings are not the same across two games (${shapeDiff}/${texts.length} differ)`);
  ok(g1.questionOrder.join('|') !== g2.questionOrder.join('|'), 'question order differs between the two games');
  const idsG1 = new Set(g1.players[0].log.filter(m => m.t === 'question').flatMap(m => m.answers.map(a => a.id)));
  const idsG2 = g2.players[0].log.filter(m => m.t === 'question').flatMap(m => m.answers.map(a => a.id));
  ok(!idsG2.some(id => idsG1.has(id)), 'answer ids are not reused between games');
  // Original index must not predict position: collect the position of the first quiz answer across both games
  const posOfFirst = [...Object.entries(g1.shared), ...Object.entries(g2.shared)]
    .filter(([t]) => questionByText(t).answers.length === 4)
    .map(([t, v]) => v.order.indexOf(questionByText(t).answers[0].text));
  ok(new Set(posOfFirst).size > 1, `quiz's first answer lands on varying positions (${posOfFirst.join(',')})`);

  section = 'PER-PLAYER';
  console.log('\n=== Per-player answer order mode ===');
  ctx = await newCtx();
  const g3 = await playGame({
    label: 'local-g3-perplayer', kind: 'local', base, ctxHost: ctx, newPlayerCtx: async () => ctx,
    strategies: [{ name: 'Finn', mode: 'right' }, { name: 'Gus', mode: 'right' }, { name: 'Hana', mode: 'wrong' }],
    perPlayer: true, timeout: 20000,
  });
  await ctx.close().catch(() => {});
  const diffQs = Object.values(g3.perPlayerOrders).filter(o => new Set(o).size > 1).length;
  ok(diffQs >= Object.keys(g3.perPlayerOrders).length - 2, `players see different orders of the same question (${diffQs}/${Object.keys(g3.perPlayerOrders).length} questions)`);

  section = 'IPAD';
  console.log('\n=== iPad-sized touch player (768x1024) ===');
  ctx = await browser.newContext({
    acceptDownloads: true, viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  await playGame({
    label: 'ipad', kind: 'local', base, ctxHost: ctx, newPlayerCtx: async () => ctx,
    strategies: [{ name: 'Tablet', mode: 'right' }], ipad: true, shots: false, timeout: 20000,
  }).catch(e => ok(false, 'iPad run completed', e.message));
}

async function peerSection(browser, base) {
  section = 'PEERJS';
  console.log('\n=== REAL PeerJS transport (separate browser contexts) ===');
  const hostCtx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  try {
    await playGame({
      label: 'peerjs', kind: 'peerjs', base, ctxHost: hostCtx,
      newPlayerCtx: () => browser.newContext({ viewport: { width: 768, height: 1024 } }),
      strategies: [{ name: 'Pia', mode: 'right' }, { name: 'Quin', mode: 'wrong' }],
      shots: true, timeout: 45000, pause: false,
    });
  } catch (e) {
    ok(false, 'PeerJS game completed end to end', e.message.split('\n')[0]);
  }
  await hostCtx.close().catch(() => {});
}

// ---------------------------------------------------------------- main

const which = process.argv[2] || 'all';
const { server, base } = await startServer();
console.log(`Serving ${REPO_ROOT} at ${base}`);
const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });

try {
  if (which === 'all' || which === 'local') {
    try { await localSection(browser, base); } catch (e) { ok(false, 'LOCAL flow completed', e.stack.split('\n').slice(0, 3).join(' | ')); }
  }
  if (which === 'all' || which === 'peerjs') {
    try { await peerSection(browser, base); } catch (e) { ok(false, 'PeerJS flow completed', e.message); }
  }
} finally {
  await browser.close().catch(() => {});
  server.close();
}

section = 'CONSOLE';
console.log('\n=== Console / page errors ===');
const unique = [...new Set(consoleProblems)];
ok(unique.length === 0, 'no console errors or uncaught page errors', unique.slice(0, 8).join('\n        '));

const failed = results.filter(r => !r.pass);
const bySection = {};
results.forEach(r => { (bySection[r.section] ??= { pass: 0, fail: 0 })[r.pass ? 'pass' : 'fail']++; });
console.log('\n=== SUMMARY ===');
Object.entries(bySection).forEach(([s, c]) => console.log(`  ${s.padEnd(12)} pass ${c.pass}  fail ${c.fail}`));
console.log(`  TOTAL        pass ${results.length - failed.length}  fail ${failed.length}`);
if (failed.length) {
  console.log('\nFailures:');
  failed.forEach(f => console.log(`  [${f.section}] ${f.name}${f.detail ? `\n      ${f.detail}` : ''}`));
}
console.log(`Screenshots: ${SHOTS_DIR}`);
process.exit(failed.length ? 1 : 0);
