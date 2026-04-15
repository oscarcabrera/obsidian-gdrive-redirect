import { requestUrl } from "obsidian";
import { DriveFile } from "./types";
import { Logger } from "./logger";

const API_BASE = "https://www.googleapis.com/drive/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,md5Checksum,size";

/**
 * Thin wrapper around Google Drive API v3.
 * Uses Obsidian's requestUrl exclusively — no axios, no fetch, no third parties.
 */
export class DriveAPI {
	private log: Logger;
	private getToken: () => Promise<string>;

	/**
	 * @param getToken - async function that returns a valid access token.
	 *                   The caller is responsible for refreshing expired tokens.
	 */
	constructor(log: Logger, getToken: () => Promise<string>) {
		this.log = log;
		this.getToken = getToken;
	}

	// ── Folders ──────────────────────────────────────────────────

	/** Find a folder by name under an optional parent. Returns null if not found. */
	async findFolder(name: string, parentId?: string): Promise<DriveFile | null> {
		let q = `mimeType='${FOLDER_MIME}' and name='${this.escapeQuery(name)}' and trashed=false`;
		if (parentId) q += ` and '${parentId}' in parents`;

		const files = await this.listQuery(q, "id,name,mimeType,modifiedTime");
		return files.length > 0 ? files[0] : null;
	}

	/** Create a folder. Returns the new folder's ID. */
	async createFolder(name: string, parentId?: string): Promise<string> {
		const token = await this.getToken();
		const metadata: Record<string, unknown> = {
			name,
			mimeType: FOLDER_MIME,
		};
		if (parentId) metadata.parents = [parentId];

		const res = await requestUrl({
			url: `${API_BASE}/files`,
			method: "POST",
			headers: this.jsonHeaders(token),
			body: JSON.stringify(metadata),
		});
		this.log.info(`Created folder: ${name} (${res.json.id})`);
		return res.json.id;
	}

	/** Find or create the root 'obsidian' folder, then find or create the vault subfolder. */
	async ensureVaultFolder(vaultName: string): Promise<string> {
		// Root folder
		let root = await this.findFolder("obsidian");
		if (!root) {
			const id = await this.createFolder("obsidian");
			root = { id, name: "obsidian", mimeType: FOLDER_MIME, modifiedTime: "" };
		}

		// Vault folder
		let vault = await this.findFolder(vaultName, root.id);
		if (!vault) {
			const id = await this.createFolder(vaultName, root.id);
			return id;
		}
		return vault.id;
	}

	// ── File listing ─────────────────────────────────────────────

	/** List all files (not folders) inside a folder, handling pagination. */
	async listFiles(folderId: string): Promise<DriveFile[]> {
		const q = `'${folderId}' in parents and mimeType!='${FOLDER_MIME}' and trashed=false`;
		return this.listQuery(q, FILE_FIELDS);
	}

	/** Generic paginated query. */
	private async listQuery(q: string, fields: string): Promise<DriveFile[]> {
		const token = await this.getToken();
		const allFiles: DriveFile[] = [];
		let pageToken: string | undefined;

		do {
			const params = new URLSearchParams({
				q,
				fields: `nextPageToken,files(${fields})`,
				pageSize: "1000",
			});
			if (pageToken) params.set("pageToken", pageToken);

			const res = await requestUrl({
				url: `${API_BASE}/files?${params.toString()}`,
				method: "GET",
				headers: this.authHeaders(token),
			});

			allFiles.push(...(res.json.files || []));
			pageToken = res.json.nextPageToken;
		} while (pageToken);

		return allFiles;
	}

	// ── Upload / Update ──────────────────────────────────────────

