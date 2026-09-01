// pi-kv-facts — one short (prompt, answer) fact per turn on the pi working
// spinner. One database: PI_KV_FACTS_DB, else ~/.pi/kv-facts/facts.db when it
// exists, else the bundled data/facts.db. The prompt primary key keeps facts
// unique, so nothing here dedupes.
//
// Nothing is held in memory either. Each turn runs one query for one row, at a
// random offset. Rowids are not usable for the random pick: deletes leave gaps,
// and one row after a wide gap would then win almost every turn.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export interface Fact {
	prompt: string;
	answer: string;
}

export const BUNDLED_DB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "facts.db");
export const USER_DB = path.join(os.homedir(), ".pi", "kv-facts", "facts.db");
export const WIDTH = 56;
export const line = (f: Fact) => `${f.prompt} · ${f.answer}`;
const rand = (n: number) => Math.floor(Math.random() * n);

/** Open the facts database. `next()` returns one random fact that fits. */
export function open(env: NodeJS.ProcessEnv = process.env) {
	const topics = (env.PI_KV_FACTS_TOPICS ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean);
	const fits = `length(prompt) > 0 AND length(answer) > 0 AND length(prompt) + length(answer) + 3 <= ?${
		topics.length ? ` AND lower(coalesce(topic, 'other')) IN (${topics.map(() => "?").join(", ")})` : ""
	}`;
	const args = [Number.parseInt(env.PI_KV_FACTS_WIDTH ?? "", 10) || WIDTH, ...topics];
	try {
		const db = new DatabaseSync(env.PI_KV_FACTS_DB || (fs.existsSync(USER_DB) ? USER_DB : BUNDLED_DB), { readOnly: true });
		const { n } = db.prepare(`SELECT count(*) n FROM facts WHERE ${fits}`).get(...args) as { n: number };
		const query = db.prepare(`SELECT prompt, answer FROM facts WHERE ${fits} LIMIT 1 OFFSET ?`);
		const next = () => (query.get(...args, rand(n)) ?? query.get(...args, 0)) as Fact | undefined;
		return { count: n, close: () => db.close(), next };
	} catch {
		return { count: 0, close: () => {}, next: (): Fact | undefined => undefined };
	}
}

// The loader prints through theme.fg("muted", …); a leading SGR escape wins,
// because terminals honor the last one set.
const COLORS = ["198;255;0", "217;119;87", "99;91;255", "29;155;240", "225;48;108", "229;9;20", "251;188;5", "29;185;84"];

export default function (pi: ExtensionAPI) {
	if (process.env.PI_KV_FACTS_SPINNER === "off") return;
	const facts = open();
	if (!facts.count) return facts.close();
	let cursor = 0;

	pi.on("turn_start", async (_event, ctx) => {
		const fact = facts.next();
		if (!fact) return;
		const text = line(fact).replace(/\s+/g, " ");
		const color = COLORS[cursor++ % COLORS.length];
		ctx.ui.setWorkingMessage(process.env.PI_KV_FACTS_COLOR === "off" ? text : `\x1b[38;2;${color}m${text}\x1b[0m`);
	});
	pi.on("turn_end", async (_event, ctx) => ctx.ui.setWorkingMessage());
}
