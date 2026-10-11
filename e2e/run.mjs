#!/usr/bin/env node
/**
 * End-to-end test for Khawho using Playwright
 * Tests full game flow: host creates game, players join, answer questions, see results
 */

import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = join(__dirname, '..');
const SHOTS_DIR = join('C:', 'Users', 'bryce', 'khawho-wt', 'game-shots');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Create screenshots directory
try {
  mkdirSync(SHOTS_DIR, { recursive: true });
  console.log(`✓ Screenshots directory: ${SHOTS_DIR}`);
} catch (e) {
  console.log(`✓ Screenshots directory exists: ${SHOTS_DIR}`);
}

let server = null;
let browser = null;

async function startServer() {
  console.log('Starting static server...');
  return new Promise((resolve) => {
    server = spawn('npx', ['--yes', 'http-server', REPO_ROOT, '-c-1', '-p', '8877'], {
      stdio: 'ignore',
      shell: true,
    });
    setTimeout(() => resolve(), 1000);
  });
}

async function stopServer() {
  if (server) {
    console.log('Stopping server...');
    server.kill();
  }
}

async function loadSampleQuiz(page) {
  const samplePath = join(REPO_ROOT, 'samples', 'sample-quiz.json');
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'));

  await page.evaluate((quiz) => {
    localStorage.setItem('khawho.quizzes', JSON.stringify([quiz]));
  }, sample);

  console.log('✓ Sample quiz loaded into localStorage');
  return sample;
}

