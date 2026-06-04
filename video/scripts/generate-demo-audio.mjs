import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public");
const sampleRate = 48000;
const channels = 2;
const tau = Math.PI * 2;

mkdirSync(outDir, { recursive: true });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fade = (t, duration, attack = 0.01, release = 0.08) =>
  clamp(t / attack, 0, 1) * clamp((duration - t) / release, 0, 1);
const sine = (frequency, t, phase = 0) => Math.sin(tau * frequency * t + phase);
const soft = (value) => Math.tanh(value * 1.8) / 1.8;

const writeWav = (filename, duration, renderSample) => {
  const frames = Math.ceil(duration * sampleRate);
  const dataBytes = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    const [left, right] = renderSample(t, duration);
    const offset = 44 + i * channels * 2;
    buffer.writeInt16LE(Math.round(clamp(left, -1, 1) * 32767), offset);
    buffer.writeInt16LE(Math.round(clamp(right, -1, 1) * 32767), offset + 2);
  }

  writeFileSync(join(outDir, filename), buffer);
  console.log(`wrote public/${filename}`);
};

writeWav("shellmates-bed.wav", 64, (t, duration) => {
  const roots = [110, 130.81, 146.83, 98];
  const root = roots[Math.floor(t / 8) % roots.length];
  const beat = (t * 1.6) % 1;
  const eighth = (t * 3.2) % 1;
  const pulse = Math.exp(-beat * 7);
  const tick = Math.exp(-eighth * 12);
  const shimmerGate = Math.floor(t * 4) % 4 === 0 ? 1 : 0.35;
  const globalFade = fade(t, duration, 2.2, 5.2);
  const pad =
    sine(root, t) * 0.035 +
    sine(root * 1.5, t, 0.9) * 0.028 +
    sine(root * 2, t, 0.35) * 0.024 +
    sine(root * 3, t, 1.7) * 0.012;
  const motion =
    sine(root * 4, t, 0.2) * pulse * 0.018 +
    sine(root * 6, t, 1.4) * tick * 0.009 * shimmerGate +
    sine(0.07, t) * 0.011;
  const left = soft((pad + motion) * globalFade);
  const right = soft((pad * 0.94 + motion * 1.12 + sine(root * 2.5, t, 1.1) * 0.009) * globalFade);

  return [left, right];
});

writeWav("sfx-ping.wav", 0.24, (t, duration) => {
  const e = fade(t, duration, 0.004, 0.18) * Math.exp(-t * 8.5);
  const tone = sine(880, t) * 0.2 + sine(1320, t, 0.25) * 0.11;

  return [tone * e, tone * e * 0.82];
});

writeWav("sfx-key.wav", 0.065, (t, duration) => {
  const e = fade(t, duration, 0.0015, 0.045);
  const click =
    sine(1850, t) * Math.exp(-t * 70) * 0.11 +
    sine(3100, t, 0.7) * Math.exp(-t * 95) * 0.075 +
    sine(420, t, 1.1) * Math.exp(-t * 38) * 0.05;

  return [click * e, click * e * 0.86];
});

writeWav("sfx-coach.wav", 0.44, (t, duration) => {
  const e = fade(t, duration, 0.012, 0.22);
  const first = sine(523.25, t) * Math.exp(-t * 5.2);
  const second = t > 0.16 ? sine(659.25, t - 0.16) * Math.exp(-(t - 0.16) * 4.8) : 0;
  const lower = sine(261.63, t, 0.4) * Math.exp(-t * 3.8);
  const tone = (first * 0.16 + second * 0.17 + lower * 0.08) * e;

  return [tone * 0.9, tone];
});

writeWav("sfx-cta.wav", 0.86, (t, duration) => {
  const e = fade(t, duration, 0.025, 0.42);
  const lift = clamp(t / 0.5, 0, 1);
  const chord =
    sine(392, t) * 0.11 +
    sine(523.25, t, 0.4) * 0.1 +
    sine(659.25 + lift * 12, t, 0.8) * 0.09 +
    sine(783.99 + lift * 18, t, 1.1) * 0.055;

  return [chord * e, chord * e * 0.94];
});
