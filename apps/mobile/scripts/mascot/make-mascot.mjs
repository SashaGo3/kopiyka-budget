#!/usr/bin/env node
/**
 * Generates the mascot (the cat in the sheep hood holding the К) through a local ComfyUI server.
 * Nothing here is hand-drawn: one flat 2D still is made from the cat photo and the app icon, then
 * every moment in MOMENTS is animated from that still and cut out to a transparent animated WebP.
 *
 *   node scripts/mascot/make-mascot.mjs still            # 4 candidate stills → ComfyUI output/kopiyka_mascot/
 *   node scripts/mascot/make-mascot.mjs pick <file.png>  # copy the chosen still to assets/mascot/still.png
 *   node scripts/mascot/make-mascot.mjs clips [id ...]   # animate (all moments, or the ones named)
 *
 * Needs ComfyUI on COMFY_URL (default http://127.0.0.1:8188) with Qwen Image 2.1 (turbo), Wan 2.2
 * i2v 14B + the lightx2v 4-step LoRAs, and BiRefNet in models/background_removal.
 *
 * Each clip starts and ends on the still (Wan first-last-frame), so a looping clip has no seam and a
 * one-shot clip settles back to the pose the app shows when the animation is off (reduced motion).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "assets/mascot");
const SITE = resolve(ROOT, "../../site/img/mascot"); // the website waves with the same clip
const COMFY = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
const COMFY_OUTPUT = process.env.COMFY_OUTPUT ?? `${process.env.HOME}/Documents/ComfyUI/output`;
const CAT_PHOTO = "cat_icon_source.png"; // in ComfyUI's input folder
const APP_ICON = "kopiyka_k_icon.png";

const LOOK =
  "white short-haired cat with a pink nose and pale blue-grey eyes, wearing a fluffy white sheep-style hood with small black ears " +
  "and a black hoodie with a white skeleton rib print";

const STILL_PROMPT =
  `Draw the cat from <image1> as a flat 2D vector-style mascot character for the budgeting app "Kopiyka". Keep its identity: ${LOOK}. ` +
  "Full body, standing upright on its hind legs, facing the viewer with a friendly calm smile, hugging with both front paws a big letter К " +
  "copied from <image2>: the same thick rounded strokes, dark charcoal face with a slightly lighter grey side. The К reaches the cat's chin. " +
  "Flat colours, clean smooth outlines, minimal soft cel shading, simple shapes that read at small sizes, like a modern app illustration. " +
  "Centered with generous margin on all sides, plain pure white background, nothing else in the picture, no floor, no shadow, no text other than the К.";

/** One clip per moment the app shows the cat. `loop` clips play until the view goes; the rest play once. */
export const MOMENTS = [
  { id: "hello", loop: false, action: "waves one front paw at the viewer twice, blinks and tilts its head in greeting" },
  { id: "ready", loop: false, action: "jumps up with joy lifting the К above its head, lands and hugs the К again" },
  { id: "coin", loop: false, action: "a small gold coin drops from above, the cat catches it, nods happily and tucks it behind the К" },
  { id: "salary", loop: false, action: "gold coins rain down around the cat, it bounces excitedly with sparkling eyes, then hugs the К proudly" },
  { id: "proud", loop: true, action: "stands proudly with chest out, gives a satisfied slow blink and a small nod" },
  { id: "worried", loop: true, action: "ears droop, looks down at the К with a worried face, sighs and slowly looks back up" },
  { id: "sleep", loop: true, action: "sleepily leans on the К, eyes closed, breathing slowly, a gentle yawn, ears twitch" },
  { id: "debt", loop: true, action: "holds a small paper note in one paw, reads it, taps its chin thoughtfully" },
  { id: "oops", loop: false, action: "looks confused, scratches its head with one paw, shrugs apologetically" },
];

const MOTION =
  "Smooth gentle flat 2D cartoon animation, the character keeps exactly the same art style, colours and proportions in every frame. " +
  "Static camera, plain pure white background, the whole cat and the К stay fully in frame. At the end it returns to its starting pose.";

const NEGATIVE =
  "色调艳丽，过曝，细节模糊不清，字幕，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，畸形的，毁容的，形态畸形的肢体，手指融合，杂乱的背景，三条腿，" +
  "3d render, photo, realistic fur, camera movement, zoom, background scenery, text, watermark";

// ---- graphs (ComfyUI API format) ----

function stillGraph(seed) {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_turbo_int8_convrot.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "qwen_image" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
    cat: { class_type: "LoadImage", inputs: { image: CAT_PHOTO } },
    icon: { class_type: "LoadImage", inputs: { image: APP_ICON } },
    // resolution 1024 also keeps the VAE's attention under the MPS tensor-size limit
    enc: { class_type: "TextEncodeQwenImage21", inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: STILL_PROMPT, negative_prompt: "", resolution: 1024, "images.image_1": ["cat", 0], "images.image_2": ["icon", 0] } },
    latent: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    noise: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    sampler: { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    sigmas: { class_type: "ManualSigmas", inputs: { sigmas: "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0" } },
    guider: { class_type: "CFGGuider", inputs: { model: ["cache", 0], positive: ["enc", 0], negative: ["enc", 1], cfg: 1 } },
    sample: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler", 0], sigmas: ["sigmas", 0], latent_image: ["latent", 0] } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: `kopiyka_mascot/still_${seed}` } },
  };
}

const SIZE = 480; // Wan 480p; the app shows the cat at ≤160pt, so this is 3x
const FPS = 16;
const FRAMES = 49; // 3 s; Wan wants 4n+1

