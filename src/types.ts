/** Plugin settings stored in data.json */
export interface PluginSettings {
	clientId: string;
	clientSecret: string;
	refreshToken: string;
	accessToken: string;
	tokenExpiry: number; // epoch ms
	vaultFolderId: string;
	syncIntervalSeconds: number;
	blacklistPaths: string[];
	confirmDeletions: boolean;
	enableFileLogging: boolean;
	redirectPageUrl: string; // URL of the static redirect page (for mobile OAuth)
}

export const DEFAULT_SETTINGS: PluginSettings = {
	clientId: "",
	clientSecret: "",
	refreshToken: "",
	accessToken: "",
	tokenExpiry: 0,
	vaultFolderId: "",
	syncIntervalSeconds: 10,
	blacklistPaths: [],
	confirmDeletions: true,
	enableFileLogging: false,
	redirectPageUrl: "",
};

/** A single file entry from Google Drive API v3 */
export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime: string;
	md5Checksum?: string;
	size?: string;
}

/** Tracks the last-known sync state for one file */
export interface SyncRecord {
	localPath: string;
	driveFileId: string;
	localHash: string;   // SHA-256 hex of local content at last sync
	remoteMd5: string;   // md5Checksum from Drive at last sync
	lastSyncedAt: string; // ISO 8601
}

/** Full sync state persisted alongside settings */
export interface SyncState {
	records: Record<string, SyncRecord>; // keyed by localPath
}

/** What the sync engine decides to do for each file */
export type SyncAction =
	| { type: "upload"; localPath: string }
	| { type: "download"; driveFile: DriveFile }
	| { type: "update-remote"; localPath: string; driveFileId: string }
	| { type: "update-local"; localPath: string; driveFile: DriveFile }
	| { type: "delete-remote"; driveFileId: string; localPath: string }
	| { type: "delete-local"; localPath: string }
	| { type: "conflict"; localPath: string; driveFile: DriveFile };

/** OAuth2 token response from Google */
export interface TokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	token_type: string;
}
