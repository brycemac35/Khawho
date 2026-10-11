# Khawho End-to-End Tests

Automated E2E tests using Playwright and Chrome to verify the full game flow.

## Setup

```bash
npm install -D playwright-core
```

Alternatively, install manually:
```bash
npm install --save-dev playwright-core
```

## Running Tests

```bash
node e2e/run.mjs
```

This will:
1. Start a local static server on port 8877
2. Open Chrome (headless mode)
3. Test **local transport** (BroadcastChannel, same browser): mandatory pass
4. Test **PeerJS transport** (real WebRTC cloud): best effort (requires internet)
5. Play through a sample quiz with 1 host + 3 players
6. Verify no console/page errors
7. Capture screenshots to `C:\Users\bryce\khawho-wt\game-shots\`

## Test Flow

- **Quiz Selection**: Host picks "World Capitals" sample quiz
- **Settings**: Selects connection type (local or PeerJS)
- **Lobby**: 3 players join with names
- **Questions**: Players answer all questions (mix of MC, TF, type-answer)
- **Results**: Host views distribution, leaderboard, podium
- **Final**: CSV download

## Screenshots

Tests capture:
- `01-quiz-select.png` - Quiz selection screen
- `02-lobby-host.png` - Lobby with PIN and players
- `03-question-host.png` - Question on host screen
- `04-question-player.png` - Question on player screen
- `05-podium.png` - Final podium screen

## Known Limitations

- CSV download not fully captured (browser download dialog)
- Per-question payload `correct` field validation requires deeper instrumentation
- PeerJS tests may fail if internet is unavailable or PeerJS cloud is down
