# Khawho — Classroom Quiz with True Randomness

Khawho is a free, open-source quiz game for live classrooms. It works like Kahoot, but with one key difference: **every answer position and color is randomly shuffled using your browser's cryptographic random number generator every single game.** Students cannot memorize answer patterns because the patterns are never the same twice.

**Play at:** https://brycemac35.github.io/Khawho/

## 1. Why Khawho?

Kahoot, while popular, uses a small fixed set of answer-position patterns — students who've played enough games start to recognize them and answer based on position rather than knowledge. Khawho eliminates this by:

- Shuffling answer order **randomly** for every game with `crypto.getRandomValues` (true cryptographic randomness, not `Math.random`)
- Independently shuffling the shape/color assignment to answer positions
- Optionally shuffling question order so each game feels different
- Always reshuffling for each question, so memorization is impossible

Teachers can host on a projector, students join by PIN from any modern browser on laptops or iPads.

---

## 2. Running a Game

### Host
1. Go to https://brycemac35.github.io/Khawho/
2. Click **Host a Game**
3. Pick a quiz (one you made, one you imported, or one from the shared library)
4. Set game options (question order randomization, connection type, etc.)
5. The host screen shows the PIN and waits for players
6. Share the PIN with your class (project it or write it on the board)

### Players
1. Go to https://brycemac35.github.io/Khawho/
2. Click **Join a Game**
3. Enter the PIN shown by the host
4. Enter a nickname (15 characters max, unique per game, no profanity)
5. Answer questions — tap an answer tile (big tap targets, iPad-friendly)
6. After each question, see a feedback reveal and leaderboard
7. At the end, see your final rank and score, and optionally download results as CSV

---

## 3. Making Quizzes

The **Quiz Editor** is built into the site. Create quizzes three ways:

### Create from Scratch
- Click **Make or Edit Quizzes** → **+ New Quiz**
- Title, author, questions

### Question Types
- **Multiple Choice (MC):** 2–4 answers, one or more correct
- **True/False:** Two answer options, one correct
- **Type-Answer:** Type a short answer; teacher provides accepted variations (case/space-insensitive)
- **Poll:** No correct answer; just collect responses

### Import Existing Quizzes
The editor accepts three formats:

#### JSON (Khawho Format)
Easiest if you've already made a Khawho quiz. Copy the JSON and paste into the import dialog.

#### CSV
Simple spreadsheet format. Columns (in order):
```
type, question, a1, a2, a3, a4, correct, time
```
- `type`: `mc`, `tf`, `type`, or `poll`
- `question`: Question text
- `a1`–`a4`: Answer options (unused columns can be blank)
- `correct`: 
  - For MC/TF: `1`, `2`, `3`, or `4` (answer position); multiple correct answers separated by `;` (e.g., `1;3`)
  - For type-answer: pipe-separated accepted answers (e.g., `paris|paris, france`)
  - For poll: leave blank
- `time`: Time limit in seconds (5, 10, 20, 30, 60, 90, or 120)

See `samples/khawho-template.csv` for an example.

#### Kahoot .xlsx Template
If you've built a Kahoot quiz, export it or use the Kahoot spreadsheet template. Upload the file and Khawho will find the "Question" column and import it.

### Quiz Settings
- **Time Limit:** 5–120 seconds per question (default 20)
- **Points:** Standard, Double (2×), or None
- Quizzes auto-save locally to your browser

---

## 4. The Shared Library (GitHub)

Teachers can upload quizzes to a shared library in the Khawho GitHub repository so other teachers can use them.

### How It Works
- All quizzes in the `quizzes/` folder are encrypted with **AES-GCM** using a **shared teacher password**
- The file stores metadata (title, author, question count, last updated) in plain text so teachers can browse
- The actual questions and answers are encrypted; students or anyone browsing GitHub cannot read them
- To load a library quiz, you need the teacher password

### Important: Password Security
**Do not share the teacher password with students.** If the password leaks, there is **no way to re-encrypt existing quizzes** — you must save them again with a new password.

