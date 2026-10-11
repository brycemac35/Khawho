import test from 'node:test';
import assert from 'node:assert';
import { encryptQuiz, decryptQuiz } from '../js/crypto.js';
import { newQuiz, newQuestion } from '../js/quiz.js';

test('encryptQuiz creates encrypted file with required fields', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test Quiz';
  quiz.author = 'Teacher';
  const q = newQuestion('mc');
  q.text = 'Question?';
  q.answers = [
    { text: 'A', correct: true },
    { text: 'B', correct: false },
  ];
  quiz.questions.push(q);

  const encrypted = await encryptQuiz(quiz, 'password');

  assert(encrypted.format === 'khawho-quiz-enc');
  assert(encrypted.v === 1);
  assert(encrypted.title === 'Test Quiz');
  assert(encrypted.author === 'Teacher');
  assert(encrypted.count === 1);
  assert(typeof encrypted.updated === 'string');
  assert(typeof encrypted.salt === 'string');
  assert(typeof encrypted.iv === 'string');
  assert(typeof encrypted.data === 'string');
  // All encrypted fields should be base64
  assert(/^[A-Za-z0-9+/]*={0,2}$/.test(encrypted.salt));
  assert(/^[A-Za-z0-9+/]*={0,2}$/.test(encrypted.iv));
  assert(/^[A-Za-z0-9+/]*={0,2}$/.test(encrypted.data));
});

test('decryptQuiz recovers original quiz', async () => {
  const original = newQuiz();
  original.title = 'Test Quiz';
  original.author = 'Teacher';
  const q = newQuestion('mc');
  q.text = 'What is 2+2?';
  q.answers = [
    { text: '4', correct: true },
    { text: '5', correct: false },
  ];
  original.questions.push(q);

  const password = 'secret password';
  const encrypted = await encryptQuiz(original, password);
  const decrypted = await decryptQuiz(encrypted, password);

  assert(decrypted.title === original.title);
  assert(decrypted.author === original.author);
  assert(decrypted.questions.length === 1);
  assert(decrypted.questions[0].text === 'What is 2+2?');
  assert(decrypted.questions[0].answers[0].text === '4');
});

test('decryptQuiz throws on wrong password', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  quiz.questions.push(newQuestion('mc'));

  const encrypted = await encryptQuiz(quiz, 'correct');

  try {
    await decryptQuiz(encrypted, 'wrong');
    assert.fail('Should have thrown');
  } catch (err) {
    assert(err.message === 'Wrong teacher password');
  }
});

test('decryptQuiz throws on tampered data', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  quiz.questions.push(newQuestion('mc'));

  const encrypted = await encryptQuiz(quiz, 'password');

  // Tamper with the encrypted data
  const tampered = { ...encrypted };
  const dataBytes = Buffer.from(encrypted.data, 'base64');
  dataBytes[0] ^= 0xff; // flip bits
  tampered.data = dataBytes.toString('base64');

  try {
    await decryptQuiz(tampered, 'password');
    assert.fail('Should have thrown');
  } catch (err) {
    assert(err.message === 'Wrong teacher password');
  }
});

test('encrypted data does not contain plaintext question text', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  const q = newQuestion('mc');
  q.text = 'This is the question text';
  q.answers = [{ text: 'Answer', correct: true }];
  quiz.questions.push(q);

  const encrypted = await encryptQuiz(quiz, 'password');

  assert(!encrypted.data.includes('This is the question text'));
  assert(!encrypted.data.includes('Answer'));
});

test('encryptQuiz round-trip with multiple questions', async () => {
  const original = newQuiz();
  original.title = 'Complex Quiz';
  original.author = 'Expert';

  for (let i = 0; i < 3; i++) {
    const q = newQuestion(i === 0 ? 'mc' : i === 1 ? 'tf' : 'type');
    q.text = `Question ${i + 1}`;
    if (q.type === 'mc') {
      q.answers = [
        { text: 'A', correct: true },
        { text: 'B', correct: false },
      ];
    } else if (q.type === 'tf') {
      q.answers[0].correct = true;
    } else {
      q.accepted = ['answer1', 'answer2'];
    }
    original.questions.push(q);
  }

  const password = 'test password 123';
  const encrypted = await encryptQuiz(original, password);
  const decrypted = await decryptQuiz(encrypted, password);

  assert(decrypted.title === original.title);
  assert(decrypted.author === original.author);
  assert(decrypted.questions.length === 3);
  assert(decrypted.questions[0].type === 'mc');
  assert(decrypted.questions[1].type === 'tf');
  assert(decrypted.questions[2].type === 'type');
  assert.deepStrictEqual(decrypted.questions[2].accepted, ['answer1', 'answer2']);
});

test('different passwords produce different ciphertexts', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  quiz.questions.push(newQuestion('mc'));

  const enc1 = await encryptQuiz(quiz, 'password1');
  const enc2 = await encryptQuiz(quiz, 'password2');

  assert(enc1.data !== enc2.data);
  assert(enc1.salt !== enc2.salt); // Should have different salts
});

test('same password and quiz produces different ciphertexts (different IV)', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  quiz.questions.push(newQuestion('mc'));

  const enc1 = await encryptQuiz(quiz, 'password');
  const enc2 = await encryptQuiz(quiz, 'password');

  // IVs should be different
  assert(enc1.iv !== enc2.iv);
  // Data should be different (due to different IV)
  assert(enc1.data !== enc2.data);
  // But both should decrypt correctly
  const dec1 = await decryptQuiz(enc1, 'password');
  const dec2 = await decryptQuiz(enc2, 'password');
  assert(dec1.title === dec2.title);
});

test('encryptQuiz preserves quiz format and version', async () => {
  const quiz = newQuiz();
  quiz.title = 'Test';
  quiz.questions.push(newQuestion('mc'));

  const encrypted = await encryptQuiz(quiz, 'password');

  assert(encrypted.format === 'khawho-quiz-enc');
  assert(encrypted.v === 1);
});