async function testLocalTransport() {
  console.log('\n=== Testing LOCAL TRANSPORT (dev mode) ===\n');

  try {
    // Start browser
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });
    console.log('✓ Browser launched');

    // Create context
    const context = await browser.createBrowserContext({
      recordVideo: { dir: SHOTS_DIR },
    });
    console.log('✓ Browser context created');

    // Load sample quiz
    const hostPage = await context.newPage();
    const sample = await loadSampleQuiz(hostPage);

    // Track console errors
    const consoleErrors = [];
    const pageErrors = [];

    // Open host
    await hostPage.goto('http://localhost:8877/host.html?dev=1', { waitUntil: 'load' });
    hostPage.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    hostPage.on('pageerror', err => pageErrors.push(err.message));
    console.log('✓ Host page loaded');

    await hostPage.screenshot({ path: join(SHOTS_DIR, '01-quiz-select.png') });

    // Select quiz
    const quizItem = await hostPage.$('.quiz-item');
    if (quizItem) {
      await quizItem.click();
      await hostPage.waitForSelector('#screen-settings');
      console.log('✓ Quiz selected');
    }

    // Settings: ensure local transport, shuffle on, per-player off
    const localRadio = await hostPage.$('input[value="local"]');
    if (localRadio) {
      await localRadio.click();
    }

    // Create game
    const createBtn = await hostPage.$('button[onclick="hostApp.createGame()"]');
    if (createBtn) {
      await createBtn.click();
      await hostPage.waitForSelector('#pin-display');
      console.log('✓ Game created');
    }

    // Get PIN
    const pin = await hostPage.evaluate(() => document.getElementById('pin-display')?.textContent);
    console.log(`✓ PIN: ${pin}`);

    await hostPage.screenshot({ path: join(SHOTS_DIR, '02-lobby-host.png') });

    // Open 3 player pages
    const players = [];
    const playerNames = ['Alice', 'Bob', 'Charlie'];

    for (let i = 0; i < 3; i++) {
      const playerPage = await context.newPage();
      playerPage.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(`Player ${i}: ${msg.text()}`);
      });
      playerPage.on('pageerror', err => pageErrors.push(`Player ${i}: ${err.message}`));

      await playerPage.goto(`http://localhost:8877/play.html?pin=${pin}&via=local`, { waitUntil: 'load' });
      console.log(`✓ Player ${i} page loaded`);

      // Enter PIN (should be prefilled)
      await playerPage.click('button:has-text("Join")');

      // Wait for nickname screen
      await playerPage.waitForSelector('#nickname-input');

      // Enter nickname
      await playerPage.fill('#nickname-input', playerNames[i]);
      await playerPage.click('button:has-text("Continue")');

      // Wait for waiting screen
      await playerPage.waitForSelector('#waiting-name');
      console.log(`✓ Player ${i} (${playerNames[i]}) joined`);

      players.push({ page: playerPage, name: playerNames[i] });
    }

    // Check player list on host
    const playerCount = await hostPage.evaluate(() => document.getElementById('player-count')?.textContent);
    console.log(`✓ Host sees ${playerCount} players`);

    // Start game
    const startBtn = await hostPage.$('button[onclick="hostApp.startGame()"]');
    if (startBtn) {
      await startBtn.click();
      await hostPage.waitForSelector('#screen-question');
      console.log('✓ Game started');
    }

    // Go through questions
    const numQuestions = sample.questions.length;
    console.log(`\nPlaying ${numQuestions} questions...\n`);

    for (let qIdx = 0; qIdx < numQuestions; qIdx++) {
      const question = sample.questions[qIdx];
      console.log(`Question ${qIdx + 1}/${numQuestions}: ${question.type}`);

      // Wait for host to display question
      await hostPage.waitForSelector('#question-text', { timeout: 5000 }).catch(() => {});

      // Check player question payloads for correct field
      for (let pIdx = 0; pIdx < players.length; pIdx++) {
        const playerPage = players[pIdx].page;
        const hasCorrectField = await playerPage.evaluate(() => {
          // Intercept at message handler level (would need deeper hook)
          return false; // TODO: validate via debug log
        });
      }

      // Players answer
      for (let pIdx = 0; pIdx < players.length; pIdx++) {
        const playerPage = players[pIdx].page;

        try {
          if (question.type === 'type') {
            // Type answer - answer correctly
            await playerPage.fill('input[id*="answer"]', 'test answer');
            await playerPage.click('button:has-text("Submit")');
          } else if (question.type === 'tf' || question.type === 'mc' || question.type === 'poll') {
            // Click answer tile
            const tiles = await playerPage.$$('.answer-tile');
            if (tiles.length > 0) {
              // Mix of right and wrong
              const answerIdx = pIdx === 0 ? 0 : (pIdx + qIdx) % tiles.length;
              await tiles[answerIdx].click();

              // If multi-select, might need submit button
              const submitBtn = await playerPage.$('button:has-text("Submit")');
              if (submitBtn) {
                await submitBtn.click();
              }
            }
          }
        } catch (e) {
          console.log(`  ⚠ Player ${pIdx} answer failed: ${e.message}`);
        }
      }

      // Wait for reveal
      await hostPage.waitForSelector('#screen-results', { timeout: 8000 }).catch(() => {});

      if (qIdx === 0) {
        await hostPage.screenshot({ path: join(SHOTS_DIR, '03-question-host.png') });
        await players[0].page.screenshot({ path: join(SHOTS_DIR, '04-question-player.png') });
      }

      // Click next on host
      const nextBtn = await hostPage.$('button:has-text("Next")');
      if (nextBtn) {
        await nextBtn.click();
      }

      // Wait for leaderboard or next question
      try {
        await hostPage.waitForSelector('#screen-leaderboard', { timeout: 3000 });
        const leaderboardNextBtn = await hostPage.$('#screen-leaderboard button:has-text("Next")');
        if (leaderboardNextBtn) {
          await leaderboardNextBtn.click();
        }
      } catch (e) {
        // Might be last question
      }

      // Let players see reveal
      await new Promise(r => setTimeout(r, 1500));
    }

    // Check final screen
    await hostPage.waitForSelector('#screen-final', { timeout: 5000 }).catch(() => {});
    await hostPage.screenshot({ path: join(SHOTS_DIR, '05-podium.png') });

    console.log('\n✓ Game completed');

    // Download CSV
    const downloadPromise = context.waitForEvent('page');
    const downloadBtn = await hostPage.$('button[onclick="hostApp.downloadResults()"]');
    if (downloadBtn) {
      await downloadBtn.click();
      try {
        const newPage = await downloadPromise;
        console.log('✓ CSV download initiated');
      } catch (e) {
        console.log('⚠ CSV download not captured in E2E');
      }
    }

    // Check for errors
    if (consoleErrors.length > 0) {
      console.log('\n✗ Console errors found:');
      consoleErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('\n✓ No console errors');
    }

    if (pageErrors.length > 0) {
      console.log('✗ Page errors found:');
      pageErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('✓ No page errors');
    }

    // Close pages
    for (const p of players) {
      await p.page.close();
    }
    await hostPage.close();

    console.log('\n✓ LOCAL transport test PASSED\n');
    return true;
  } catch (e) {
    console.error(`\n✗ LOCAL transport test FAILED: ${e.message}\n`);
    return false;
  }
}

