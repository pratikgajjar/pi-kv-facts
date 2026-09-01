import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { BUNDLED_DB, line, load, pick, readDb, WIDTH } from "../src/index.ts";

const bundled = readDb(BUNDLED_DB);
const script = path.join(import.meta.dirname, "..", "scripts", "facts.mjs");
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

test("the bundled database loads and every line fits the spinner", () => {
	assert.ok(bundled.length >= 80, `only ${bundled.length} facts`);
	assert.equal(pick(bundled).length, bundled.length);
	assert.ok(bundled.every((f) => [...line(f)].length <= WIDTH));
	assert.ok(new Set(bundled.map((f) => f.topic)).size > 5);
});

test("a missing or unsafe database returns nothing, never throws", () => {
	assert.deepEqual(readDb("/nope/none.db"), []);
	assert.deepEqual(readDb(BUNDLED_DB, "facts; DROP TABLE facts"), []);
});

test("a plain facts(prompt, answer) table works, blank answers drop out", () => {
	const file = make(
		"plain.db",
		"CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT)",
		"INSERT INTO facts VALUES ('Page load budget', ' 200  ms '), ('No answer', '')",
	);
	assert.deepEqual(readDb(file), [{ prompt: "Page load budget", answer: "200 ms", topic: "other" }]);
});

test("pick dedupes by prompt, drops long lines, and shuffles by seed", () => {
	const dupes = [
		{ prompt: "System call", answer: "300 ns" },
		{ prompt: "system CALL", answer: "1 ns" },
	];
	assert.deepEqual(pick(dupes), [dupes[0]]);
	assert.ok(pick(bundled, 20).every((f) => [...line(f)].length <= 20));
	assert.deepEqual(pick(bundled, WIDTH, 42), pick(bundled, WIDTH, 42));
	assert.notDeepEqual(pick(bundled, WIDTH, 42), pick(bundled, WIDTH, 43));
});

test("an earlier database wins, topics filter, bundled facts can be dropped", () => {
	const file = make(
		"mine.db",
		"CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT, topic TEXT)",
		"INSERT INTO facts VALUES ('1 CPU per month', '$99', 'cost')",
	);
	const facts = pick(load({ PI_KV_FACTS_DB: file, PI_KV_FACTS_TOPICS: "cost" } as NodeJS.ProcessEnv));
	assert.ok(facts.every((f) => f.topic === "cost"));
	assert.equal(facts.find((f) => f.prompt === "1 CPU per month")?.answer, "$99");
	const own = load({ PI_KV_FACTS_DB: file, PI_KV_FACTS_BUNDLED: "off" } as NodeJS.ProcessEnv);
	assert.ok(own.some((f) => f.prompt === "1 CPU per month"));
	assert.ok(!own.some((f) => f.prompt === "Internet egress, 1 GB"));
});

test("the utility creates, adds, lists, and removes", () => {
	const file = path.join(dir, "new.db");
	const run = (...args: string[]) =>
		execFileSync("node", [script, ...args], { env: { ...process.env, FACTS_DB: file }, encoding: "utf8" });

	run("add", "Deploy to production", "6 min", "team");
	assert.deepEqual(readDb(file), [{ prompt: "Deploy to production", answer: "6 min", topic: "team" }]);
	assert.match(run("list", "deploy"), /1 of 1 facts/);
	assert.throws(() => run("add", "Deploy to production", "again"), /UNIQUE|constraint/);
	assert.throws(() => run("add", "No answer"), /usage: add/);
	assert.throws(() => run("rm", "Nothing here"), /no such prompt/);
	run("rm", "Deploy to production");
	assert.deepEqual(readDb(file), []);
});
