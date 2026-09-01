// pi-kv-facts — one short (prompt, answer) fact per turn on the pi working
// spinner. Databases, in priority order: PI_KV_FACTS_DB, ~/.pi/kv-facts/facts.db,
// then the bundled data/facts.db. The first database to define a prompt wins.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Fact {
	prompt: string;
	answer: string;
	topic?: string;
}

export const BUNDLED_DB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "facts.db");
export const USER_DB = path.join(os.homedir(), ".pi", "kv-facts", "facts.db");
export const WIDTH = 56;
export const line = (f: Fact) => `${f.prompt} · ${f.answer}`;
const key = (f: Fact) => f.prompt.toLowerCase();

/** Facts from a SQLite table `facts(prompt, answer[, topic])`. Never throws. */
export function readDb(file: string, table = "facts"): Fact[] {
	const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
	try {
		if (!/^[A-Za-z_]\w*$/.test(table)) throw new Error(`unsafe table: ${table}`);
		const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
		const db = new DatabaseSync(file, { readOnly: true });
		const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
		db.close();
		return rows
			.map((r) => ({ prompt: str(r.prompt), answer: str(r.answer), topic: str(r.topic) || "other" }))
			.filter((f) => f.prompt && f.answer);
	} catch {
		return [];
	}
}

/** Dedupe by prompt, keep the lines that fit, and shuffle with a seed. */
export function pick(facts: Fact[], width = WIDTH, seed = 1): Fact[] {
	const uniq = new Map<string, Fact>();
	for (const f of facts) if (!uniq.has(key(f)) && [...line(f)].length <= width) uniq.set(key(f), f);
	const out = [...uniq.values()];
	let state = seed >>> 0 || 1;
	for (let i = out.length - 1; i > 0; i--) {
		state = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
		const j = state % (i + 1);
		[out[i], out[j]] = [out[j] as Fact, out[i] as Fact];
	}
	return out;
}

/** Every configured database, then the topic filter. */
export function load(env: NodeJS.ProcessEnv = process.env): Fact[] {
	const extra = env.PI_KV_FACTS_DB?.split(":").filter(Boolean) ?? [];
	const facts = [...extra, USER_DB, ...(env.PI_KV_FACTS_BUNDLED === "off" ? [] : [BUNDLED_DB])].flatMap((f) => readDb(f));
	const topics = (env.PI_KV_FACTS_TOPICS ?? "").toLowerCase().split(/[,\s]+/).filter(Boolean);
	return topics.length ? facts.filter((f) => topics.includes(f.topic ?? "")) : facts;
}

// The loader prints through theme.fg("muted", …); a leading SGR escape wins,
// because terminals honor the last one set.
const COLORS = ["198;255;0", "217;119;87", "99;91;255", "29;155;240", "225;48;108", "229;9;20", "251;188;5", "29;185;84"];

export default function (pi: ExtensionAPI) {
	const env = process.env;
	if (env.PI_KV_FACTS_SPINNER === "off") return;
	const facts = pick(load(env), Number.parseInt(env.PI_KV_FACTS_WIDTH ?? "", 10) || WIDTH, Date.now());
	let cursor = 0;
	if (!facts.length) return;

	pi.on("turn_start", async (_event, ctx) => {
		const i = cursor++;
		const text = line(facts[i % facts.length] as Fact);
		ctx.ui.setWorkingMessage(env.PI_KV_FACTS_COLOR === "off" ? text : `\x1b[38;2;${COLORS[i % COLORS.length]}m${text}\x1b[0m`);
	});
	pi.on("turn_end", async (_event, ctx) => ctx.ui.setWorkingMessage());
}