### Save a Quiz to the Library
1. In the editor, open your quiz
2. Click **Save to Library**
3. Enter (or confirm) the **teacher password**
4. Paste your **GitHub token** (see section 5 below)
5. Click **Save** — the quiz is now in `quizzes/` in the repo

### Load a Library Quiz
1. In the editor, click the **Library** tab
2. Search for a quiz
3. Click to load it
4. Enter the teacher password
5. The quiz opens for editing or hosting

---

## 5. Getting a GitHub Token (To Save to the Library)

Only teachers who need to save quizzes to the library need a token. Teachers can always browse, load, and host library quizzes offline without a token.

### Step-by-Step
1. **GitHub account:** Create one at https://github.com if you don't have one
2. **Repository access:** Ask the repo owner (brycemac35) to add you as a collaborator
   - Repo owner: Go to repository **Settings** → **Collaborators** → **Add people**
   - If you are the owner, skip this
3. **Create a fine-grained token:**
   - Go to https://github.com/settings/personal-access-tokens/new
   - **Token name:** `khawho` (or anything)
   - **Expiration:** Choose or set to never expire
   - **Resource owner:** Pick `brycemac35` (the repo owner)
   - **Repository access:** Select **Only select repositories** → **Khawho**
   - **Permissions:** 
     - **Contents:** `Read and write`
   - Click **Generate token**
