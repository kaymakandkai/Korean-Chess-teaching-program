// 착수 소리 (WebAudio로 짧은 "딱" 소리를 합성)
import { settings } from './settings';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (!settings.sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function knock(freq: number, gain: number, dur = 0.09) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 2.2;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
}

export const sound = {
  move: () => knock(1500, 0.9),
  capture: () => {
    knock(1100, 1.0);
    setTimeout(() => knock(1700, 0.6), 60);
  },
  check: () => {
    knock(900, 1.0, 0.14);
    setTimeout(() => knock(1300, 0.8, 0.12), 110);
  },
};
