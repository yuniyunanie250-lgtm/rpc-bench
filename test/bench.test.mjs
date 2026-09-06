import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { bench, percentile, rankBy } from "../src/bench.mjs";

/** Start a stub JSON-RPC server. `handler` gets the parsed body, returns an object. */
async function serve(handler) {
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const { status = 200, payload } = handler(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test("percentile uses nearest-rank and handles the edges", () => {
  const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(v, 0), 10);
  assert.equal(percentile(v, 100), 100);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 95), 100);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([9, 1, 5], 50), 5, "unsorted input must be sorted first");
  assert.throws(() => percentile([], 50));
});

test("bench reports latency and ok on a healthy endpoint", async () => {
  const s = await serve(() => ({ payload: { jsonrpc: "2.0", id: 1, result: "0x10" } }));
  try {
    const r = await bench(s.url, { samples: 5, timeoutMs: 2000 });
    assert.equal(r.latency.count, 5);
    assert.equal(r.ok, true);
    assert.equal(r.blockNumber, "0x10");
    assert.ok(r.latency.p50 >= 0);
    assert.ok(r.latency.p95 >= r.latency.p50);
    assert.deepEqual(r.errors, {});
  } finally {
    s.close();
  }
});

test("bench counts JSON-RPC errors instead of latency", async () => {
  const s = await serve(() => ({
    payload: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "no block" } },
  }));
  try {
    const r = await bench(s.url, { samples: 3 });
    assert.equal(r.latency.count, 0);
    assert.equal(r.ok, false);
    assert.equal(r.errors["rpc_-32000"], 3);
  } finally {
    s.close();
  }
});

test("bench counts http and malformed bodies separately", async () => {
  const s = await serve((body) =>
    body.id % 2 === 0
      ? { status: 429, payload: { message: "slow down" } }
      : { payload: { jsonrpc: "2.0", id: body.id, result: "0x1" } },
  );
  try {
    const r = await bench(s.url, { samples: 4 });
    assert.equal(r.errors.http_429, 2);
    assert.equal(r.latency.count, 2);
    assert.equal(r.ok, false);
  } finally {
    s.close();
  }
});

test("bench records a timeout when the server never answers", async () => {
  const server = http.createServer(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await bench(url, { samples: 1, timeoutMs: 150 });
    assert.equal(r.errors.timeout, 1);
    assert.equal(r.ok, false);
  } finally {
    server.close();
  }
});

test("rankBy orders by p50 with unreachable endpoints last", () => {
  const rs = [
    { url: "slow", latency: { p50: 90 } },
    { url: "dead", latency: { p50: null } },
    { url: "fast", latency: { p50: 12 } },
  ];
  assert.deepEqual(rankBy(rs).map((r) => r.url), ["fast", "slow", "dead"]);
});
