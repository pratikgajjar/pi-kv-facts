import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { BUNDLED_DB, line, open, WIDTH } from "../src/index.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kv-facts-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A temp database built from `CREATE`/`INSERT` statements. */
function make(name: string, ...sql: string[]): string {
	const file = path.join(dir, name);
	const db = new DatabaseSync(file);
	for (const s of sql) db.exec(s);
	db.close();
	return file;
}

/** `count` calls to next(), which is random. */
function draw(env: Record<string, string>, count = 60) {
	const facts = open(env as NodeJS.ProcessEnv);
	const out = Array.from({ length: count }, () => facts.next());
	facts.close();
	return { count: facts.count, out };
}

test("the bundled database serves facts that fit the spinner", () => {
	const { count, out } = draw({ PI_KV_FACTS_DB: BUNDLED_DB });
	assert.ok(count >= 80, `only ${count} facts`);
	assert.ok(out.every((f) => f && [...line(f)].length <= WIDTH));
	assert.ok(new Set(out.map((f) => f?.prompt)).size > 10, "next() repeats itself");
});

test("a missing or damaged database serves nothing, never throws", () => {
	for (const file of ["/nope/none.db", make("empty.db", "CREATE TABLE other (x TEXT)")]) {
		const { count, out } = draw({ PI_KV_FACTS_DB: file }, 3);
		assert.equal(count, 0);
		assert.deepEqual(out, [undefined, undefined, undefined]);
	}
});

test("blank and oversized rows never appear", () => {
	const file = make(
		"plain.db",
		"CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT)",
		`INSERT INTO facts VALUES ('Page load budget', '200 ms'), ('Blank', ''), ('Long', '${"x".repeat(WIDTH)}')`,
	);
	const { count, out } = draw({ PI_KV_FACTS_DB: file });
	assert.equal(count, 1);
	assert.ok(out.every((f) => f?.prompt === "Page load budget" && f.answer === "200 ms"));
});

test("width and topics narrow the selection", () => {
	const file = make(
		"topics.db",
		"CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT, topic TEXT)",
		"INSERT INTO facts VALUES ('1 CPU per month', '$15', 'cost'), ('System call', '300 ns', 'cpu')",
	);
	assert.ok(draw({ PI_KV_FACTS_DB: file, PI_KV_FACTS_TOPICS: "COST" }).out.every((f) => f?.answer === "$15"));
	assert.equal(draw({ PI_KV_FACTS_DB: file, PI_KV_FACTS_WIDTH: "20" }).count, 1);
	assert.equal(draw({ PI_KV_FACTS_DB: file, PI_KV_FACTS_TOPICS: "nothing" }).count, 0);
});

test("an insert with sqlite lands on the spinner", () => {
	const file = make("written.db", "CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT NOT NULL, topic TEXT)");
	const db = new DatabaseSync(file);
	db.exec("INSERT INTO facts VALUES ('Deploy to production', '6 min', 'team')");
	db.exec("INSERT OR REPLACE INTO facts VALUES ('Deploy to production', '4 min', 'team')");
	db.close();
	const { count, out } = draw({ PI_KV_FACTS_DB: file });
	assert.equal(count, 1, "the primary key keeps one row per prompt");
	assert.ok(out.every((f) => f?.answer === "4 min"));
});

test("the extension registers turn handlers and clears the line", async () => {
	const { default: install } = await import("../src/index.ts");
	const handlers: Record<string, (e: unknown, c: unknown) => Promise<void>> = {};
	const shown: (string | undefined)[] = [];
	const ctx = { ui: { setWorkingMessage: (m?: string) => shown.push(m) } };
	install({ on: (name: string, fn: never) => (handlers[name] = fn) } as never);

	await handlers.turn_start?.({}, ctx);
	await handlers.turn_end?.({}, ctx);
	assert.match(String(shown[0]), /·/);
	assert.equal(shown[1], undefined);
});
