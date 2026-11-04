// Emberwick sounds: everything is made by the browser (Web Audio), no sound files.
// Small work sounds (harvest rustle, pickaxe clinks, anvil, axe, sheep, splash...) and a quiet
// music loop that plays a pentatonic tune, slower and lower at night.

let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
export const sound = { sfx: store('ew.sfx') !== '0', music: store('ew.music') !== '0', night: false };

function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = sound.sfx ? 0.5 : 0; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = sound.music ? 0.11 : 0; musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic();
  return true;
}
// browsers only allow sound after the player has clicked something
export function unlockSound() { init(); }

export function setSfx(on) { sound.sfx = on; store('ew.sfx', on ? '1' : '0'); if (init()) sfxBus.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.05); }
export function setMusic(on) { sound.music = on; store('ew.music', on ? '1' : '0'); if (init()) musicBus.gain.setTargetAtTime(on ? 0.11 : 0, ctx.currentTime, 0.3); }
export function setNight(n) { sound.night = !!n; }

// ---- building blocks ----
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function noise(t, dur, type, freq, q, peak, out = sfxBus, sweepTo) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain(); env(g, t, 0.01, peak, dur);
  s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function tone(t, freq, dur, type, peak, out = sfxBus, a = 0.005, slideTo) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  o.connect(g).connect(out); o.start(t); o.stop(t + a + dur + 0.05);
}
// a metal hit: a few out-of-tune partials that ring and fade
function metal(t, base, peak, dur) { [1, 2.76, 5.4, 8.93].forEach((m, i) => tone(t, base * m, dur / (i + 1), 'sine', peak / (i + 1.5))); noise(t, 0.03, 'highpass', 3000, 1, peak * 0.6); }

const SOUNDS = {
  rustle(t) { for (let i = 0; i < 3; i++) noise(t + i * 0.42, 0.28, 'bandpass', 2600 + Math.random() * 900, 0.8, 0.35, sfxBus, 1500); },
  pick(t) { for (let i = 0; i < 3; i++) { metal(t + i * 0.45, 1250 + Math.random() * 200, 0.22, 0.35); noise(t + i * 0.45, 0.12, 'lowpass', 600, 1, 0.3); } },
  anvil(t) { for (let i = 0; i < 3; i++) metal(t + i * 0.45, 820 + i * 15, 0.3, 0.7); },
  chop(t) { for (let i = 0; i < 3; i++) { tone(t + i * 0.45, 180, 0.12, 'triangle', 0.5, sfxBus, 0.003, 70); noise(t + i * 0.45, 0.09, 'bandpass', 1100, 2, 0.45); } },
  saw(t) { for (let i = 0; i < 4; i++) noise(t + i * 0.32, 0.26, 'bandpass', i % 2 ? 2200 : 3000, 6, 0.75, sfxBus, i % 2 ? 3000 : 2200); },
  baa(t) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(420, t); o.frequency.linearRampToValueAtTime(380, t + 0.6);
    const vib = ctx.createOscillator(); vib.frequency.value = 26; const vg = ctx.createGain(); vg.gain.value = 18; vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3;
    const g = ctx.createGain(); env(g, t, 0.06, 0.25, 0.6);
    o.connect(f).connect(g).connect(sfxBus); o.start(t); vib.start(t); o.stop(t + 0.8); vib.stop(t + 0.8);
    SOUNDS.snip(t + 0.8);
  },
  snip(t) { for (let i = 0; i < 2; i++) { noise(t + i * 0.22, 0.05, 'highpass', 4500, 1, 0.35); tone(t + i * 0.22, 2400, 0.04, 'square', 0.05); } },
  splash(t) { noise(t, 0.5, 'bandpass', 1800, 0.7, 0.4, sfxBus, 400); tone(t + 0.05, 600, 0.25, 'sine', 0.12, sfxBus, 0.005, 1200); },
  knead(t) { for (let i = 0; i < 3; i++) noise(t + i * 0.42, 0.16, 'lowpass', 380, 1, 1.0); },
  mill(t) { noise(t, 1.3, 'lowpass', 300, 2, 0.25); for (let i = 0; i < 3; i++) tone(t + i * 0.43, 95, 0.3, 'triangle', 0.18); },
  clink(t) { metal(t, 2100, 0.12, 0.4); metal(t + 0.18, 2350, 0.1, 0.4); },
  coin(t) { tone(t, 1568, 0.09, 'square', 0.13); tone(t + 0.08, 2093, 0.25, 'square', 0.13); },
  bad(t) { tone(t, 220, 0.18, 'triangle', 0.18); tone(t + 0.16, 165, 0.25, 'triangle', 0.18); },
  build(t) { for (let i = 0; i < 4; i++) { tone(t + i * 0.3, 240, 0.08, 'triangle', 0.4, sfxBus, 0.002, 90); noise(t + i * 0.3, 0.06, 'bandpass', 1500, 2, 0.35); } },
  sleep(t) { [523, 440, 392, 330].forEach((f, i) => tone(t + i * 0.35, f, 0.5, 'sine', 0.12, sfxBus, 0.05)); },
  level(t) { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, f, 0.3, 'triangle', 0.18)); },
};
// which sound goes with working at which place
const WORK = { fields: 'rustle', forest: 'chop', woodcutter: 'chop', mine: 'pick', smithy: 'anvil', tower: 'anvil', carpenter: 'saw', pasture: 'baa', tailor: 'snip', pond: 'splash', bakery: 'knead', mill: 'mill', inn: 'clink' };

export function play(name) {
  if (!sound.sfx || !init() || !SOUNDS[name]) return;
  SOUNDS[name](ctx.currentTime + 0.02);
}
export function playWork(place) { play(WORK[place] || 'knead'); }

// ---- music: a soft plucked tune over a low drone, picked note by note ----
const DAY = [0, 2, 4, 7, 9, 12, 14, 16], NIGHT = [0, 3, 5, 7, 10, 12];
let musicTimer = null, step = 0, idx = 2;
function pluck(t, freq, peak, dur) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = ctx.createGain(); env(g, t, 0.01, peak, dur);
  o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + dur + 0.1);
}
function startMusic() {
  if (musicTimer) return;
  const tick = () => {
    const night = sound.night, beat = night ? 0.75 : 0.5;
    if (sound.music && ctx.state === 'running') {
      const t = ctx.currentTime + 0.05, scale = night ? NIGHT : DAY, root = night ? 196 : 262;
      if (step % 8 === 0) { pluck(t, root / 2, 0.5, beat * 7); pluck(t, root * 0.75, 0.25, beat * 7); }
      if (Math.random() < (night ? 0.55 : 0.75)) {
        idx = Math.max(0, Math.min(scale.length - 1, idx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        pluck(t, root * Math.pow(2, scale[idx] / 12), 0.35, beat * 2.2);
      }
      step++;
    }
    musicTimer = setTimeout(tick, (sound.night ? 0.75 : 0.5) * 1000);
  };
  tick();
}
