# pi-kv-facts

A [pi](https://pi.dev) extension that shows one short fact per turn on the working spinner, while the agent thinks.

A fact is a `(prompt, answer)` pair. The bundled dataset is napkin math — latency, throughput, cloud cost, powers of two — but any facts work: your service SLOs, deploy times, Anki cards, API limits.

```
Random SSD read, 8 KiB · 100 µs, 70 MiB/s
Internet egress, 1 GB · $0.10
M/M/1 queue at 90% load · wait = 9x service time
```

## Install

```bash
pi install npm:pi-kv-facts
```

Nothing else is needed. The spinner starts showing numbers on the next turn.

## Your own facts

Write `~/.pi/kv-facts/facts.json`. Your facts win over a bundled fact with the same prompt.

```json
[
	{ "topic": "team", "prompt": "Deploy to production", "answer": "6 min" },
	{ "topic": "team", "prompt": "p99 checkout latency", "answer": "240 ms" }
]
```

`~/.pi/kv-facts/facts.db` works the same way. One table is enough:

```sql
CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT NOT NULL);
```

Facts longer than the spinner budget are skipped, so keep each line short.

## Settings

Environment variables, all optional.

| Variable | Effect |
|---|---|
| `PI_KV_FACTS_SPINNER=off` | keep pi's default spinner text |
| `PI_KV_FACTS_COLOR=off` | print in the theme color |
| `PI_KV_FACTS_WIDTH` | line budget in characters (default 56) |
| `PI_KV_FACTS_TOPICS` | keep some topics, for example `cost,network` |
| `PI_KV_FACTS_JSON` | more JSON files, `:` separated |
| `PI_KV_FACTS_DB` | more SQLite files, `:` separated |
| `PI_KV_FACTS_DATASET` | replace the bundled dataset file |
| `PI_KV_FACTS_BUNDLED=off` | use your facts only |

## Edit the data

`data/napkin-math.json` is the input of record. `data/napkin-math.db` is the same content as SQLite, in the schema above, for anything else that wants to read it.

```bash
node scripts/facts.mjs list ssd            # search
node scripts/facts.mjs add cost "1 TPU per month" "\$2000"
node scripts/facts.mjs rm "1 TPU per month"
npm run build                              # rebuild the .db
node scripts/facts.mjs check               # fail if the .db is stale
```

`add` and `rm` rebuild the `.db` for you. Set `FACTS_FILE` to edit a different dataset.

```bash
sqlite3 data/napkin-math.db "SELECT prompt, answer FROM facts WHERE topic = 'network'"
```

## The bundled numbers

| Topics | Facts | Origin |
|---|---|---|
| `cpu`, `disk`, `network`, `blob`, `cost`, `compression` | 68 | [sirupsen/napkin-math](https://github.com/sirupsen/napkin-math), re-measured 2026-03, and the classic Jeff Dean latency list |
| `powers`, `availability`, `rules` | 23 | arithmetic from those rows |

Numbers are rounded for memory, not for precision. Read the exponent, not the digits.

## Develop

```bash
npm install
npm run check   # typecheck, tests, and a stale-database check
```

## License

MIT
