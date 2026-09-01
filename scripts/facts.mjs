#!/usr/bin/env node
// Edit a facts database.
//
//   node scripts/facts.mjs list [term]
//   node scripts/facts.mjs add "<prompt>" "<answer>" [topic] [source]
//   node scripts/facts.mjs rm "<prompt>"
//
// Works on data/facts.db. Set FACTS_DB to edit another one, for example
// FACTS_DB=~/.pi/kv-facts/facts.db.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.env.FACTS_DB ?? path.join(root, "data", "facts.db");
const [cmd = "list", ...args] = process.argv.slice(2);

const fresh = !fs.existsSync(file);
const db = new DatabaseSync(file);
if (fresh) db.exec("CREATE TABLE facts (prompt TEXT PRIMARY KEY, answer TEXT NOT NULL, topic TEXT, source TEXT)");

if (cmd === "list") {
	const term = `%${args.join(" ")}%`;
	const rows = db
		.prepare("SELECT prompt, answer, topic FROM facts WHERE prompt LIKE ? OR answer LIKE ? OR topic LIKE ? ORDER BY topic, prompt")
		.all(term, term, term);
	for (const r of rows) console.log(`${r.topic}\t${r.prompt} · ${r.answer}`);
	console.log(`${rows.length} of ${db.prepare("SELECT count(*) n FROM facts").get().n} facts`);
} else if (cmd === "add") {
	const [prompt, answer, topic = "other", source = null] = args;
	if (!prompt || !answer) throw new Error('usage: add "<prompt>" "<answer>" [topic] [source]');
	db.prepare("INSERT INTO facts VALUES (?, ?, ?, ?)").run(prompt, answer, topic, source);
	console.log(`Added: ${prompt} · ${answer}`);
} else if (cmd === "rm") {
	const { changes } = db.prepare("DELETE FROM facts WHERE prompt = ?").run(args[0] ?? "");
	if (!changes) throw new Error(`no such prompt: ${args[0]}`);
	db.exec("VACUUM");
	console.log(`Removed: ${args[0]}`);
} else {
	throw new Error(`unknown command: ${cmd}`);
}
db.close();
