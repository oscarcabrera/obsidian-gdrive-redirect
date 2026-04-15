import { App, TFile } from "obsidian";

const LOG_FILE = "gdrive-sync-log.md";

/** Patterns that look like tokens/secrets — replaced before writing to file */
const SENSITIVE_PATTERNS = [
	/ya29\.[A-Za-z0-9_-]+/g,          // Google access tokens
	/1\/\/[A-Za-z0-9_-]{20,}/g,       // Google refresh tokens
	/"access_token"\s*:\s*"[^"]+"/g,
	/"refresh_token"\s*:\s*"[^"]+"/g,
	/Bearer [A-Za-z0-9._-]+/g,
];

function sanitize(msg: string): string {
	let clean = msg;
	for (const pattern of SENSITIVE_PATTERNS) {
		clean = clean.replace(pattern, "[REDACTED]");
	}
	return clean;
}

export class Logger {
	private app: App;
	private fileLogging: boolean;
	private buffer: string[] = [];
	private writing = false;

	constructor(app: App, fileLogging: boolean) {
		this.app = app;
		this.fileLogging = fileLogging;
	}

	setFileLogging(enabled: boolean) {
		this.fileLogging = enabled;
	}

	info(msg: string) {
		console.log(`[gdrive-sync] ${msg}`);
		if (this.fileLogging) this.appendToFile("INFO", msg);
	}

	warn(msg: string) {
		console.warn(`[gdrive-sync] ${msg}`);
		if (this.fileLogging) this.appendToFile("WARN", msg);
	}

	error(msg: string, err?: Error) {
		const full = err ? `${msg}: ${err.message}` : msg;
		console.error(`[gdrive-sync] ${full}`);
		if (this.fileLogging) this.appendToFile("ERROR", full);
	}

	private appendToFile(level: string, msg: string) {
		const ts = new Date().toISOString();
		const line = `${ts} [${level}] ${sanitize(msg)}`;
		this.buffer.push(line);
		this.flush();
	}

	private async flush() {
		if (this.writing || !this.buffer.length) return;
		this.writing = true;
		try {
			const lines = this.buffer.splice(0, this.buffer.length);
			const entry = lines.join("\n") + "\n";
			const existing = this.app.vault.getAbstractFileByPath(LOG_FILE);
			if (existing instanceof TFile) {
				const content = await this.app.vault.read(existing);
				await this.app.vault.modify(existing, content + entry);
			} else {
				await this.app.vault.create(LOG_FILE, entry);
			}
		} catch {
			// silently fail — logging must never break the plugin
		}
		this.writing = false;
		if (this.buffer.length) this.flush();
	}
}
