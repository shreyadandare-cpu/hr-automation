// Server time for every request: a Server-Timing header (the browser's Network panel shows it as "app") and a log line for any
// /api request slower than SLOW_REQUEST_MS (default 400 ms, the budget for a write; reads should be well under it).
// Measure speed with this header, not with a curl from a laptop: that mostly measures the network.
const SLOW = () => Number(process.env.SLOW_REQUEST_MS) || 400;

export function timing(req, res, next) {
  const start = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - start) / 1e6;
  const writeHead = res.writeHead;
  res.writeHead = function (...args) {
    if (!res.headersSent) { try { res.setHeader("Server-Timing", `app;dur=${ms().toFixed(1)}`); } catch { /* headers already sent */ } }
    return writeHead.apply(this, args);
  };
  res.on("finish", () => {
    const took = ms();
    if (took > SLOW() && req.path.startsWith("/api/")) console.warn(`[slow request] ${req.method} ${req.path} ${took.toFixed(0)} ms (status ${res.statusCode})`);
  });
  next();
}
