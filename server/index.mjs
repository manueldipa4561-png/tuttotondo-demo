import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";

const TICK_MS = 15_000; // send due WhatsApp messages
const SYNC_MS = 30_000; // read channel calendars (a real channel manager would poll every few minutes)
const PULL_MS = 180_000; // the mock Booking.com reads our calendar (the real one takes hours)
const DEFAULT_PORT = 4129;

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(join(rootDir, ".env"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

const app = await createApp({ rootDir, dataDir: join(rootDir, "data") });
const port = await app.listen(Number(process.env.PORT ?? DEFAULT_PORT));
await app.pull();
await app.sync();

const log = (what) => (err) => console.error(`${what} failed:`, err.message);
setInterval(() => app.tick().catch(log("whatsapp tick")), TICK_MS);
setInterval(() => app.sync().catch(log("channel sync")), SYNC_MS);
setInterval(() => app.pull().catch(log("mock pull")), PULL_MS);

const stop = () => app.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

console.log(`Tuttotondo demo  http://localhost:${port}/`);
console.log(`Host console    http://localhost:${port}/gestione.html`);
