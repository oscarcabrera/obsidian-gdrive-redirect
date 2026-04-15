import {
	App,
	Modal,
	Notice,
	Plugin,
	setIcon,
	Setting,
	TFile,
} from "obsidian";
import { GoogleAuth } from "./auth";
import { DriveAPI } from "./drive-api";
import { Logger } from "./logger";
import { GDriveSyncSettingTab } from "./settings";
import { SyncEngine } from "./sync-engine";
import { DEFAULT_SETTINGS, DriveFile, PluginSettings } from "./types";

export default class GDriveSyncPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;
	logger: Logger = null!;
	auth: GoogleAuth = null!;
	private drive: DriveAPI | null = null;
	private sync: SyncEngine | null = null;
	private syncTimer: number | null = null;
	private modifyDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private statusBarEl: HTMLElement = null!;
	private ignoreEvents = false;

	async onload() {
		await this.loadSettings();

		this.logger = new Logger(this.app, this.settings.enableFileLogging);
		this.auth = new GoogleAuth(this.logger);

		this.statusBarEl = this.addStatusBarItem().createEl("span", {
			cls: "gdrive-sync-status",
		});
		this.setStatusIcon("checkmark");

		this.addSettingTab(new GDriveSyncSettingTab(this.app, this));

		// Register obsidian:// protocol handler for mobile OAuth callback
		this.registerObsidianProtocolHandler("gdrive-sync-auth", async (params) => {
			const code = params.code;
			const error = params.error;

			if (error) {
				new Notice(`Google auth failed: ${error}`);
				this.logger.error(`Mobile auth callback error: ${error}`);
				return;
			}

			if (!code) {
				new Notice("Auth callback missing authorization code.");
				return;
			}

			if (!this.auth.hasPendingMobileAuth()) {
				new Notice("No pending login. Please start login from settings.");
				return;
			}

			try {
				const tokens = await this.auth.completeMobileAuth(
					this.settings.clientId,
					this.settings.clientSecret,
					code
				);
				this.settings.refreshToken = tokens.refresh_token || "";
				this.settings.accessToken = tokens.access_token;
				this.settings.tokenExpiry = Date.now() + tokens.expires_in * 1000;
				await this.saveSettings();
				new Notice("Logged in successfully!");
				this.logger.info("Mobile OAuth login complete");
			} catch (err: any) {
				this.logger.error("Mobile auth completion failed", err);
				new Notice(`Login failed: ${err.message}`);
			}
		});

		// Wait for workspace to be ready before starting sync
		this.app.workspace.onLayoutReady(() => this.onLayoutReady());
	}

	private async onLayoutReady() {
		if (!this.settings.refreshToken || !this.settings.vaultFolderId) {
			this.logger.info("Not configured yet — skipping auto-sync");
			return;
		}

		try {
			await this.initDriveAndSync();
			this.registerVaultEvents();
			this.startSyncTimer();
			this.registerCommands();
			this.registerRibbonIcons();
			this.logger.info("Plugin initialized, sync active");
		} catch (err: any) {
			this.logger.error("Failed to initialize", err);
			new Notice("Google Drive Sync: initialization failed. Check settings.");
		}
	}

	onunload() {
		if (this.syncTimer !== null) {
			window.clearInterval(this.syncTimer);
		}
		for (const timer of this.modifyDebounceTimers.values()) {
			clearTimeout(timer);
		}
	}

	// ── Public methods (called from settings UI) ─────────────────

	async login() {
		if (!this.settings.clientId || !this.settings.clientSecret) {
			new Notice("Enter your Client ID and Client Secret first.");
			return;
		}

		try {
			if (GoogleAuth.isMobile()) {
				// Mobile: open browser, wait for obsidian:// callback
				if (!this.settings.redirectPageUrl) {
					new Notice("Set the Redirect Page URL in settings first.");
					return;
				}
				await this.auth.startMobileAuth(
					this.settings.clientId,
					this.settings.redirectPageUrl
				);
				// Flow continues in the protocol handler registered in onload()
			} else {
				// Desktop: loopback server flow
				const tokens = await this.auth.authorizeDesktop(
					this.settings.clientId,
					this.settings.clientSecret
				);
				this.settings.refreshToken = tokens.refresh_token || "";
				this.settings.accessToken = tokens.access_token;
				this.settings.tokenExpiry = Date.now() + tokens.expires_in * 1000;
				await this.saveSettings();
				new Notice("Logged in successfully!");
				this.logger.info("Desktop OAuth login complete");
			}
		} catch (err: any) {
			this.logger.error("Login failed", err);
			new Notice(`Login failed: ${err.message}`);
		}
	}

	async logout() {
		if (this.settings.refreshToken) {
			await this.auth.revokeToken(this.settings.refreshToken);
		}
		this.settings.refreshToken = "";
		this.settings.accessToken = "";
		this.settings.tokenExpiry = 0;
		this.settings.vaultFolderId = "";
		await this.saveSettings();
		this.sync = null;
		this.drive = null;
		if (this.syncTimer !== null) {
			window.clearInterval(this.syncTimer);
			this.syncTimer = null;
		}
		new Notice("Logged out.");
		this.logger.info("Logged out and tokens revoked");
	}

	async initializeVault() {
		try {
			await this.ensureValidToken();
			const drive = this.getOrCreateDrive();

			new Notice("Creating vault folder in Google Drive...");
			const vaultId = await drive.ensureVaultFolder(this.app.vault.getName());
			this.settings.vaultFolderId = vaultId;
			await this.saveSettings();

			await this.initDriveAndSync();

			new Notice("Uploading all files... this may take a while.");
			const stats = await this.sync!.fullSync();
			new Notice(
				`Vault initialized! ${stats.uploaded} files uploaded.`
			);
			this.logger.info(`Vault initialized: ${vaultId}`);

			this.registerVaultEvents();
			this.startSyncTimer();
			this.registerCommands();
			this.registerRibbonIcons();
		} catch (err: any) {
			this.logger.error("Vault initialization failed", err);
			new Notice(`Initialization failed: ${err.message}`);
		}
	}

	async runFullSync(): Promise<{ uploaded: number; downloaded: number; conflicts: number }> {
		if (!this.sync) throw new Error("Sync not initialized");
		this.setStatusIcon("sync", true);
		try {
			const stats = await this.sync.fullSync();
			this.setStatusIcon("checkmark");
			return stats;
		} catch (err) {
			this.setStatusIcon("alert-triangle");
			throw err;
		}
	}

	// ── Token management ─────────────────────────────────────────

	private async ensureValidToken(): Promise<string> {
		if (this.auth.isTokenValid(this.settings.tokenExpiry)) {
			return this.settings.accessToken;
		}

		this.logger.info("Access token expired, refreshing...");
		const res = await this.auth.refreshAccessToken(
			this.settings.clientId,
			this.settings.clientSecret,
			this.settings.refreshToken
		);

		this.settings.accessToken = res.access_token;
		this.settings.tokenExpiry = Date.now() + res.expires_in * 1000;
		await this.saveSettings();
		return res.access_token;
	}

	// ── Drive & Sync initialization ──────────────────────────────

	private getOrCreateDrive(): DriveAPI {
		if (!this.drive) {
			this.drive = new DriveAPI(this.logger, () => this.ensureValidToken());
		}
		return this.drive;
	}

	private async initDriveAndSync() {
		const drive = this.getOrCreateDrive();
		this.sync = new SyncEngine(
			this.app,
			drive,
			this.logger,
			this.settings.vaultFolderId,
			this.settings.blacklistPaths
		);
		this.sync.onConflict = (localPath, driveFile) => this.showConflictModal(localPath, driveFile);
		this.sync.onDeleteRequest = (localPath, direction) => this.showDeleteConfirmation(localPath, direction);
		await this.sync.loadState();
	}

	// ── Vault event handlers ─────────────────────────────────────

	private registerVaultEvents() {
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (this.ignoreEvents) return;
				if (!(file instanceof TFile)) return;
				this.setStatusIcon("sync", true);
				this.sync?.enqueueCreate(file.path);
				setTimeout(() => this.setStatusIcon("checkmark"), 3000);
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.ignoreEvents) return;
				if (!(file instanceof TFile)) return;

				const existing = this.modifyDebounceTimers.get(file.path);
				if (existing) clearTimeout(existing);

				this.modifyDebounceTimers.set(
					file.path,
					setTimeout(() => {
						this.modifyDebounceTimers.delete(file.path);
						this.setStatusIcon("sync", true);
						this.sync?.enqueueModify(file.path);
						setTimeout(() => this.setStatusIcon("checkmark"), 3000);
					}, 2500)
				);
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.ignoreEvents) return;
				if (!(file instanceof TFile)) return;
				if (this.settings.confirmDeletions) {
					this.sync?.enqueueDelete(file.path);
				} else {
					this.sync?.confirmDeleteRemote(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.ignoreEvents) return;
				if (!(file instanceof TFile)) return;
				this.setStatusIcon("sync", true);
				this.sync?.enqueueRename(file.path, oldPath);
				setTimeout(() => this.setStatusIcon("checkmark"), 3000);
			})
		);
	}

	// ── Periodic sync ────────────────────────────────────────────

	private startSyncTimer() {
		if (this.syncTimer !== null) return;
		const intervalMs = this.settings.syncIntervalSeconds * 1000;
		this.syncTimer = this.registerInterval(
			window.setInterval(async () => {
				try {
					this.ignoreEvents = true;
					await this.runFullSync();
				} catch (err: any) {
					this.logger.error("Periodic sync failed", err);
				} finally {
					this.ignoreEvents = false;
				}
			}, intervalMs)
		);
	}

	// ── Commands & Ribbon ────────────────────────────────────────

	private registerCommands() {
		this.addCommand({
			id: "gdrive-sync-now",
			name: "Sync now",
			callback: async () => {
				new Notice("Syncing...");
				try {
					const stats = await this.runFullSync();
					new Notice(
						`Done: ${stats.uploaded} up, ${stats.downloaded} down, ${stats.conflicts} conflicts`
					);
				} catch {
					new Notice("Sync failed.");
				}
			},
		});

		this.addCommand({
			id: "gdrive-upload-current",
			name: "Upload current file",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("No file open.");
					return;
				}
				this.sync?.enqueueModify(file.path);
				new Notice(`Queued upload: ${file.path}`);
			},
		});

		this.addCommand({
			id: "gdrive-download-current",
			name: "Download current file from Drive",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.sync) {
					new Notice("No file open or sync not initialized.");
					return;
				}
				const record = this.sync.getRecord(file.path);
				if (!record) {
					new Notice("This file is not tracked by sync.");
					return;
				}
				try {
					const content = await this.drive!.downloadFile(record.driveFileId);
					this.ignoreEvents = true;
					await this.app.vault.modifyBinary(file, content);
					this.ignoreEvents = false;
					new Notice("Downloaded latest version.");
				} catch (err: any) {
					this.ignoreEvents = false;
					new Notice(`Download failed: ${err.message}`);
				}
			},
		});
	}

	private registerRibbonIcons() {
		this.addRibbonIcon("refresh-cw", "Sync with Google Drive", async () => {
			new Notice("Syncing...");
			try {
				const stats = await this.runFullSync();
				new Notice(
					`Done: ${stats.uploaded} up, ${stats.downloaded} down, ${stats.conflicts} conflicts`
				);
			} catch {
				new Notice("Sync failed.");
			}
		});
	}

	// ── UI helpers ───────────────────────────────────────────────

	private setStatusIcon(icon: string, animate = false) {
		this.statusBarEl.empty();
		setIcon(this.statusBarEl, icon);
		if (animate) {
			this.statusBarEl.classList.add("syncing");
		} else {
			this.statusBarEl.classList.remove("syncing");
		}
	}

	private showConflictModal(localPath: string, driveFile: DriveFile) {
		new ConflictModal(this.app, localPath, driveFile, async (choice) => {
			if (choice === "local" || choice === "remote") {
				await this.sync?.resolveConflict(localPath, choice);
				new Notice(`Conflict resolved (kept ${choice}): ${localPath}`);
			}
		}).open();
	}

	private showDeleteConfirmation(localPath: string, direction: "local" | "remote") {
		const message =
			direction === "local"
				? `"${localPath}" was deleted from Drive. Delete locally too?`
				: `"${localPath}" was deleted locally. Delete from Drive too?`;

		new DeleteConfirmModal(this.app, message, async (confirmed) => {
			if (confirmed) {
				if (direction === "local") {
					await this.sync?.confirmDeleteLocal(localPath);
				} else {
					await this.sync?.confirmDeleteRemote(localPath);
				}
				new Notice(`Deleted: ${localPath}`);
			}
		}).open();
	}

	// ── Settings persistence ─────────────────────────────────────

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// ── Modals ───────────────────────────────────────────────────────

