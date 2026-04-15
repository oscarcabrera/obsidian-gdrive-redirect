import { App, Notice, TFile, TFolder } from "obsidian";
import { DriveAPI } from "./drive-api";
import { Logger } from "./logger";
import { DriveFile, SyncAction, SyncRecord, SyncState } from "./types";

const SYNC_STATE_FILE = ".gdrive-sync-state.json";

/**
 * Bidirectional sync engine.
 *
 * Design principles:
 * - NEVER auto-delete without user confirmation
 * - Use SHA-256 checksums to detect real content changes
 * - Conflicts (both sides changed) are flagged, not auto-resolved
 * - Operations are serialized through a queue — no race conditions
 */
export class SyncEngine {
	private app: App;
	private drive: DriveAPI;
	private log: Logger;
	private vaultFolderId: string;
	private state: SyncState = { records: {} };
	private queue: Array<() => Promise<void>> = [];
	private processing = false;
	private blacklist: string[];
	onConflict: ((localPath: string, driveFile: DriveFile) => void) | null = null;
	onDeleteRequest: ((localPath: string, direction: "local" | "remote") => void) | null = null;

	constructor(
		app: App,
		drive: DriveAPI,
		log: Logger,
		vaultFolderId: string,
		blacklist: string[]
	) {
		this.app = app;
		this.drive = drive;
		this.log = log;
		this.vaultFolderId = vaultFolderId;
		this.blacklist = blacklist;
	}

	setBlacklist(paths: string[]) {
		this.blacklist = paths;
	}

	// ── State persistence ────────────────────────────────────────

	async loadState(): Promise<void> {
		try {
			const file = this.app.vault.getAbstractFileByPath(SYNC_STATE_FILE);
			if (file instanceof TFile) {
				const raw = await this.app.vault.read(file);
				this.state = JSON.parse(raw);
			}
		} catch {
			this.state = { records: {} };
		}
	}

