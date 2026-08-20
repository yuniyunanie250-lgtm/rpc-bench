#!/usr/bin/env node
import { bench, rankBy } from "./bench.mjs";

const HELP = `rpc-bench -- measure JSON-RPC endpoints before you commit to one

usage:
  rpc-bench <url> [url ...] [options]

options:
  --samples <n>      calls per endpoint (default 20)
  --method <name>    rpc method (default eth_blockNumber)
  --timeout <ms>     per-call timeout (default 5000)
  --concurrency <n>  parallel calls (default 1)
  --json             machine-readable output
  -h, --help         this message

example:
  rpc-bench https://rpc.ankr.com/eth https://eth.llamarpc.com --samples 50
`;

function parse(argv) {
  const urls = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    else if (a === "--json") opts.json = true;
    else if (a === "--samples") opts.samples = Number(argv[++i]);
    else if (a === "--method") opts.method = argv[++i];
    else if (a === "--timeout") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--concurrency") opts.concurrency = Number(argv[++i]);
    else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else urls.push(a);
  }
  return { urls, opts };
}

function fmt(ms) {
  return ms === null ? "-" : `${ms.toFixed(1)}ms`;
}

async function main() {
  const { urls, opts, help } = parse(process.argv.slice(2));
  if (help || urls.length === 0) {
    process.stdout.write(HELP);
    process.exit(help ? 0 : 1);
  }

  const results = await Promise.all(urls.map((u) => bench(u, opts)));

  if (opts.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }

  const width = Math.max(...urls.map((u) => u.length), 3);
  console.log(`${"endpoint".padEnd(width)}  ${"p50".padStart(9)}  ${"p95".padStart(9)}  ${"min".padStart(9)}  ${"max".padStart(9)}  ok     errors`);
  for (const r of rankBy(results)) {
    console.log(
      `${r.url.padEnd(width)}  ${fmt(r.latency.p50).padStart(9)}  ${fmt(r.latency.p95).padStart(9)}` +
        `  ${fmt(r.latency.min).padStart(9)}  ${fmt(r.latency.max).padStart(9)}` +
        `  ${String(r.ok).padEnd(6)} ${Object.entries(r.errors).map(([k, v]) => `${k}:${v}`).join(",") || "-"}`,
    );
  }
}

main().catch((err) => {
  console.error(`rpc-bench: ${err.message}`);
  process.exit(1);
});