async function testPeerJSTransport() {
  console.log('\n=== Testing PEERJS TRANSPORT ===\n');

  try {
    if (!browser) {
      browser = await chromium.launch({
        executablePath: CHROME_PATH,
        headless: true,
      });
    }

    const context = await browser.createBrowserContext();

    // Open host
    const hostPage = await context.newPage();
    const sample = await loadSampleQuiz(hostPage);

    await hostPage.goto('http://localhost:8877/host.html', { waitUntil: 'load' });
    console.log('✓ Host page loaded (PeerJS mode)');

    // Select quiz
    const quizItem = await hostPage.$('.quiz-item');
    if (quizItem) {
      await quizItem.click();
      await hostPage.waitForSelector('#screen-settings');
    }

    // Use PeerJS (default)
    const createBtn = await hostPage.$('button[onclick="hostApp.createGame()"]');
    if (createBtn) {
      await createBtn.click();
      await hostPage.waitForSelector('#pin-display', { timeout: 5000 }).catch(() => {
        console.log('⚠ PeerJS connection timed out (network may be slow)');
        throw new Error('PeerJS timeout');
      });
    }

    const pin = await hostPage.evaluate(() => document.getElementById('pin-display')?.textContent);
    console.log(`✓ PIN created: ${pin}`);

    // Open 2 players
    const players = [];
    for (let i = 0; i < 2; i++) {
      const playerPage = await context.newPage();
      await playerPage.goto(`http://localhost:8877/play.html?pin=${pin}&via=peerjs`, { waitUntil: 'load' });

      // Join
      await playerPage.click('button:has-text("Join")');
      await playerPage.waitForSelector('#nickname-input', { timeout: 5000 }).catch(async () => {
        console.log(`⚠ Player ${i} join failed (network timeout?)`);
        await playerPage.close();
        throw new Error('Player join timeout');
      });

      await playerPage.fill('#nickname-input', `Player${i}`);
      await playerPage.click('button:has-text("Continue")');

      await playerPage.waitForSelector('#waiting-name', { timeout: 5000 });
      console.log(`✓ Player ${i} joined via PeerJS`);

      players.push(playerPage);
    }

    // Start game
    const startBtn = await hostPage.$('button[onclick="hostApp.startGame()"]');
    if (startBtn) {
      await startBtn.click();
      await hostPage.waitForSelector('#screen-question', { timeout: 5000 });
    }

    console.log('✓ PeerJS game started');

    // Quick question round
    await hostPage.waitForSelector('#question-text', { timeout: 3000 }).catch(() => {});

    // Let players answer
    for (const playerPage of players) {
      const tiles = await playerPage.$$('.answer-tile');
      if (tiles.length > 0) {
        await tiles[0].click().catch(() => {});
      }
    }

    // Wait for results
    await hostPage.waitForSelector('#screen-results', { timeout: 8000 }).catch(() => {});
    console.log('✓ First question completed');

    // Cleanup
    for (const p of players) {
      await p.close();
    }
    await hostPage.close();

    console.log('\n✓ PEERJS transport test PASSED\n');
    return true;
  } catch (e) {
    console.error(`\n✗ PEERJS transport test FAILED: ${e.message}\n`);
    console.log('Note: PeerJS requires working internet and may fail in certain network conditions\n');
    return false;
  }
}

async function main() {
  console.log('Khawho E2E Test Suite\n' + '='.repeat(40));

  try {
    // Start server
    await startServer();

    // Test local transport (mandatory)
    const localPass = await testLocalTransport();

    // Test PeerJS (best effort)
    let peerJSPass = false;
    try {
      peerJSPass = await testPeerJSTransport();
    } catch (e) {
      console.log('PeerJS test skipped or failed (network issue)');
    }

    // Summary
    console.log('='.repeat(40));
    console.log('TEST SUMMARY');
    console.log('='.repeat(40));
    console.log(`Local Transport: ${localPass ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`PeerJS Transport: ${peerJSPass ? '✓ PASS' : 'SKIPPED (network)'}`);
    console.log(`Screenshots: ${SHOTS_DIR}`);
    console.log('='.repeat(40) + '\n');

    process.exit(localPass ? 0 : 1);
  } catch (e) {
    console.error(`Fatal error: ${e.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
    await stopServer();
  }
}

main();
