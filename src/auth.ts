import { Platform, requestUrl, Notice } from "obsidian";
import { TokenResponse } from "./types";
import { Logger } from "./logger";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const LOOPBACK = "127.0.0.1";

/**
 * Direct OAuth2 with Google — no third-party servers.
 *
 * Two flows depending on platform:
 * - Desktop (macOS/Win/Linux): PKCE + loopback HTTP server on localhost
 * - Mobile (iOS/Android): PKCE + redirect to static page → obsidian:// protocol handler
 */
export class GoogleAuth {
	private log: Logger;

	/** Stored between startMobileAuth() and completeMobileAuth() */
	private pendingPKCE: { codeVerifier: string; redirectUri: string } | null = null;

	constructor(log: Logger) {
		this.log = log;
	}

	// ── Desktop flow (loopback) ──────────────────────────────────

	/**
	 * Desktop OAuth2 flow:
	 * 1. Generate PKCE
	 * 2. Start temporary HTTP server on localhost
	 * 3. Open browser → Google consent
	 * 4. Google redirects to localhost → server captures code
	 * 5. Exchange code for tokens directly with Google
	 */
	async authorizeDesktop(clientId: string, clientSecret: string): Promise<TokenResponse> {
		const { codeVerifier, codeChallenge } = await this.generatePKCE();

		return new Promise((resolve, reject) => {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const http = require("http") as typeof import("http");

			const server = http.createServer();
			let settled = false;

			server.listen(0, LOOPBACK, () => {
				const addr = server.address();
				if (!addr || typeof addr === "string") {
					reject(new Error("Failed to start local auth server"));
					return;
				}
				const port = addr.port;
				const redirectUri = `http://${LOOPBACK}:${port}`;
				const authUrl = this.buildAuthUrl(clientId, redirectUri, codeChallenge);

				this.log.info(`Auth server listening on port ${port}`);
				window.open(authUrl);
				new Notice("Browser opened for Google login. Complete the flow there.", 8000);
			});

			server.on("request", async (req: any, res: any) => {
				if (settled) return;

				const url = new URL(req.url, `http://${LOOPBACK}`);
				const code = url.searchParams.get("code");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(this.resultPage(false, error));
					settled = true;
					server.close();
					reject(new Error(`Google auth denied: ${error}`));
					return;
				}

				if (!code) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end("<html><body>Missing authorization code.</body></html>");
					return;
				}

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(this.resultPage(true));
				settled = true;
				server.close();

				try {
					const addr = server.address();
					const port = typeof addr === "object" && addr ? addr.port : 0;
					const redirectUri = `http://${LOOPBACK}:${port}`;
					const tokens = await this.exchangeCode(clientId, clientSecret, code, redirectUri, codeVerifier);
					resolve(tokens);
				} catch (err) {
					reject(err);
				}
			});

			setTimeout(() => {
				if (!settled) {
					settled = true;
					server.close();
					reject(new Error("Auth flow timed out after 5 minutes"));
				}
			}, 5 * 60 * 1000);
		});
	}

	// ── Mobile flow (protocol handler) ───────────────────────────

	/**
	 * Mobile OAuth2 flow — step 1:
	 * Opens the browser with a redirect_uri pointing to a static page
	 * that will forward the auth code to obsidian:// protocol handler.
	 *
	 * @param redirectPageUrl - The URL of the static redirect page (e.g. GitHub Pages).
	 *                          This page receives ?code=X and redirects to obsidian://gdrive-sync-auth?code=X
	 * @returns void — the flow completes asynchronously when completeMobileAuth() is called.
	 */
	async startMobileAuth(clientId: string, redirectPageUrl: string): Promise<void> {
		const { codeVerifier, codeChallenge } = await this.generatePKCE();

		this.pendingPKCE = { codeVerifier, redirectUri: redirectPageUrl };

		const authUrl = this.buildAuthUrl(clientId, redirectPageUrl, codeChallenge);
		window.open(authUrl);
		new Notice("Browser opened for Google login. Return to Obsidian when done.", 8000);
	}

	/**
	 * Mobile OAuth2 flow — step 2:
	 * Called by the obsidian:// protocol handler after the browser redirects back.
	 */
	async completeMobileAuth(
		clientId: string,
		clientSecret: string,
		code: string
	): Promise<TokenResponse> {
		if (!this.pendingPKCE) {
			throw new Error("No pending auth flow. Please start login again.");
		}

		const { codeVerifier, redirectUri } = this.pendingPKCE;
		this.pendingPKCE = null;

		return this.exchangeCode(clientId, clientSecret, code, redirectUri, codeVerifier);
	}

	/** Returns true if there's a pending mobile auth waiting for callback. */
	hasPendingMobileAuth(): boolean {
		return this.pendingPKCE !== null;
	}

	// ── Convenience: auto-detect platform ────────────────────────

	/**
	 * Returns true if we should use the mobile auth flow.
	 * Mobile = iOS or Android (no Node.js http module available).
	 */
	static isMobile(): boolean {
		return Platform.isMobile;
	}

	// ── Token management ─────────────────────────────────────────

	async refreshAccessToken(
		clientId: string,
		clientSecret: string,
		refreshToken: string
	): Promise<{ access_token: string; expires_in: number }> {
		const body = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		}).toString();

		const response = await requestUrl({
			url: GOOGLE_TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});

		if (response.status !== 200) {
			throw new Error(`Token refresh failed (${response.status}): ${response.text}`);
		}

		return response.json;
	}

	async revokeToken(token: string): Promise<void> {
		try {
			await requestUrl({
				url: `${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`,
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			});
			this.log.info("Token revoked successfully");
		} catch {
			this.log.warn("Token revocation failed (token may already be invalid)");
		}
	}

	isTokenValid(expiryMs: number): boolean {
		return expiryMs - Date.now() > 5 * 60 * 1000;
	}

	// ── Private helpers ──────────────────────────────────────────

	buildAuthUrl(clientId: string, redirectUri: string, codeChallenge: string): string {
		const params = new URLSearchParams({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: SCOPE,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			access_type: "offline",
			prompt: "consent",
		});
		return `${GOOGLE_AUTH_URL}?${params.toString()}`;
	}

	private async exchangeCode(
		clientId: string,
		clientSecret: string,
		code: string,
		redirectUri: string,
		codeVerifier: string
	): Promise<TokenResponse> {
		const body = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		}).toString();

		const response = await requestUrl({
			url: GOOGLE_TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});

		if (response.status !== 200) {
			throw new Error(`Token exchange failed (${response.status}): ${response.text}`);
		}

		const data = response.json as TokenResponse;
		if (!data.refresh_token) {
			throw new Error("No refresh_token received. Try revoking app access in your Google account and re-authorizing.");
		}

		return data;
	}

	async generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
		const array = new Uint8Array(32);
		crypto.getRandomValues(array);
		const codeVerifier = this.base64UrlEncode(array);

		const encoder = new TextEncoder();
		const digest = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
		const codeChallenge = this.base64UrlEncode(new Uint8Array(digest));

		return { codeVerifier, codeChallenge };
	}

	private base64UrlEncode(bytes: Uint8Array): string {
		let binary = "";
		for (const byte of bytes) {
			binary += String.fromCharCode(byte);
		}
		return btoa(binary)
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	}

	private resultPage(success: boolean, error?: string): string {
		if (success) {
			return `<!DOCTYPE html>
<html><head><title>Obsidian GDrive Sync</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px">
<h1>Authorization successful</h1>
<p>You can close this tab and return to Obsidian.</p>
</body></html>`;
		}
		return `<!DOCTYPE html>
<html><head><title>Obsidian GDrive Sync</title></head>
<body style="font-family:system-ui;text-align:center;padding:60px">
<h1>Authorization failed</h1>
<p>Error: ${error}</p>
<p>Close this tab and try again in Obsidian.</p>
</body></html>`;
	}
}
