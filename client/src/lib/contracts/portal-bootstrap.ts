export type PortalSessionUser = {
  id: string;
  nickname?: string;
  realName?: string;
  studentCode?: string | null;
  profileImage?: string | null;
  level?: number;
};

export type PortalSessionSnapshot = {
  authenticated: boolean;
  reason?: string | null;
  user?: PortalSessionUser;
  currentIgk?: number;
  lifetimeIgk?: number;
  mustChangePassword?: boolean;
  expiresAt?: string;
};

export type PlatformModeSnapshot = {
  bSideEnabled: boolean;
  maintenanceEnabled: boolean;
  version: string;
};
