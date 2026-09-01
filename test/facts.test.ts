import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { BUNDLED_DB, line, load, pick, readDb, WIDTH } from "../src/index.ts";

const bundled = readDb(BUNDLED_DB);
const script = path.join(import.meta.dirname, "..", "scripts", "facts.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kv-facts-"));

test("the bundled database loads and fits the spinner", () => {
	assert.ok(bundled.length >= 80, `only ${bundled.length} facts`);
	const rotation = pick(bundled);
	assert.equal(rotation.length, bundled.length);
	for (const f of rotation) assert.ok([...line(f)].length <= WIDTH);
	assert.ok(new Set(bundled.map((f) => f.topic)).size > 5);
});

test("a missing or unsafe database returns nothing, never throws", () => {
	assert.deepEqual(readDb("/nope/none.db"), []);
	assert.deepEqual(readDb(BUNDLED_DB, "facts; DROP TABLE facts"), []);
});

test("a plain facts(prompt, answer) table works", () => {
	const dir = tmp();
	const file = path.join(dir, "facts.db");
	const db = new DatabaseSync(file);
	db.exec("CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT)");
	db.exec("INSERT INTO facts VALUES ('Page load budget', ' 200  ms ')");
	db.exec("INSERT INTO facts VALUES ('No answer', '')");
	db.close();
	assert.deepEqual(readDb(file), [{ prompt: "Page load budget", answer: "200 ms", topic: "other" }]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("pick dedupes by prompt, drops long lines, and shuffles by seed", () => {
	const dupes = [
		{ prompt: "System call", answer: "300 ns" },
		{ prompt: "system CALL", answer: "1 ns" },
	];
	assert.deepEqual(
		pick(dupes).map((f) => f.answer),
		["300 ns"],
	);
	assert.ok(pick(bundled, 20).every((f) => [...line(f)].length <= 20));
	assert.deepEqual(pick(bundled, WIDTH, 42), pick(bundled, WIDTH, 42));
	assert.notDeepEqual(pick(bundled, WIDTH, 42), pick(bundled, WIDTH, 43));
});

test("an earlier database wins, and topics filter", () => {
	const dir = tmp();
	const file = path.join(dir, "mine.db");
	const db = new DatabaseSync(file);
	db.exec("CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT, topic TEXT)");
	db.exec("INSERT INTO facts VALUES ('1 CPU per month', '$99', 'cost')");
	db.close();

	const facts = pick(load({ PI_KV_FACTS_DB: file, PI_KV_FACTS_TOPICS: "cost" } as NodeJS.ProcessEnv));
	assert.ok(facts.every((f) => f.topic === "cost"));
	assert.equal(facts.find((f) => f.prompt === "1 CPU per month")?.answer, "$99");

	const noBundled = load({ PI_KV_FACTS_DB: file, PI_KV_FACTS_BUNDLED: "off" } as NodeJS.ProcessEnv);
	assert.equal(
		noBundled.some((f) => f.prompt === "Internet egress, 1 GB"),
		false,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("the utility creates, adds, lists, and removes", () => {
	const dir = tmp();
	const file = path.join(dir, "new.db");
	const run = (...args: string[]) =>
		execFileSync("node", [script, ...args], { env: { ...process.env, FACTS_DB: file }, encoding: "utf8" });

	run("add", "Deploy to production", "6 min", "team");
	assert.deepEqual(readDb(file), [{ prompt: "Deploy to production", answer: "6 min", topic: "team" }]);
	assert.match(run("list", "deploy"), /1 of 1 facts/);
	assert.throws(() => run("add", "Deploy to production", "again", "team"), /UNIQUE|constraint/);
	assert.throws(() => run("rm", "Nothing here"), /no such prompt/);
	run("rm", "Deploy to production");
	assert.deepEqual(readDb(file), []);
	fs.rmSync(dir, { recursive: true, force: true });
});