class ConflictModal extends Modal {
	private localPath: string;
	private driveFile: DriveFile;
	private onChoose: (choice: "local" | "remote" | "skip") => void;

	constructor(
		app: App,
		localPath: string,
		driveFile: DriveFile,
		onChoose: (choice: "local" | "remote" | "skip") => void
	) {
		super(app);
		this.localPath = localPath;
		this.driveFile = driveFile;
		this.onChoose = onChoose;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("gdrive-sync-conflict-modal");

		contentEl.createEl("h2", { text: "Sync Conflict" });
		contentEl.createEl("p", {
			text: `Both the local and remote versions of "${this.localPath}" have changed since last sync.`,
		});
		contentEl.createEl("p", {
			text: `Remote last modified: ${this.driveFile.modifiedTime}`,
		});

		const actions = contentEl.createDiv({ cls: "conflict-actions" });

		new Setting(actions)
			.addButton((btn) =>
				btn.setButtonText("Keep local").onClick(() => {
					this.close();
					this.onChoose("local");
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Keep remote").onClick(() => {
					this.close();
					this.onChoose("remote");
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Skip").onClick(() => {
					this.close();
					this.onChoose("skip");
				})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

class DeleteConfirmModal extends Modal {
	private message: string;
	private onDecide: (confirmed: boolean) => void;

	constructor(app: App, message: string, onDecide: (confirmed: boolean) => void) {
		super(app);
		this.message = message;
		this.onDecide = onDecide;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h2", { text: "Confirm Deletion" });
		contentEl.createEl("p", { text: this.message });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Delete").setWarning().onClick(() => {
					this.close();
					this.onDecide(true);
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Keep").onClick(() => {
					this.close();
					this.onDecide(false);
				})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
