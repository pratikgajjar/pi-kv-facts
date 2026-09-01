#!/usr/bin/env node
// Edit a facts database. Works on data/facts.db; set FACTS_DB for another one.
//   list [term] | add "<prompt>" "<answer>" [topic] [source] | rm "<prompt>"

import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const file = process.env.FACTS_DB ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "facts.db");
const [cmd = "list", ...args] = process.argv.slice(2);
const db = new DatabaseSync(file);
db.exec("CREATE TABLE IF NOT EXISTS facts (prompt TEXT PRIMARY KEY, answer TEXT NOT NULL, topic TEXT, source TEXT)");

const commands = {
	list: (terms) => {
		const term = `%${terms.join(" ")}%`;
		const sql = "SELECT prompt, answer, topic FROM facts WHERE prompt LIKE ?1 OR answer LIKE ?1 OR topic LIKE ?1 ORDER BY topic, prompt";
		const rows = db.prepare(sql).all(term);
		for (const r of rows) console.log(`${r.topic}\t${r.prompt} · ${r.answer}`);
		return `${rows.length} of ${db.prepare("SELECT count(*) n FROM facts").get().n} facts`;
	},
	add: ([prompt, answer, topic = "other", source = null]) => {
		if (!prompt || !answer) throw new Error('usage: add "<prompt>" "<answer>" [topic] [source]');
		db.prepare("INSERT INTO facts VALUES (?, ?, ?, ?)").run(prompt, answer, topic, source);
		return `Added: ${prompt} · ${answer}`;
	},
	rm: ([prompt = ""]) => {
		if (!db.prepare("DELETE FROM facts WHERE prompt = ?").run(prompt).changes) throw new Error(`no such prompt: ${prompt}`);
		db.exec("VACUUM");
		return `Removed: ${prompt}`;
	},
};

if (!commands[cmd]) throw new Error(`unknown command: ${cmd}`);
console.log(commands[cmd](args));
db.close();
