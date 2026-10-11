// The home page is static HTML plus a dictionary: these tests keep the two in step with each other and with the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGES, ROOMS } from "../assets/js/data.js";
import { STRINGS } from "../assets/js/home-i18n.js";
import { accessCode } from "../server/whatsapp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(ROOT, "index.html"), "utf8");
const keysIn = (source) => [...source.matchAll(/data-i18n(?:-html|-alt|-aria)?="(\w+)"/g)].map((m) => m[1]);

test("every text key in index.html has an English translation", () => {
  const missing = [...new Set(keysIn(html))].filter((key) => !(key in STRINGS.en));
  assert.deepEqual(missing, []);
});

test("strings built by JavaScript exist in both languages", () => {
  const missing = Object.keys(STRINGS.it).filter((key) => !(key in STRINGS.en));
  assert.deepEqual(missing, []);
});

test("the walkthrough shows the door code the server would send for its example booking", () => {
  assert.match(html, /TTD-K7M2/);
  const [, shown] = /data-door-code="(\d{4})"/.exec(html);
  assert.equal(shown, accessCode("TTD-K7M2"));
});

test("every room has the English copy, a crop for its round image, and a listing photo that exists", async () => {
  for (const room of ROOMS) {
    assert.ok(room.en.type && room.en.bed && room.en.blurb && room.en.features.length, `${room.id}: English copy`);
    assert.ok(room.crop.x && room.crop.y && room.crop.zoom >= 1 && room.crop.zoom <= 1.3, `${room.id}: crop (never zoom past 1.3: the photos are native size)`);
    assert.ok(IMAGES[room.images[0]], `${room.id}: size of ${room.images[0]} is listed in IMAGES`);
  }
});

test("every listing photo exists in both renditions and the page uses only those", async () => {
  for (const name of Object.keys(IMAGES)) {
    await readFile(join(ROOT, "assets/img", `${name}-800.jpg`));
    await readFile(join(ROOT, "assets/img", `${name}-1600.jpg`));
  }
  for (const [, name] of html.matchAll(/assets\/img\/([\w-]+?)-(?:800|1600)\.jpg/g)) assert.ok(IMAGES[name], `index.html uses ${name}`);
});

test("the home page makes no claim about concept or AI-generated images", () => {
  assert.doesNotMatch(html + JSON.stringify(STRINGS), /concept|concettual|AI-generated|generat\w+ con AI|generated with AI/i);
});
