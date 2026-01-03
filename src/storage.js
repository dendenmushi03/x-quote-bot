import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.cwd(), "data");
const statePath = path.join(dataDir, "state.json");
const postedIdsPath = path.join(dataDir, "posted_ids.json");

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

export function loadState() {
  ensureDir();
  if (!fs.existsSync(statePath)) {
    return { lastPostedAt: 0, lastRunAt: 0 };
  }
  return JSON.parse(fs.readFileSync(statePath, "utf-8"));
}

export function saveState(state) {
  ensureDir();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export function loadPostedIds() {
  ensureDir();
  if (!fs.existsSync(postedIdsPath)) return [];
  return JSON.parse(fs.readFileSync(postedIdsPath, "utf-8"));
}

/**
 * 投稿済みIDの保存
 * - 増えすぎると重くなるので maxKeep で上限維持
 */
export function savePostedIds(ids, maxKeep = 2000) {
  ensureDir();
  const trimmed = ids.slice(-maxKeep);
  fs.writeFileSync(postedIdsPath, JSON.stringify(trimmed, null, 2), "utf-8");
}
