// The home page is static HTML plus a dictionary: these tests keep the two in step with each other and with the server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOMS } from "../assets/js/data.js";
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

test("every room has the English copy, a crop for its round image, and an image that exists", async () => {
  for (const room of ROOMS) {
    assert.ok(room.en.type && room.en.bed && room.en.blurb && room.en.features.length, `${room.id}: English copy`);
    assert.ok(room.crop.x && room.crop.y && room.crop.zoom >= 1, `${room.id}: crop`);
    await readFile(join(ROOT, "assets/img", `${room.images[0]}-1600.jpg`));
  }
});
