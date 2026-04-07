/**
 * OpenAI speech API → Supabase storage.
 */
import type { AppConfig } from "../config.js";
import { uploadBuffer } from "./supabase-storage.js";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";

export async function synthesizeSpeechToStorage(
  config: AppConfig,
  apiKey: string,
  text: string,
  objectPath: string
): Promise<{ public_url: string | null; bucket: string; object_path: string }> {
  const res = await fetch(OPENAI_SPEECH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.OPENAI_TTS_MODEL,
      voice: config.OPENAI_TTS_VOICE,
      input: text.slice(0, 4096),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS ${res.status}: ${err.slice(0, 400)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const up = await uploadBuffer(config, objectPath, buf, "audio/mpeg");
  return { public_url: up.public_url, bucket: up.bucket, object_path: up.object_path };
}
