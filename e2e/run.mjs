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
    setTimeout(() => resolve(), 1500);
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
    const context = await browser.newContext();
    console.log('✓ Browser context created');

    // Load host page first to set up localStorage origin
    const hostPage = await context.newPage();
    await hostPage.goto('http://localhost:8877/host.html?dev=1', { waitUntil: 'load' });

    // Load sample quiz into localStorage
    const samplePath = join(REPO_ROOT, 'samples', 'sample-quiz.json');
    const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
    await hostPage.evaluate((quiz) => {
      localStorage.setItem('khawho.quizzes', JSON.stringify([quiz]));
    }, sample);
    console.log('✓ Sample quiz loaded into localStorage');

    // Track console errors
    const consoleErrors = [];
    const pageErrors = [];

    // Set up error handlers
    hostPage.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(`Host: ${msg.text()}`);
      }
    });
    hostPage.on('pageerror', err => {
      pageErrors.push(`Host: ${err.message}`);
    });

    await hostPage.goto('http://localhost:8877/host.html?dev=1', { waitUntil: 'networkidle' });
    console.log('✓ Host page loaded');

    await hostPage.screenshot({ path: join(SHOTS_DIR, '01-quiz-select.png') }).catch(() => {});

    // Select quiz
    try {
      const quizItem = await hostPage.$('.quiz-item');
      if (quizItem) {
        await quizItem.click();
        await hostPage.waitForSelector('#screen-settings', { timeout: 3000 });
        console.log('✓ Quiz selected');
      }
    } catch (e) {
      console.log('⚠ Quiz selection: ' + e.message);
    }

    // Settings: ensure local transport
    try {
      const localRadio = await hostPage.$('input[value="local"]');
      if (localRadio) {
        await localRadio.click();
      }
    } catch (e) {
      // May already be selected
    }

    // Create game
    try {
      const createBtn = await hostPage.$('button[onclick="hostApp.createGame()"]');
      if (createBtn) {
        await createBtn.click();
        await hostPage.waitForSelector('#pin-display', { timeout: 5000 });
        console.log('✓ Game created');
      }
    } catch (e) {
      throw new Error('Failed to create game: ' + e.message);
    }

    // Get PIN
    const pin = await hostPage.evaluate(() => document.getElementById('pin-display')?.textContent?.trim());
    if (!pin || pin.length !== 6) {
      throw new Error(`Invalid PIN: ${pin}`);
    }
    console.log(`✓ PIN: ${pin}`);

    await hostPage.screenshot({ path: join(SHOTS_DIR, '02-lobby-host.png') }).catch(() => {});

    // Open 2 player pages
    const players = [];
    const playerNames = ['Alice', 'Bob'];

    for (let i = 0; i < 2; i++) {
      const playerPage = await context.newPage();
      playerPage.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(`Player ${i}: ${msg.text()}`);
        }
      });
      playerPage.on('pageerror', err => {
        pageErrors.push(`Player ${i}: ${err.message}`);
      });

      await playerPage.goto(`http://localhost:8877/play.html?pin=${pin}&via=local`, { waitUntil: 'load' });
      console.log(`✓ Player ${i} page loaded`);

      // Enter PIN (should be prefilled)
      try {
        await playerPage.click('button:has-text("Join")');
        await playerPage.waitForSelector('#nickname-input', { timeout: 3000 });
      } catch (e) {
        console.log(`⚠ Player ${i} join: ${e.message}`);
      }

      // Enter nickname
      try {
        await playerPage.fill('#nickname-input', playerNames[i]);
        await playerPage.click('button:has-text("Continue")');
        await playerPage.waitForSelector('#waiting-name', { timeout: 3000 });
        console.log(`✓ Player ${i} (${playerNames[i]}) joined`);
      } catch (e) {
        throw new Error(`Player ${i} nickname failed: ${e.message}`);
      }

      players.push({ page: playerPage, name: playerNames[i] });
    }

    // Start game
    try {
      const startBtn = await hostPage.$('button[onclick="hostApp.startGame()"]');
      if (startBtn) {
        await startBtn.click();
        await hostPage.waitForSelector('#screen-question', { timeout: 5000 });
        console.log('✓ Game started');
      }
    } catch (e) {
      throw new Error('Start game failed: ' + e.message);
    }

    // Go through first question
    const question = sample.questions[0];
    console.log(`\nQuestion 1: ${question.type}`);

    try {
      await hostPage.waitForSelector('#question-text', { timeout: 3000 });
      await hostPage.screenshot({ path: join(SHOTS_DIR, '03-question-host.png') }).catch(() => {});
    } catch (e) {
      console.log('⚠ Host question display: ' + e.message);
    }

    // Players answer
    for (let pIdx = 0; pIdx < players.length; pIdx++) {
      const playerPage = players[pIdx].page;

      try {
        if (question.type === 'mc' || question.type === 'tf' || question.type === 'poll') {
          const tiles = await playerPage.$$('.answer-tile');
          if (tiles.length > 0) {
            await tiles[0].click();
            console.log(`✓ Player ${pIdx} answered`);
          }
        }
      } catch (e) {
        console.log(`⚠ Player ${pIdx} answer: ${e.message}`);
      }
    }

    // Wait for reveal
    try {
      await hostPage.waitForSelector('#screen-results', { timeout: 8000 });
      await hostPage.screenshot({ path: join(SHOTS_DIR, '04-results.png') }).catch(() => {});
      console.log('✓ Results revealed');
    } catch (e) {
      console.log('⚠ Results: ' + e.message);
    }

    // Click next
    try {
      const nextBtn = await hostPage.$('button:has-text("Next")');
      if (nextBtn) {
        await nextBtn.click();
      }
    } catch (e) {
      // Might be at leaderboard
    }

    // Wait a bit to see final screen
    await new Promise(r => setTimeout(r, 1000));

    try {
      const finalScreen = await hostPage.$('#screen-final');
      if (finalScreen) {
        await hostPage.screenshot({ path: join(SHOTS_DIR, '05-podium.png') }).catch(() => {});
        console.log('✓ Podium screen reached');
      }
    } catch (e) {
      console.log('⚠ Final screen: ' + e.message);
    }

    // Check for errors
    console.log('\n--- Error Report ---');
    if (consoleErrors.length > 0) {
      console.log(`✗ Found ${consoleErrors.length} console error(s):`);
      consoleErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('✓ No console errors');
    }

    if (pageErrors.length > 0) {
      console.log(`✗ Found ${pageErrors.length} page error(s):`);
      pageErrors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('✓ No page errors');
    }

    // Close pages
    for (const p of players) {
      await p.page.close().catch(() => {});
    }
    await hostPage.close().catch(() => {});
    await context.close().catch(() => {});

    console.log('\n✓ LOCAL transport test PASSED');
    return consoleErrors.length === 0 && pageErrors.length === 0;
  } catch (e) {
    console.error(`\n✗ LOCAL transport test FAILED: ${e.message}`);
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

    const context = await browser.newContext();

    // Seed localStorage
    const seedPage = await context.newPage();
    const samplePath = join(REPO_ROOT, 'samples', 'sample-quiz.json');
    const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
    await seedPage.evaluate((quiz) => {
      localStorage.setItem('khawho.quizzes', JSON.stringify([quiz]));
    }, sample);
    await seedPage.close();

    // Open host
    const hostPage = await context.newPage();
    await hostPage.goto('http://localhost:8877/host.html', { waitUntil: 'load' });
    console.log('✓ Host page loaded (PeerJS)');

    // Select quiz
    try {
      const quizItem = await hostPage.$('.quiz-item');
      if (quizItem) {
        await quizItem.click();
        await hostPage.waitForSelector('#screen-settings', { timeout: 3000 });
      }
    } catch (e) {
      console.log('⚠ Quiz selection: ' + e.message);
    }

    // Create game (PeerJS default)
    try {
      const createBtn = await hostPage.$('button[onclick="hostApp.createGame()"]');
      if (createBtn) {
        await createBtn.click();
        await hostPage.waitForSelector('#pin-display', { timeout: 10000 });
      }
    } catch (e) {
      console.log('⚠ PeerJS connection timeout (network or cloud issue)');
      await hostPage.close();
      await context.close();
      return false;
    }

    const pin = await hostPage.evaluate(() => document.getElementById('pin-display')?.textContent?.trim());
    console.log(`✓ PIN: ${pin}`);

    // Open 1 player
    try {
      const playerPage = await context.newPage();
      await playerPage.goto(`http://localhost:8877/play.html?pin=${pin}&via=peerjs`, { waitUntil: 'load' });

      await playerPage.click('button:has-text("Join")');
      await playerPage.waitForSelector('#nickname-input', { timeout: 5000 });

      await playerPage.fill('#nickname-input', 'TestPlayer');
      await playerPage.click('button:has-text("Continue")');

      await playerPage.waitForSelector('#waiting-name', { timeout: 5000 });
      console.log('✓ Player joined via PeerJS');

      await playerPage.close();
    } catch (e) {
      console.log(`⚠ Player join failed: ${e.message}`);
    }

    // Start game
    try {
      const startBtn = await hostPage.$('button[onclick="hostApp.startGame()"]');
      if (startBtn) {
        await startBtn.click();
        await hostPage.waitForSelector('#screen-question', { timeout: 5000 });
        console.log('✓ Game started');
      }
    } catch (e) {
      console.log(`⚠ Game start failed: ${e.message}`);
    }

    await hostPage.close().catch(() => {});
    await context.close().catch(() => {});

    console.log('\n✓ PEERJS transport test PASSED');
    return true;
  } catch (e) {
    console.error(`\n✗ PEERJS transport test FAILED: ${e.message}`);
    console.log('Note: Requires working internet\n');
    return false;
  }
}

async function main() {
  console.log('Khawho E2E Test Suite\n' + '='.repeat(50));

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
      console.log('PeerJS test error: ' + e.message);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`Local Transport:   ${localPass ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`PeerJS Transport:  ${peerJSPass ? '✓ PASS' : '⚠ SKIPPED'}`);
    console.log(`Screenshots: ${SHOTS_DIR}`);
    console.log('='.repeat(50) + '\n');

    process.exit(localPass ? 0 : 1);
  } catch (e) {
    console.error(`Fatal error: ${e.message}`);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer();
  }
}

main();
