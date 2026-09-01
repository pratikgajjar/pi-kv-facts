// pi-kv-facts — show one short (prompt, answer) fact per turn on the pi
// working spinner. The bundled dataset is napkin math; any facts work.
//
// Sources, in priority order: PI_KV_FACTS_JSON, PI_KV_FACTS_DB,
// ~/.pi/kv-facts/facts.{json,db}, then data/napkin-math.json.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Fact {
	topic?: string;
	prompt: string;
	answer: string;
	source?: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATASET = path.join(HERE, "..", "data", "napkin-math.json");
export const USER_DIR = path.join(os.homedir(), ".pi", "kv-facts");
export const WIDTH = 56;

/** Keep well-formed facts only. Anything else is dropped, never thrown. */
export function clean(input: unknown): Fact[] {
	const str = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
	return (Array.isArray(input) ? input : []).flatMap((f: Fact) => {
		const [prompt, answer] = [str(f?.prompt), str(f?.answer)];
		return prompt && answer ? [{ topic: str(f?.topic) || "other", prompt, answer }] : [];
	});
}

/** Facts from a JSON file: a bare array or `{ facts: [...] }`. */
export function readJson(file: string): Fact[] {
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8"));
		return clean(Array.isArray(raw) ? raw : raw?.facts);
	} catch {
		return [];
	}
}

/** Facts from a SQLite table `facts(prompt, answer)`. */
export function readDb(file: string, table = "facts"): Fact[] {
	if (!/^[A-Za-z_]\w*$/.test(table)) return [];
	try {
		const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
		const db = new DatabaseSync(file, { readOnly: true });
		// SELECT * so both facts(prompt, answer) and a table with topic work.
		const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
		db.close();
		return clean(rows);
	} catch {
		return [];
	}
}

export const line = (f: Fact) => `${f.prompt} · ${f.answer}`;

/** Dedupe by prompt, keep the lines that fit, and shuffle with a seed. */
export function pick(facts: Fact[], width = WIDTH, seed = 1): Fact[] {
	const seen = new Set<string>();
	const out = facts.filter((f) => {
		const key = f.prompt.toLowerCase();
		if (seen.has(key) || [...line(f)].length > width) return false;
		seen.add(key);
		return true;
	});
	let state = seed >>> 0 || 1;
	for (let i = out.length - 1; i > 0; i--) {
		state = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
		const j = state % (i + 1);
		[out[i], out[j]] = [out[j] as Fact, out[i] as Fact];
	}
	return out;
}

/** Every configured source, user facts first, filtered by topic. */
export function load(env: NodeJS.ProcessEnv = process.env): Fact[] {
	const files = (v: string | undefined, fallback: string) => [...(v?.split(":").filter(Boolean) ?? []), fallback];
	const facts = [
		...files(env.PI_KV_FACTS_JSON, path.join(USER_DIR, "facts.json")).flatMap(readJson),
		...files(env.PI_KV_FACTS_DB, path.join(USER_DIR, "facts.db")).flatMap((f) => readDb(f)),
		...(env.PI_KV_FACTS_BUNDLED === "off" ? [] : readJson(env.PI_KV_FACTS_DATASET || DEFAULT_DATASET)),
	];
	const topics = (env.PI_KV_FACTS_TOPICS ?? "").split(/[,\s]+/).filter(Boolean).map((t) => t.toLowerCase());
	return topics.length ? facts.filter((f) => topics.includes((f.topic ?? "").toLowerCase())) : facts;
}

// The loader prints the message through theme.fg("muted", …). A leading SGR
// escape wins, because terminals honor the last one set.
const COLORS = ["#c6ff00", "#d97757", "#635bff", "#1d9bf0", "#e1306c", "#e50914", "#fbbc05", "#1db954"].map(
	(hex) => `\x1b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`,
);

export default function (pi: ExtensionAPI) {
	const env = process.env;
	if (env.PI_KV_FACTS_SPINNER === "off") return;
	const width = Number.parseInt(env.PI_KV_FACTS_WIDTH ?? "", 10) || WIDTH;
	const facts = pick(load(env), width, Date.now());
	if (!facts.length) return;
	let cursor = 0;

	pi.on("turn_start", async (_event, ctx) => {
		const i = cursor++;
		const text = line(facts[i % facts.length] as Fact);
		ctx.ui.setWorkingMessage(env.PI_KV_FACTS_COLOR === "off" ? text : `${COLORS[i % COLORS.length]}${text}\x1b[0m`);
	});

	pi.on("turn_end", async (_event, ctx) => ctx.ui.setWorkingMessage());
}
