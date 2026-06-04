import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public", "voiceover", "shellmates-animated-demo");
const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID || "SAz9YHcvj6GT2YYXdXww";
const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

const scenes = [
  {
    id: "scene-01-intro",
    text: "This is Shellmates. Two Claude Code sessions, connected through one relay."
  },
  {
    id: "scene-02-profile",
    text: "Each person shares a name, and a few interests."
  },
  {
    id: "scene-03-letter",
    text: "Ken sends a short letter. It shows up inside Mina's terminal."
  },
  {
    id: "scene-04-coaching",
    text: "Claude suggests a reply, but Mina still decides what to send."
  },
  {
    id: "scene-05-reply",
    text: "Then Ken receives it on his side. The conversation is still human to human."
  },
  {
    id: "scene-06-use-cases",
    text: "This could be for friends, dates, collaborators, or teams."
  },
  {
    id: "scene-07-cta",
    text: "You can try it with one npx command."
  }
];

if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is required to generate voiceover audio.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const scene of scenes) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: scene.text,
      model_id: modelId,
      voice_settings: {
        stability: 0.62,
        similarity_boost: 0.72,
        style: 0.12,
        use_speaker_boost: true
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`ElevenLabs failed for ${scene.id}: ${response.status} ${message.slice(0, 500)}`);
  }

  const audio = Buffer.from(await response.arrayBuffer());
  const filename = join(outDir, `${scene.id}.mp3`);
  writeFileSync(filename, audio);
  console.log(`wrote ${filename.replace(`${root}/`, "")}`);
}
