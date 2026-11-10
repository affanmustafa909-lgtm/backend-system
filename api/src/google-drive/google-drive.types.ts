export type GoogleDriveStoredTokens = {
  connected: true;
  connectedAt: string;
  email?: string | null;
  displayName?: string | null;
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  rootFolderId?: string | null;
};

export type GoogleDriveStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  displayName: string | null;
  connectedAt: string | null;
  folderName: string | null;
  folderId: string | null;
  folderUrl: string | null;
  androidClientId: string | null;
};

export type GoogleDriveUploadResult = {
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
  mimeType: string;
  name: string;
};
