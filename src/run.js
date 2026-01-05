import { runOnce } from "./bot.js";

function safeError(e) {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      stack: e.stack,
    };
  }
  return { message: String(e) };
}

// 取りこぼし防止（本番で超大事）
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", safeError(reason));
  process.exitCode = 1;
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", safeError(err));
  process.exitCode = 1;
});

(async () => {
  try {
    const result = await runOnce();
    console.log(JSON.stringify({ ok: true, result }, null, 2));
    process.exitCode = 0;
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: safeError(e) }, null, 2));
    process.exitCode = 1;
  }
})();
