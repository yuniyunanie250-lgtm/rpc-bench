# rpc-bench

Measure p50/p95 latency and error rates across JSON-RPC endpoints, so you pick a
provider with evidence instead of vibes.

## Why

Public RPC endpoints differ by an order of magnitude on tail latency, and the
median hides it. `p50` is the typical case; `p95` is what your users hit during
a mint, an airdrop claim, or any moment the network is busy.

## Usage

```bash
npx github:yuniyunanie250-lgtm/rpc-bench https://rpc.ankr.com/eth https://eth.llamarpc.com --samples 50
```

```
endpoint                  p50        p95        min        max  ok     errors
https://eth.llamarpc.com  118.4ms   261.0ms    102.3ms   261.0ms  true   -
https://rpc.ankr.com/eth  201.7ms   480.2ms    188.1ms   480.2ms  true   -
```

Endpoints are printed fastest-first by p50. `--json` gives the raw samples
summary for scripting.

As a library:

```js
import { bench, rankBy } from "rpc-bench";

const results = await Promise.all([
  bench("https://eth.llamarpc.com", { samples: 50, method: "eth_blockNumber" }),
  bench("https://rpc.ankr.com/eth", { samples: 50 }),
]);
console.log(rankBy(results));
```

## What it measures

- Wall-clock time per JSON-RPC call, including connection setup.
- Errors split by cause: `http_<status>`, `rpc_<code>` for JSON-RPC error
  objects, `timeout`, `network`, `malformed_json`. A provider that is fast when
  it works but drops 20% of calls shows that as an error count, not as good
  latency.
- Only successful calls contribute to percentiles.

## Development

```bash
npm test
```

Tests run against a stub JSON-RPC server on a random port -- no network needed.

## License

MIT
