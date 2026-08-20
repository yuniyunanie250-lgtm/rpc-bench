/**
 * Measure latency and error behaviour of JSON-RPC endpoints.
 *
 * The point is picking a provider with evidence instead of vibes: median tells
 * you the typical case, p95 tells you what your users hit when it matters.
 */

/** Nearest-rank percentile on a sorted copy. `p` is 0..100. */
export function percentile(values, p) {
  if (values.length === 0) throw new Error("percentile of empty sample");
  if (p <= 0) return Math.min(...values);
  if (p >= 100) return Math.max(...values);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function summarize(samples) {
  if (samples.length === 0) {
    return { count: 0, min: null, max: null, p50: null, p95: null, mean: null };
  }
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    mean: sum / samples.length,
  };
}

/**
 * Send `samples` JSON-RPC calls and time each one.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.samples=20]
 * @param {string} [opts.method="eth_blockNumber"]
 * @param {unknown[]} [opts.params=[]]
 * @param {number} [opts.timeoutMs=5000]
 * @param {number} [opts.concurrency=1]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{url: string, ok: boolean, latency: object, errors: object, blockNumber: string|null}>}
 */
export async function bench(url, opts = {}) {
  const {
    samples = 20,
    method = "eth_blockNumber",
    params = [],
    timeoutMs = 5000,
    concurrency = 1,
    fetchImpl = globalThis.fetch,
  } = opts;

  if (typeof fetchImpl !== "function") {
    throw new Error("no fetch implementation available (Node >= 18 required)");
  }

  const latency = [];
  const errors = {};
  let blockNumber = null;
  let next = 0;

  const worker = async () => {
    while (next < samples) {
      const i = next++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const started = performance.now();
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: i + 1, method, params }),
          signal: ctrl.signal,
        });
        const elapsed = performance.now() - started;
        const text = await res.text();
        if (!res.ok) {
          errors[`http_${res.status}`] = (errors[`http_${res.status}`] ?? 0) + 1;
          continue;
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          errors.malformed_json = (errors.malformed_json ?? 0) + 1;
          continue;
        }
        if (body?.error) {
          const key = body.error.code !== undefined ? `rpc_${body.error.code}` : "rpc_error";
          errors[key] = (errors[key] ?? 0) + 1;
          continue;
        }
        latency.push(elapsed);
        if (typeof body?.result === "string") blockNumber = body.result;
      } catch (err) {
        const key = err?.name === "AbortError" ? "timeout" : "network";
        errors[key] = (errors[key] ?? 0) + 1;
      } finally {
        clearTimeout(timer);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, samples)) }, worker),
  );

  return {
    url,
    ok: latency.length > 0 && Object.keys(errors).length === 0,
    latency: summarize(latency),
    errors,
    blockNumber,
  };
}

/** Median of the per-endpoint p50s, rounded -- handy as a single score. */
export function rankBy(results) {
  return [...results]
    .sort((a, b) => (a.latency.p50 ?? Infinity) - (b.latency.p50 ?? Infinity));
}
