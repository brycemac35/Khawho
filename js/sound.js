/**
 * WebAudio synthesized sound effects and music
 * Lobby loop, countdown ticks, reveal sounds, podium fanfare
 * No audio files - all synthesis
 */

let audioContext = null;
let isMuted = false;

// Load mute state from localStorage
function loadMuteState() {
  const stored = localStorage.getItem('khawho.muted');
  isMuted = stored === 'true';
}

// Save mute state to localStorage
function saveMuteState() {
  localStorage.setItem('khawho.muted', isMuted);
}

loadMuteState();

/**
 * Get or create the AudioContext (delayed to after first user gesture)
 */
function getAudioContext() {
  if (audioContext === null) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

/**
 * Ensure AudioContext is running
 */
function ensureAudioContext() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {
      // Silently ignore if resume fails
    });
  }
  return ctx;
}

/**
 * Play a simple tone
 * @param {number} frequency - Hz
 * @param {number} duration - seconds
 * @param {number} volume - 0-1
 * @param {string} waveform - 'sine', 'square', 'sawtooth', 'triangle'
 */
function playTone(frequency, duration, volume = 0.3, waveform = 'sine') {
  if (isMuted) return;

  const ctx = ensureAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = waveform;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

/**
 * Play an arpeggio (ascending tones)
 * @param {number[]} frequencies - Array of Hz values
 * @param {number} noteDuration - seconds per note
 * @param {number} volume - 0-1
 */
function playArpeggio(frequencies, noteDuration = 0.1, volume = 0.2) {
  if (isMuted) return;

  const ctx = ensureAudioContext();
  let time = ctx.currentTime;

  frequencies.forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + noteDuration);

    osc.start(time);
    osc.stop(time + noteDuration);

    time += noteDuration;
  });
}

/**
 * Lobby loop music (upbeat arpeggio, short repeating pattern)
 * Plays the pattern once - can be called repeatedly to loop
 */
export function playLobbyMusic() {
  if (isMuted) return;

  // Upbeat C major arpeggio: C4, E4, G4, C5 (261, 329, 392, 523 Hz)
  const frequencies = [261, 329, 392, 523, 523, 523];
  playArpeggio(frequencies, 0.15, 0.25);
}

/**
 * Countdown tick (short beep, for last 5 seconds)
 */
export function playCountdownTick() {
  if (isMuted) return;

  playTone(800, 0.1, 0.3, 'square');
}

/**
 * Time's up sting (two descending tones)
 */
export function playTimeUp() {
  if (isMuted) return;

  const ctx = ensureAudioContext();
  const time = ctx.currentTime;

  // High note
  playTone(600, 0.15, 0.4, 'sine');

  // Low note (delayed)
  setTimeout(() => {
    playTone(400, 0.15, 0.4, 'sine');
  }, 160);
}

/**
 * Correct answer reveal sound (upward chirp)
 */
export function playCorrect() {
  if (isMuted) return;

  const ctx = ensureAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sine';
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

  // Sweep frequency upward
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}

/**
 * Wrong answer reveal sound (descending buzz)
 */
export function playWrong() {
  if (isMuted) return;

  const ctx = ensureAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'square';
  gain.gain.setValueAtTime(0.25, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

  // Sweep frequency downward
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.2);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.2);
}

/**
 * Podium fanfare (triumphant arpeggio)
 */
export function playPodiumFanfare() {
  if (isMuted) return;

  // Triumphant C major up and down: C4, E4, G4, C5, G4, E4, C4
  const frequencies = [261, 329, 392, 523, 392, 329, 261];
  playArpeggio(frequencies, 0.15, 0.35);
}

/**
 * Set mute state
 * @param {boolean} muted
 */
export function setMuted(muted) {
  isMuted = muted;
  saveMuteState();
}

/**
 * Get current mute state
 * @returns {boolean}
 */
export function isMutedState() {
  return isMuted;
}
