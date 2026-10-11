import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// ponytail: one JSON file plus an in-process write queue. Fine for a single host process;
// move to SQLite/Postgres before running two instances or handling real volume.
async function save(file, state) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, file);
}

export async function openDb(file, initial) {
  await mkdir(dirname(file), { recursive: true });
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw new Error(`Cannot read ${file}: ${err.message}. Fix or delete it to start fresh.`);
    state = initial();
    await save(file, state);
  }
  let queue = Promise.resolve();
  return {
    get: () => state,
    // fn(state) must be synchronous and return the next state: check-and-write is atomic.
    update(fn) {
      const run = queue.then(async () => {
        const next = fn(state);
        await save(file, next);
        state = next;
        return next;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
