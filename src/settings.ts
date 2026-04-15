import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import { GoogleAuth } from "./auth";
import type GDriveSyncPlugin from "./main";

export class GDriveSyncSettingTab extends PluginSettingTab {
	plugin: GDriveSyncPlugin;

	constructor(app: App, plugin: GDriveSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h1", { text: "Google Drive Sync" });

		// ── Status ───────────────────────────────────────────────
		this.renderStatus(containerEl);

		// ── Setup instructions ───────────────────────────────────
		if (!this.plugin.settings.clientId) {
			this.renderSetupInstructions(containerEl);
		}

		// ── Google Cloud credentials ─────────────────────────────
		containerEl.createEl("h2", { text: "Google Cloud Credentials" });

		new Setting(containerEl)
			.setName("Client ID")
			.setDesc("OAuth2 Client ID from your Google Cloud project")
			.addText((text) =>
				text
					.setPlaceholder("xxxx.apps.googleusercontent.com")
					.setValue(this.plugin.settings.clientId)
					.onChange(async (value) => {
						this.plugin.settings.clientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Client Secret")
			.setDesc("OAuth2 Client Secret")
			.addText((text) =>
				text
					.setPlaceholder("GOCSPX-...")
					.setValue(this.plugin.settings.clientSecret)
					.onChange(async (value) => {
						this.plugin.settings.clientSecret = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// ── Mobile-specific: redirect page URL ───────────────────
		if (GoogleAuth.isMobile()) {
			new Setting(containerEl)
				.setName("Redirect page URL")
				.setDesc(
					"URL of the static redirect page that forwards the auth code " +
					"back to Obsidian. See the setup guide for instructions."
				)
				.addText((text) =>
					text
						.setPlaceholder("https://yourusername.github.io/gdrive-auth-redirect/")
						.setValue(this.plugin.settings.redirectPageUrl)
						.onChange(async (value) => {
							this.plugin.settings.redirectPageUrl = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Login / Logout ───────────────────────────────────────
		if (this.plugin.settings.clientId && this.plugin.settings.clientSecret) {
			if (this.plugin.settings.refreshToken) {
				new Setting(containerEl)
					.setName("Logged in")
					.setDesc("You are authenticated with Google Drive")
					.addButton((btn) =>
						btn
							.setButtonText("Logout")
							.setWarning()
							.onClick(async () => {
								await this.plugin.logout();
								this.display();
							})
					);
			} else {
				const loginDesc = GoogleAuth.isMobile()
					? "Opens Safari for Google login. You'll be redirected back to Obsidian automatically."
					: "Opens your browser for Google login. Completes automatically.";

				new Setting(containerEl)
					.setName("Login")
					.setDesc(loginDesc)
					.addButton((btn) =>
						btn
							.setButtonText("Login with Google")
							.setCta()
							.onClick(async () => {
								await this.plugin.login();
								// On desktop, display refreshes after login completes.
								// On mobile, the flow continues via protocol handler,
								// so we don't refresh here.
								if (!GoogleAuth.isMobile()) {
									this.display();
								}
							})
					);
			}
		}

		// ── Vault initialization ─────────────────────────────────
		if (this.plugin.settings.refreshToken && !this.plugin.settings.vaultFolderId) {
			new Setting(containerEl)
				.setName("Initialize vault")
				.setDesc(
					"Create the vault folder in Google Drive and upload all files. " +
					"This only needs to be done once per device."
				)
				.addButton((btn) =>
					btn
						.setButtonText("Initialize")
						.setCta()
						.onClick(async () => {
							await this.plugin.initializeVault();
							this.display();
						})
				);
		}

		// ── Sync settings ────────────────────────────────────────
		if (this.plugin.settings.vaultFolderId) {
			containerEl.createEl("h2", { text: "Sync Settings" });

			new Setting(containerEl)
				.setName("Sync interval")
				.setDesc("How often to check for remote changes (seconds). Reload required.")
				.addText((text) =>
					text
						.setValue(String(this.plugin.settings.syncIntervalSeconds))
						.onChange(async (value) => {
							const n = parseInt(value, 10);
							if (!isNaN(n) && n >= 5) {
								this.plugin.settings.syncIntervalSeconds = n;
								await this.plugin.saveSettings();
							}
						})
				);

			new Setting(containerEl)
				.setName("Confirm deletions")
				.setDesc(
					"Ask for confirmation before deleting files locally or from Drive. " +
					"Strongly recommended."
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.confirmDeletions)
						.onChange(async (val) => {
							this.plugin.settings.confirmDeletions = val;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Blacklist paths")
				.setDesc(
					"Comma-separated folder/file names to exclude from sync. " +
					"If a folder is listed, everything inside it is also excluded."
				)
				.addTextArea((area) =>
					area
						.setValue(this.plugin.settings.blacklistPaths.join(","))
						.onChange(async (value) => {
							this.plugin.settings.blacklistPaths = value
								.split(",")
								.map((s) => s.trim())
								.filter(Boolean);
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("Force full sync")
				.setDesc("Run a complete bidirectional sync right now")
				.addButton((btn) =>
					btn.setButtonText("Sync now").onClick(async () => {
						new Notice("Starting full sync...");
						try {
							const stats = await this.plugin.runFullSync();
							new Notice(
								`Sync done: ${stats.uploaded} uploaded, ${stats.downloaded} downloaded, ${stats.conflicts} conflicts`
							);
						} catch {
							new Notice("Sync failed. Check the log for details.");
						}
					})
				);
		}

		// ── Logging ──────────────────────────────────────────────
		containerEl.createEl("h2", { text: "Logging" });

		new Setting(containerEl)
			.setName("Enable file logging")
			.setDesc("Write sanitized logs to gdrive-sync-log.md (tokens are never included)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableFileLogging)
					.onChange(async (val) => {
						this.plugin.settings.enableFileLogging = val;
						this.plugin.logger.setFileLogging(val);
						await this.plugin.saveSettings();
					})
			);
	}

	private renderStatus(container: HTMLElement) {
		const statusDiv = container.createDiv({ cls: "gdrive-sync-setup-info" });
		const hasCredentials = !!(this.plugin.settings.clientId && this.plugin.settings.clientSecret);
		const isLoggedIn = !!this.plugin.settings.refreshToken;
		const hasVault = !!this.plugin.settings.vaultFolderId;

		const check = (ok: boolean) => (ok ? "done" : "pending");

		const isMobile = GoogleAuth.isMobile();
		const hasRedirect = !!this.plugin.settings.redirectPageUrl;

		let statusHtml =
			`<strong>Setup status:</strong><br>` +
			`1. Google Cloud credentials: <strong>${check(hasCredentials)}</strong><br>`;

		if (isMobile) {
			statusHtml += `2. Redirect page URL: <strong>${check(hasRedirect)}</strong><br>`;
			statusHtml += `3. Authenticated: <strong>${check(isLoggedIn)}</strong><br>`;
			statusHtml += `4. Vault initialized: <strong>${check(hasVault)}</strong>`;
		} else {
			statusHtml += `2. Authenticated: <strong>${check(isLoggedIn)}</strong><br>`;
			statusHtml += `3. Vault initialized: <strong>${check(hasVault)}</strong>`;
		}

		statusDiv.innerHTML = statusHtml;
	}

	private renderSetupInstructions(container: HTMLElement) {
		const isMobile = GoogleAuth.isMobile();
		const info = container.createDiv({ cls: "gdrive-sync-setup-info" });

		if (isMobile) {
			info.innerHTML = `
				<strong>iOS/Android setup:</strong>
				<ol>
					<li>Complete the Google Cloud setup on a computer first (see the setup guide)</li>
					<li>You need a <strong>Web application</strong> OAuth client type</li>
					<li>Add your redirect page URL as an authorized redirect URI</li>
					<li>Enter the same <strong>Client ID</strong> and <strong>Client Secret</strong> below</li>
					<li>Set the <strong>Redirect page URL</strong> (your GitHub Pages URL)</li>
				</ol>
				<p>Your credentials stay on this device. They are <strong>never</strong> sent to any third-party server.</p>
			`;
		} else {
			info.innerHTML = `
				<strong>First-time setup:</strong>
				<ol>
					<li>Go to <a href="https://console.cloud.google.com/">Google Cloud Console</a></li>
					<li>Create a new project (or select an existing one)</li>
					<li>Enable the <strong>Google Drive API</strong> (APIs &amp; Services &rarr; Enable APIs)</li>
					<li>Go to <strong>Credentials</strong> &rarr; Create Credentials &rarr; <strong>OAuth client ID</strong></li>
					<li>Application type: <strong>Desktop app</strong> (for macOS/Windows/Linux)</li>
					<li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> below</li>
					<li>In <strong>OAuth consent screen</strong>, add your Google email as a test user</li>
				</ol>
				<p>If you also want to sync from iOS, create a second credential of type
				<strong>Web application</strong> — see the full setup guide for details.</p>
				<p>Your credentials stay on this device. They are <strong>never</strong> sent to any third-party server.</p>
			`;
		}
	}
}