4. **Copy the token** (you'll only see it once)
5. **Paste in Khawho:** Go to editor **Settings** → paste the token
   - Your token stays in your browser only; it is never sent to any server except GitHub

**Troubleshooting:** If the Khawho repository doesn't appear in the list, check with the repo owner — they may need to enable fine-grained tokens or manually add you.

---

## 6. Backup Mode: If School Wi-Fi Blocks WebRTC

By default, Khawho uses **PeerJS** (WebRTC peer-to-peer) for host–player communication. Some school networks block WebRTC. If students can't connect, enable **Backup mode** using Firebase.

### Setup (Repo Owner Only)

1. **Create a Firebase project:**
   - Go to https://firebase.google.com/
   - Click **Go to Console**
   - Click **+ Add project**
   - Name: `Khawho` (or similar)
   - Accept terms, create

2. **Create a Realtime Database:**
   - Left sidebar → **Build** → **Realtime Database**
   - Click **Create Database**
   - Location: Choose the closest region to your school
   - Security rules: Select **Start in locked mode** (important!)
   - Click **Create**

3. **Set up security rules:**
   - In the Realtime Database, click the **Rules** tab
   - Delete the default rules
   - Copy the rules from `firebase-rules.json` (in the root of this repo)
   - Paste and click **Publish**. (These rules let anyone with a 6-digit PIN use that game only; nobody can list or read other games.)

4. **Get your Firebase config:**
   - Left sidebar → **Project Settings** (gear icon)
   - Scroll to **Your apps**
   - Click the web app `</>` icon
   - Copy the config object:
     ```javascript
     {
       apiKey: "...",
       authDomain: "...",
       databaseURL: "...",
       projectId: "...",
       storageBucket: "...",
       messagingSenderId: "...",
       appId: "..."
     }
     ```

5. **Add config to Khawho:**
   - Open `js/config.js`
   - Replace `export const FIREBASE_CONFIG = null;` with:
     ```javascript
     export const FIREBASE_CONFIG = { /* paste your config here */ };
     ```
   - Commit and push

6. **Enable in the app:**
   - Now when teachers start a game, they can choose **Backup (Firebase)** in Connection settings
   - Students will connect via Firebase instead of PeerJS

### Note: Web Config Is Not Secret
The Firebase config values (apiKey, projectId, etc.) are not sensitive — they're meant to be public. The security rules (step 3) protect your data.

---

## 7. Privacy

Khawho has **no accounts, no user tracking, no data storage** on any server.

- **Quizzes:** Saved locally in your browser, or encrypted in GitHub (with teacher password)
- **Answers:** Stored only in your browser during the game
- **Results:** Downloaded as CSV to your computer if you want; not saved anywhere else
- **In Backup mode (Firebase):** Messages between host and players are transient — they're deleted from Firebase immediately after delivery
- **Students:** No student names, emails, or data are stored permanently anywhere

---

## 8. Developer Notes

### Project Layout
```
index.html, host.html, play.html, editor.html     Main pages
js/
  rng.js                Random number generation (crypto.getRandomValues)
  quiz.js               Quiz schema, validation, import/export
  game.js               Pure game engine (host-authoritative, no DOM)
  crypto.js             AES-GCM encryption (PBKDF2-SHA256)
  storage.js            localStorage and GitHub API
  config.js             Configuration constants
  transport/
    index.js            Transport factory
    peerjs.js           WebRTC (default)
    firebase.js         Firebase Realtime Database (fallback)
    local.js            BroadcastChannel (dev/testing)
css/
  style.css             Base styles (colors, typography, layout)
  editor.css, host.css, play.css   Page-specific styles
tests/
  *.test.js             Unit tests for pure modules
samples/
  khawho-template.csv   CSV import template
  sample-quiz.json      Example quiz
```

### Static Site, No Build
There is no build step. ES modules load directly from `js/`. Third-party libraries (PeerJS, Firebase, SheetJS) load from CDN. The site must work from `https://brycemac35.github.io/Khawho/` with relative URLs.

### Randomness
All randomness comes from `js/rng.js`:
- `randomInt(n)` — uniform random integer in [0, n) using rejection sampling (no modulo bias)
- `shuffle(arr)` — Fisher–Yates shuffle
- `randomPin()` — 6-digit PIN (first digit 1–9)
- `randomId()` — random hex string

A test ensures `Math.random` is never used anywhere in the codebase (`grep`).

### Testing
```bash
node --test
```
Runs tests in `tests/` using Node 24+. Pure modules (`rng`, `quiz`, `game`, `crypto`) have no DOM or network calls and are importable from Node. The test suite includes:
- RNG distribution tests (chi-square)
- Quiz validation and import/export
- Game scoring and leaderboard logic
- Encryption/decryption

### Running Locally
Any static server works:
```bash
npx http-server
# or: python -m http.server
```
Open `http://localhost:8080`

### CSV Format (Detailed)
The CSV import/export uses this exact column order:
```
type, question, a1, a2, a3, a4, correct, time
```

Each row is one question:
- `type`: mc, tf, type, poll
- `question`: Question text (quote if it contains commas)
- `a1`–`a4`: Answer text (leave blank if unused)
- `correct`: 
  - MC/TF: position(s) of correct answer(s) separated by `;` (e.g., `1;3` means answers 1 and 3 are correct)
  - Type-answer: pipe-separated accepted answers (case/space-insensitive; e.g., `paris|paris, france`)
  - Poll: blank
- `time`: Time limit: 5, 10, 20, 30, 60, 90, or 120 seconds

### JSON Schema
All quizzes conform to this schema (see `js/quiz.js`):
```json
{
  "format": "khawho-quiz",
  "v": 1,
  "id": "<random hex string>",
  "title": "Quiz Title",
  "author": "Teacher Name",
  "updated": "<ISO date>",
  "questions": [
    {
      "type": "mc|tf|type|poll",
      "text": "Question text",
      "image": "<URL or data-URL or null>",
      "timeLimit": 20,
      "points": "standard|double|none",
      "answers": [
        { "text": "Answer text", "correct": true|false }
      ],
      "accepted": ["array of accepted answers for type-answer only"]
    }
  ]
}
```

### Encryption Details
- **Algorithm:** AES-GCM (256-bit key)
- **Key derivation:** PBKDF2-SHA256, 310,000 iterations
- **Salt:** 16 bytes, random per quiz
- **IV:** 12 bytes, random per quiz
- **Tag length:** 128 bits

When encrypted, quizzes are stored as JSON with `format: "khawho-quiz-enc"`, with metadata (title, author, count) in clear and questions encrypted in the `data` field.

---

## License

This project is open source. Hosted by [brycemac35](https://github.com/brycemac35).
