import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clean, DEFAULT_DATASET, line, load, pick, readDb, readJson, WIDTH } from "../src/index.ts";

const dataset = JSON.parse(fs.readFileSync(DEFAULT_DATASET, "utf8"));
const bundled = readJson(DEFAULT_DATASET);
const dbFile = DEFAULT_DATASET.replace(/\.json$/, ".db");
const script = path.join(import.meta.dirname, "..", "scripts", "facts.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kv-facts-"));

test("the bundled dataset loads and fits the spinner", () => {
	assert.ok(bundled.length >= 80, `only ${bundled.length} facts`);
	const rotation = pick(bundled);
	assert.ok(rotation.length >= bundled.length * 0.9, `only ${rotation.length} fit`);
	for (const f of rotation) assert.ok([...line(f)].length <= WIDTH);
});

test("bad input is dropped, never thrown", () => {
	assert.deepEqual(clean([{ prompt: "no answer" }, { answer: "no prompt" }, 7, null]), []);
	assert.deepEqual(readJson("/nope/none.json"), []);
	assert.deepEqual(readDb("/nope/none.db"), []);
	assert.deepEqual(readDb(dbFile, "facts; DROP TABLE facts"), []);
});

test("json facts load as an array or a facts object", () => {
	const dir = tmp();
	fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify([{ topic: "team", prompt: "Deploy", answer: " 6  min " }]));
	fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify({ facts: [{ prompt: "Build", answer: "90 s" }] }));
	assert.deepEqual(readJson(path.join(dir, "a.json")), [{ topic: "team", prompt: "Deploy", answer: "6 min" }]);
	assert.equal(readJson(path.join(dir, "b.json"))[0]?.topic, "other");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("sqlite facts load from a plain facts(prompt, answer) table", async () => {
	const { DatabaseSync } = await import("node:sqlite");
	const dir = tmp();
	const file = path.join(dir, "facts.db");
	const db = new DatabaseSync(file);
	db.exec("CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT)");
	db.exec("INSERT INTO facts VALUES ('Page load budget', '200 ms')");
	db.close();
	assert.deepEqual(readDb(file), [{ topic: "other", prompt: "Page load budget", answer: "200 ms" }]);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("the shipped .db matches the .json", () => {
	const facts = readDb(dbFile);
	assert.equal(facts.length, bundled.length);
	const answers = new Map(facts.map((f) => [f.prompt, f.answer]));
	for (const f of bundled) assert.equal(answers.get(f.prompt), f.answer);
});

test("pick dedupes by prompt and shuffles by seed", () => {
	const dupes = [
		{ prompt: "System call", answer: "300 ns" },
		{ prompt: "system CALL", answer: "1 ns" },
	];
	assert.deepEqual(pick(dupes).map((f) => f.answer), ["300 ns"]);
	assert.deepEqual(pick(bundled, WIDTH, 42), pick(bundled, WIDTH, 42));
	assert.notDeepEqual(pick(bundled, WIDTH, 42), pick(bundled, WIDTH, 43));
	assert.equal(pick(bundled, 20).every((f) => [...line(f)].length <= 20), true);
});

test("user facts win over the bundled dataset, and topics filter", () => {
	const dir = tmp();
	const file = path.join(dir, "mine.json");
	fs.writeFileSync(file, JSON.stringify([{ topic: "cost", prompt: "1 CPU per month", answer: "$99" }]));
	const facts = pick(load({ PI_KV_FACTS_JSON: file, PI_KV_FACTS_TOPICS: "cost" } as NodeJS.ProcessEnv));
	assert.ok(facts.every((f) => f.topic === "cost"));
	assert.equal(facts.find((f) => f.prompt === "1 CPU per month")?.answer, "$99");
	const withoutBundled = load({ PI_KV_FACTS_BUNDLED: "off" } as NodeJS.ProcessEnv);
	assert.equal(withoutBundled.some((f) => f.prompt === "1 CPU per month"), false);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("the utility adds, lists, removes, and rebuilds", () => {
	const dir = tmp();
	const file = path.join(dir, "set.json");
	fs.writeFileSync(file, JSON.stringify({ sources: {}, facts: [{ topic: "team", prompt: "Build", answer: "90 s" }] }));
	const run = (...args: string[]) => execFileSync("node", [script, ...args], { env: { ...process.env, FACTS_FILE: file }, encoding: "utf8" });

	run("add", "team", "Deploy", "6 min");
	assert.equal(readJson(file).length, 2);
	assert.equal(readDb(file.replace(/\.json$/, ".db")).length, 2);
	assert.match(run("list", "deploy"), /1\/2 facts/);
	assert.throws(() => run("add", "team", "deploy", "again"), /duplicate/);
	run("rm", "Deploy");
	assert.equal(readJson(file).length, 1);
	run("check");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("the shipped .db is not stale", () => {
	execFileSync("node", [script, "check"], { encoding: "utf8" });
	assert.ok(Object.keys(dataset.sources).length > 0);
});
