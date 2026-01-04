import { runOnce } from "./bot.js";

(async () => {
  try {
    const result = await runOnce();
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
