#!/usr/bin/env node
// Edit a facts dataset and build its SQLite twin.
//
//   node scripts/facts.mjs list [term]
//   node scripts/facts.mjs add <topic> "<prompt>" "<answer>" [source]
//   node scripts/facts.mjs rm "<prompt>"
//   node scripts/facts.mjs build            # write the .db next to the .json
//   node scripts/facts.mjs check            # exit 1 if the .db is stale
//
// Set FACTS_FILE to work on another dataset. The .db keeps the schema
// facts(prompt PRIMARY KEY, answer, topic, source), which is what the
// extension and ~/.pi/kv-facts/facts.db read.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.env.FACTS_FILE ?? path.join(root, "data", "napkin-math.json");
const dbFile = file.replace(/\.json$/, ".db");
const [cmd = "list", ...args] = process.argv.slice(2);

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const save = () => fs.writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`);

const build = (target) => {
	fs.rmSync(target, { force: true });
	const db = new DatabaseSync(target);
	db.exec("CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT NOT NULL, topic TEXT, source TEXT)");
	const insert = db.prepare("INSERT INTO facts VALUES (?, ?, ?, ?)");
	db.exec("BEGIN");
	for (const f of data.facts) insert.run(f.prompt, f.answer, f.topic ?? "other", data.sources?.[f.source] ?? f.source ?? null);
	db.exec("COMMIT");
	db.exec("VACUUM");
	db.close();
};

if (cmd === "list") {
	const term = args.join(" ").toLowerCase();
	const hits = data.facts.filter((f) => `${f.topic} ${f.prompt} ${f.answer}`.toLowerCase().includes(term));
	for (const f of hits) console.log(`${f.topic}\t${f.prompt} · ${f.answer}`);
	console.log(`${hits.length}/${data.facts.length} facts`);
} else if (cmd === "add") {
	const [topic, prompt, answer, source] = args;
	if (!topic || !prompt || !answer) throw new Error('usage: add <topic> "<prompt>" "<answer>" [source]');
	if (data.facts.some((f) => f.prompt.toLowerCase() === prompt.toLowerCase())) throw new Error(`duplicate: ${prompt}`);
	data.facts.push({ topic, prompt, answer, ...(source ? { source } : {}) });
	save();
	build(dbFile);
	console.log(`Added: ${prompt} · ${answer}`);
} else if (cmd === "rm") {
	const before = data.facts.length;
	data.facts = data.facts.filter((f) => f.prompt.toLowerCase() !== (args[0] ?? "").toLowerCase());
	if (data.facts.length === before) throw new Error(`no such prompt: ${args[0]}`);
	save();
	build(dbFile);
	console.log(`Removed: ${args[0]}`);
} else if (cmd === "build") {
	build(dbFile);
	console.log(`Wrote ${path.relative(root, dbFile)} — ${data.facts.length} facts.`);
} else if (cmd === "check") {
	const tmp = `${dbFile}.check`;
	build(tmp);
	const stale = !fs.readFileSync(tmp).equals(fs.existsSync(dbFile) ? fs.readFileSync(dbFile) : Buffer.alloc(0));
	fs.rmSync(tmp, { force: true });
	if (stale) throw new Error(`${path.relative(root, dbFile)} is stale. Run: npm run build`);
	console.log(`${path.relative(root, dbFile)} is current (${data.facts.length} facts).`);
} else {
	throw new Error(`unknown command: ${cmd}`);
}