	/**
	 * Upload a new file. Uses multipart upload (metadata + content in one request).
	 * Returns the new file's ID.
	 */
	async uploadFile(name: string, content: ArrayBuffer, parentId: string): Promise<DriveFile> {
		const token = await this.getToken();
		const metadata = JSON.stringify({ name, parents: [parentId] });

		const boundary = "obsidian_gdrive_boundary";
		const body = this.buildMultipartBody(boundary, metadata, content);

		const res = await requestUrl({
			url: `${UPLOAD_BASE}/files?uploadType=multipart&fields=${FILE_FIELDS}`,
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": `multipart/related; boundary=${boundary}`,
			},
			body,
		});

		this.log.info(`Uploaded: ${name} (${res.json.id})`);
		return res.json as DriveFile;
	}

	/**
	 * Update an existing file's content. Returns updated metadata.
	 */
	async updateFile(fileId: string, content: ArrayBuffer): Promise<DriveFile> {
		const token = await this.getToken();

		const res = await requestUrl({
			url: `${UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=${FILE_FIELDS}`,
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/octet-stream",
			},
			body: content,
		});

		return res.json as DriveFile;
	}

	// ── Download ─────────────────────────────────────────────────

	/** Download a file's content as ArrayBuffer. */
	async downloadFile(fileId: string): Promise<ArrayBuffer> {
		const token = await this.getToken();

		const res = await requestUrl({
			url: `${API_BASE}/files/${fileId}?alt=media`,
			method: "GET",
			headers: this.authHeaders(token),
		});

		return res.arrayBuffer;
	}

	// ── Rename / Delete ──────────────────────────────────────────

	/** Rename a file in Drive. */
	async renameFile(fileId: string, newName: string): Promise<void> {
		const token = await this.getToken();
		await requestUrl({
			url: `${API_BASE}/files/${fileId}`,
			method: "PATCH",
			headers: this.jsonHeaders(token),
			body: JSON.stringify({ name: newName }),
		});
		this.log.info(`Renamed file ${fileId} to: ${newName}`);
	}

	/** Move a file to trash. Returns false if file was already gone (404). */
	async trashFile(fileId: string): Promise<boolean> {
		const token = await this.getToken();
		try {
			await requestUrl({
				url: `${API_BASE}/files/${fileId}`,
				method: "PATCH",
				headers: this.jsonHeaders(token),
				body: JSON.stringify({ trashed: true }),
			});
			return true;
		} catch (err: any) {
			if (err?.status === 404) return false;
			throw err;
		}
	}

	/** Get metadata for a single file. */
	async getFileMetadata(fileId: string): Promise<DriveFile> {
		const token = await this.getToken();
		const res = await requestUrl({
			url: `${API_BASE}/files/${fileId}?fields=${FILE_FIELDS}`,
			method: "GET",
			headers: this.authHeaders(token),
		});
		return res.json as DriveFile;
	}

	// ── Private helpers ──────────────────────────────────────────

	private authHeaders(token: string): Record<string, string> {
		return { Authorization: `Bearer ${token}` };
	}

	private jsonHeaders(token: string): Record<string, string> {
		return {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
	}

	private escapeQuery(s: string): string {
		return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
	}

	/**
	 * Build a multipart/related body for file upload.
	 * Structure: metadata part (JSON) + content part (binary).
	 */
	private buildMultipartBody(boundary: string, metadataJson: string, content: ArrayBuffer): ArrayBuffer {
		const encoder = new TextEncoder();

		const preamble = encoder.encode(
			`--${boundary}\r\n` +
			`Content-Type: application/json; charset=UTF-8\r\n\r\n` +
			`${metadataJson}\r\n` +
			`--${boundary}\r\n` +
			`Content-Type: application/octet-stream\r\n\r\n`
		);
		const epilogue = encoder.encode(`\r\n--${boundary}--`);

		const contentBytes = new Uint8Array(content);
		const body = new Uint8Array(preamble.length + contentBytes.length + epilogue.length);
		body.set(preamble, 0);
		body.set(contentBytes, preamble.length);
		body.set(epilogue, preamble.length + contentBytes.length);

		return body.buffer;
	}
}