function clipGraph(moment, still, seed) {
  const prompt = `The flat 2D cartoon mascot cat (${LOOK}) hugging a big dark letter К ${moment.action}. ${MOTION}`;
  const sampler = (model, latent, start, end, first) => ({
    class_type: "KSamplerAdvanced",
    inputs: {
      model, positive: ["i2v", 0], negative: ["i2v", 1], latent_image: latent,
      add_noise: first ? "enable" : "disable", noise_seed: seed, steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple",
      start_at_step: start, end_at_step: end, return_with_leftover_noise: first ? "enable" : "disable",
    },
  });
  return {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "wan_2.1_vae.safetensors" } },
    high: { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
    low: { class_type: "UNETLoader", inputs: { unet_name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", weight_dtype: "default" } },
    highLora: { class_type: "LoraLoaderModelOnly", inputs: { model: ["high", 0], lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors", strength_model: 1 } },
    lowLora: { class_type: "LoraLoaderModelOnly", inputs: { model: ["low", 0], lora_name: "wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors", strength_model: 1 } },
    highShift: { class_type: "ModelSamplingSD3", inputs: { model: ["highLora", 0], shift: 5 } },
    lowShift: { class_type: "ModelSamplingSD3", inputs: { model: ["lowLora", 0], shift: 5 } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: prompt } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: NEGATIVE } },
    still: { class_type: "LoadImage", inputs: { image: still } },
    i2v: {
      class_type: "WanFirstLastFrameToVideo",
      inputs: { positive: ["pos", 0], negative: ["neg", 0], vae: ["vae", 0], width: SIZE, height: SIZE, length: FRAMES, batch_size: 1, start_image: ["still", 0], end_image: ["still", 0] },
    },
    hi: sampler(["highShift", 0], ["i2v", 2], 0, 2, true),
    lo: sampler(["lowShift", 0], ["hi", 0], 2, 4, false),
    decode: { class_type: "VAEDecode", inputs: { samples: ["lo", 0], vae: ["vae", 0] } },
    preview: { class_type: "SaveAnimatedWEBP", inputs: { images: ["decode", 0], filename_prefix: `kopiyka_mascot/${moment.id}_raw`, fps: FPS, lossless: false, quality: 85, method: "default" } },
    bgModel: { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: "birefnet.safetensors" } },
    fg: { class_type: "RemoveBackground", inputs: { bg_removal_model: ["bgModel", 0], image: ["decode", 0] } },
    // JoinImageWithAlpha takes an inverted mask (ComfyUI's convention), same as the BiRefNet template
    inv: { class_type: "InvertMask", inputs: { mask: ["fg", 0] } },
    cut: { class_type: "JoinImageWithAlpha", inputs: { image: ["decode", 0], alpha: ["inv", 0] } },
    save: { class_type: "SaveAnimatedWEBP", inputs: { images: ["cut", 0], filename_prefix: `kopiyka_mascot/${moment.id}`, fps: FPS, lossless: false, quality: 80, method: "default" } },
  };
}

// ---- ComfyUI client ----

async function run(graph) {
  const res = await fetch(`${COMFY}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph }) });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(JSON.stringify(body.node_errors && Object.keys(body.node_errors).length ? body.node_errors : body.error, null, 1));
  const id = body.prompt_id;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const h = (await (await fetch(`${COMFY}/history/${id}`)).json())[id];
    if (!h) continue;
    if (h.status?.status_str === "error") throw new Error(JSON.stringify(h.status.messages.find((m) => m[0] === "execution_error")?.[1]?.exception_message ?? h.status));
    if (h.status?.completed) return Object.values(h.outputs).flatMap((o) => o.images ?? []).map((i) => resolve(COMFY_OUTPUT, i.subfolder, i.filename));
  }
}

async function upload(file) {
  const form = new FormData();
  form.append("image", new Blob([readFileSync(file)]), `kopiyka_mascot_${basename(file)}`);
  form.append("overwrite", "true");
  const res = await fetch(`${COMFY}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).name;
}

const seed = () => Math.floor(Math.random() * 2 ** 48);
const [cmd, ...args] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });

if (cmd === "still") {
  for (let i = 0; i < 4; i++) console.log(...(await run(stillGraph(seed()))));
} else if (cmd === "pick") {
  copyFileSync(args[0], resolve(OUT, "still.png"));
  mkdirSync(SITE, { recursive: true });
  copyFileSync(args[0], resolve(SITE, "still.png"));
  console.log("assets/mascot/still.png, site/img/mascot/still.png");
} else if (cmd === "clips") {
  const still = await upload(resolve(OUT, "still.png"));
  const todo = args.length ? MOMENTS.filter((m) => args.includes(m.id)) : MOMENTS;
  for (const m of todo) {
    const t = Date.now();
    const files = await run(clipGraph(m, still, seed()));
    const cut = files.find((f) => basename(f).startsWith(`${m.id}_0`));
    copyFileSync(cut, resolve(OUT, `${m.id}.webp`));
    if (m.id === "hello") { mkdirSync(SITE, { recursive: true }); copyFileSync(cut, resolve(SITE, "hello.webp")); }
    console.log(`${m.id}: ${Math.round((Date.now() - t) / 1000)}s → assets/mascot/${m.id}.webp`);
  }
  writeFileSync(resolve(OUT, "moments.json"), JSON.stringify(Object.fromEntries(MOMENTS.map((m) => [m.id, { loop: m.loop, ms: Math.round((FRAMES / FPS) * 1000) }])), null, 2) + "\n");
} else {
  console.log("usage: make-mascot.mjs still | pick <file.png> | clips [id ...]");
}
