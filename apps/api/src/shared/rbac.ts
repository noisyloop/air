/** Central catalog of permissions and default role grants. */

export const PERMISSIONS = {
  // catalog
  trackRead: 'track:read',
  trackUpload: 'track:upload',
  trackManage: 'track:manage', // edit/delete any track metadata
  // playlists & social
  playlistWrite: 'playlist:write',
  socialWrite: 'social:write',
  // streaming
  streamAudio: 'stream:audio',
  streamLossless: 'stream:lossless',
  // admin
  adminUsers: 'admin:users',
  adminUploads: 'admin:uploads',
  adminAnalytics: 'admin:analytics',
  adminSystem: 'admin:system',
  adminAudit: 'admin:audit',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  listener: [
    PERMISSIONS.trackRead,
    PERMISSIONS.playlistWrite,
    PERMISSIONS.socialWrite,
    PERMISSIONS.streamAudio,
  ],
  artist: [PERMISSIONS.trackRead, PERMISSIONS.trackUpload, PERMISSIONS.streamAudio, PERMISSIONS.streamLossless],
  moderator: [
    PERMISSIONS.trackRead,
    PERMISSIONS.trackManage,
    PERMISSIONS.adminUploads,
    PERMISSIONS.streamAudio,
  ],
  admin: Object.values(PERMISSIONS),
};

export interface AccessTokenPayload {
  sub: string;
  roles: string[];
  perms: PermissionKey[];
}

export function hasPermission(payload: AccessTokenPayload | undefined, perm: PermissionKey): boolean {
  return !!payload?.perms?.includes(perm);
}
