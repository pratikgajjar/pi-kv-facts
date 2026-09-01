# pi-kv-facts

A [pi](https://pi.dev) extension that shows one short fact per turn on the working spinner, while the agent thinks.

A fact is a `(prompt, answer)` pair in SQLite. The bundled database holds napkin math — latency, throughput, cloud cost, powers of two — but any facts work: your service SLOs, deploy times, Anki cards, API limits.

```
Random SSD read, 8 KiB · 100 µs, 70 MiB/s
Internet egress, 1 GB · $0.10
M/M/1 queue at 90% load · wait = 9x service time
```

## Install

```bash
pi install npm:pi-kv-facts
```

Nothing else is needed. Numbers appear on the next turn.

## Your own facts

Write `~/.pi/kv-facts/facts.db`. It is read before the bundled database, so your answer wins on a duplicate prompt.

```bash
FACTS_DB=~/.pi/kv-facts/facts.db node scripts/facts.mjs add "Deploy to production" "6 min" team
```

Any table of this shape works. `topic` and `source` are optional:

```sql
CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT NOT NULL, topic TEXT, source TEXT);
```

Lines longer than the spinner budget are skipped, so keep each answer short.

## Settings

Environment variables, all optional.

| Variable | Effect |
|---|---|
| `PI_KV_FACTS_SPINNER=off` | keep pi's default spinner text |
| `PI_KV_FACTS_COLOR=off` | print in the theme color |
| `PI_KV_FACTS_WIDTH` | line budget in characters (default 56) |
| `PI_KV_FACTS_TOPICS` | keep some topics, for example `cost,network` |
| `PI_KV_FACTS_DB` | more databases, `:` separated, read first |
| `PI_KV_FACTS_BUNDLED=off` | use your databases only |

## Edit the data

`data/facts.db` is the whole dataset. Read it with any SQLite client:

```bash
sqlite3 data/facts.db "SELECT prompt, answer FROM facts WHERE topic = 'network'"
```

Or use the script, which creates the database if it is missing:

```bash
node scripts/facts.mjs list ssd
node scripts/facts.mjs add "1 TPU per month" "\$2000" cost
node scripts/facts.mjs rm "1 TPU per month"
```

## The bundled numbers

91 facts in 9 topics.

| Topics | Facts | Origin |
|---|---|---|
| `cpu`, `disk`, `network`, `blob`, `cost`, `compression` | 68 | [sirupsen/napkin-math](https://github.com/sirupsen/napkin-math), re-measured 2026-03, and the classic Jeff Dean latency list |
| `powers`, `availability`, `rules` | 23 | arithmetic from those rows |

Numbers are rounded for memory, not for precision. Read the exponent, not the digits.

## Develop

```bash
npm install
npm run check   # typecheck and tests
```

## License

MIT