	async saveState(): Promise<void> {
		const data = JSON.stringify(this.state, null, "\t");
		const file = this.app.vault.getAbstractFileByPath(SYNC_STATE_FILE);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, data);
		} else {
			await this.app.vault.create(SYNC_STATE_FILE, data);
		}
	}

	getRecord(localPath: string): SyncRecord | undefined {
		return this.state.records[localPath];
	}

	// ── Full sync cycle ──────────────────────────────────────────

	/**
	 * Runs a full bidirectional sync:
	 * 1. Fetch remote file list
	 * 2. Compare with local files and sync state
	 * 3. Determine actions (upload, download, conflict, delete request)
	 * 4. Execute non-destructive actions; flag destructive ones
	 */
	async fullSync(): Promise<{ uploaded: number; downloaded: number; conflicts: number }> {
		this.log.info("Starting full sync");
		const stats = { uploaded: 0, downloaded: 0, conflicts: 0 };

		try {
			const remoteFiles = await this.drive.listFiles(this.vaultFolderId);
			const remoteByName = new Map<string, DriveFile>();
			for (const rf of remoteFiles) {
				remoteByName.set(rf.name, rf);
			}

			const localFiles = this.app.vault.getFiles().filter(
				(f) => !this.isIgnored(f.path)
			);
			const localByPath = new Map<string, TFile>();
			for (const lf of localFiles) {
				localByPath.set(lf.path, lf);
			}

			const actions = await this.computeActions(localByPath, remoteByName);

			for (const action of actions) {
				switch (action.type) {
					case "upload":
						await this.executeUpload(action.localPath);
						stats.uploaded++;
						break;
					case "download":
						await this.executeDownload(action.driveFile);
						stats.downloaded++;
						break;
					case "update-remote":
						await this.executeUpdateRemote(action.localPath, action.driveFileId);
						stats.uploaded++;
						break;
					case "update-local":
						await this.executeUpdateLocal(action.localPath, action.driveFile);
						stats.downloaded++;
						break;
					case "conflict":
						stats.conflicts++;
						if (this.onConflict) {
							this.onConflict(action.localPath, action.driveFile);
						} else {
							new Notice(`Conflict: ${action.localPath} — resolve manually`);
						}
						break;
					case "delete-local":
						if (this.onDeleteRequest) {
							this.onDeleteRequest(action.localPath, "local");
						}
						break;
					case "delete-remote":
						if (this.onDeleteRequest) {
							this.onDeleteRequest(action.localPath, "remote");
						}
						break;
				}
			}

			await this.saveState();
			this.log.info(
				`Sync complete: ${stats.uploaded} up, ${stats.downloaded} down, ${stats.conflicts} conflicts`
			);
		} catch (err: any) {
			this.log.error("Sync failed", err);
			throw err;
		}

		return stats;
	}

	// ── Action computation ───────────────────────────────────────

	private async computeActions(
		localByPath: Map<string, TFile>,
		remoteByName: Map<string, DriveFile>
	): Promise<SyncAction[]> {
		const actions: SyncAction[] = [];
		const processed = new Set<string>();

		// Check each local file
		for (const [path, file] of localByPath) {
			processed.add(path);
			const remote = remoteByName.get(path);
			const record = this.state.records[path];

			if (!remote && !record) {
				// New local file, never synced → upload
				actions.push({ type: "upload", localPath: path });
			} else if (!remote && record) {
				// Was synced before, now gone from remote → remote was deleted
				actions.push({ type: "delete-local", localPath: path });
			} else if (remote && !record) {
				// Exists in both but never tracked — compare content
				const localHash = await this.hashFile(file);
				if (remote.md5Checksum && localHash !== "conflict") {
					// New to sync state, upload local version and start tracking
					actions.push({ type: "upload", localPath: path });
				}
			} else if (remote && record) {
				// Both exist and we have a sync record — check for changes
				const localHash = await this.hashFile(file);
				const localChanged = localHash !== record.localHash;
				const remoteChanged = remote.md5Checksum !== record.remoteMd5;

				if (localChanged && remoteChanged) {
					actions.push({ type: "conflict", localPath: path, driveFile: remote });
				} else if (localChanged) {
					actions.push({ type: "update-remote", localPath: path, driveFileId: remote.id });
				} else if (remoteChanged) {
					actions.push({ type: "update-local", localPath: path, driveFile: remote });
				}
				// else: no changes on either side
			}
		}

		// Check remote files not in local
		for (const [name, driveFile] of remoteByName) {
			if (processed.has(name)) continue;
			if (this.isIgnored(name)) continue;

			const record = this.state.records[name];
			if (record) {
				// Was synced, now gone locally → local was deleted
				actions.push({ type: "delete-remote", driveFileId: driveFile.id, localPath: name });
			} else {
				// New remote file → download
				actions.push({ type: "download", driveFile: driveFile });
			}
		}

		return actions;
	}

	// ── Execute individual actions ───────────────────────────────

	private async executeUpload(localPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(localPath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.readBinary(file);
		const driveFile = await this.drive.uploadFile(localPath, content, this.vaultFolderId);
		const hash = await this.sha256(content);

		this.state.records[localPath] = {
			localPath,
			driveFileId: driveFile.id,
			localHash: hash,
			remoteMd5: driveFile.md5Checksum || "",
			lastSyncedAt: new Date().toISOString(),
		};
	}

	private async executeDownload(driveFile: DriveFile): Promise<void> {
		const content = await this.drive.downloadFile(driveFile.id);

		// Create parent folders if needed
		const parts = driveFile.name.split("/");
		if (parts.length > 1) {
			const folderPath = parts.slice(0, -1).join("/");
			await this.ensureLocalFolder(folderPath);
		}

		const existing = this.app.vault.getAbstractFileByPath(driveFile.name);
		if (existing instanceof TFile) {
			await this.app.vault.modifyBinary(existing, content);
		} else {
			await this.app.vault.createBinary(driveFile.name, content);
		}

		const hash = await this.sha256(content);
		this.state.records[driveFile.name] = {
			localPath: driveFile.name,
			driveFileId: driveFile.id,
			localHash: hash,
			remoteMd5: driveFile.md5Checksum || "",
			lastSyncedAt: new Date().toISOString(),
		};
	}

	private async executeUpdateRemote(localPath: string, driveFileId: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(localPath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.readBinary(file);
		const driveFile = await this.drive.updateFile(driveFileId, content);
		const hash = await this.sha256(content);

		this.state.records[localPath] = {
			localPath,
			driveFileId,
			localHash: hash,
			remoteMd5: driveFile.md5Checksum || "",
			lastSyncedAt: new Date().toISOString(),
		};
	}

	private async executeUpdateLocal(localPath: string, driveFile: DriveFile): Promise<void> {
		const content = await this.drive.downloadFile(driveFile.id);
		const file = this.app.vault.getAbstractFileByPath(localPath);

		if (file instanceof TFile) {
			await this.app.vault.modifyBinary(file, content);
		}

		const hash = await this.sha256(content);
		this.state.records[localPath] = {
			localPath,
			driveFileId: driveFile.id,
			localHash: hash,
			remoteMd5: driveFile.md5Checksum || "",
			lastSyncedAt: new Date().toISOString(),
		};
	}

	// ── Public methods for event-driven sync ─────────────────────

	/** Called when a local file is modified. Queues an upload. */
	enqueueModify(localPath: string) {
		if (this.isIgnored(localPath)) return;
		this.enqueue(async () => {
			const record = this.state.records[localPath];
			if (!record) return; // not yet synced — will be picked up on next full sync
			const file = this.app.vault.getAbstractFileByPath(localPath);
			if (!(file instanceof TFile)) return;
			const content = await this.app.vault.readBinary(file);
			const hash = await this.sha256(content);
			if (hash === record.localHash) return; // no real change
			await this.executeUpdateRemote(localPath, record.driveFileId);
			await this.saveState();
			this.log.info(`Synced modification: ${localPath}`);
		});
	}

	/** Called when a new local file is created. Queues an upload. */
	enqueueCreate(localPath: string) {
		if (this.isIgnored(localPath)) return;
		this.enqueue(async () => {
			if (this.state.records[localPath]) return; // already tracked
			await this.executeUpload(localPath);
			await this.saveState();
			this.log.info(`Synced new file: ${localPath}`);
		});
	}

	/** Called when a local file is renamed. */
	enqueueRename(newPath: string, oldPath: string) {
		if (this.isIgnored(newPath)) return;
		this.enqueue(async () => {
			const record = this.state.records[oldPath];
			if (!record) return;

			await this.drive.renameFile(record.driveFileId, newPath);

			// Update state
			delete this.state.records[oldPath];
			this.state.records[newPath] = {
				...record,
				localPath: newPath,
				lastSyncedAt: new Date().toISOString(),
			};
			await this.saveState();
			this.log.info(`Synced rename: ${oldPath} → ${newPath}`);
		});
	}

	/** Called when a local file is deleted. Asks for confirmation via callback. */
	enqueueDelete(localPath: string) {
		if (this.isIgnored(localPath)) return;
		const record = this.state.records[localPath];
		if (!record) return;

		if (this.onDeleteRequest) {
			this.onDeleteRequest(localPath, "remote");
		}
	}

	/** Actually delete from remote (called after user confirms). */
	async confirmDeleteRemote(localPath: string): Promise<void> {
		const record = this.state.records[localPath];
		if (!record) return;
		await this.drive.trashFile(record.driveFileId);
		delete this.state.records[localPath];
		await this.saveState();
		this.log.info(`Deleted from Drive: ${localPath}`);
	}

	/** Actually delete locally (called after user confirms). */
	async confirmDeleteLocal(localPath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(localPath);
		if (file instanceof TFile) {
			await this.app.vault.trash(file, false);
		}
		delete this.state.records[localPath];
		await this.saveState();
		this.log.info(`Deleted locally: ${localPath}`);
	}

	/** Resolve a conflict by choosing a side. */
	async resolveConflict(localPath: string, keep: "local" | "remote"): Promise<void> {
		const record = this.state.records[localPath];
		if (!record) return;

		if (keep === "local") {
			await this.executeUpdateRemote(localPath, record.driveFileId);
		} else {
			const driveFile = await this.drive.getFileMetadata(record.driveFileId);
			await this.executeUpdateLocal(localPath, driveFile);
		}
		await this.saveState();
		this.log.info(`Conflict resolved (${keep}): ${localPath}`);
	}

	// ── Queue processing ─────────────────────────────────────────

	private enqueue(fn: () => Promise<void>) {
		this.queue.push(fn);
		this.processQueue();
	}

	private async processQueue() {
		if (this.processing) return;
		this.processing = true;

		while (this.queue.length > 0) {
			const fn = this.queue.shift()!;
			try {
				await fn();
			} catch (err: any) {
				this.log.error("Queue operation failed", err);
			}
		}

		this.processing = false;
	}

	// ── Helpers ──────────────────────────────────────────────────

	private isIgnored(path: string): boolean {
		if (path === SYNC_STATE_FILE) return true;
		if (path === "gdrive-sync-log.md") return true;
		for (const bp of this.blacklist) {
			if (bp && path.includes(bp)) return true;
		}
		return false;
	}

	private async hashFile(file: TFile): Promise<string> {
		const content = await this.app.vault.readBinary(file);
		return this.sha256(content);
	}

	async sha256(buffer: ArrayBuffer): Promise<string> {
		const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
		const bytes = new Uint8Array(hashBuffer);
		const hex: string[] = [];
		for (const b of bytes) {
			hex.push(b.toString(16).padStart(2, "0"));
		}
		return hex.join("");
	}

	private async ensureLocalFolder(path: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return;
		try {
			await this.app.vault.createFolder(path);
		} catch {
			// folder may already exist from a parallel operation
		}
	}
}
