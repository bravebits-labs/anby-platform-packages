export interface PlatformConfig {
  registryUrl: string;
  appId: string;
  tenantId?: string;
}

let _platformConfig: PlatformConfig | null = null;

export function configurePlatform(config: PlatformConfig): void {
  _platformConfig = config;
}

export function getPlatformConfig(): PlatformConfig {
  if (!_platformConfig) throw new Error('Platform not configured. Call configurePlatform() first.');
  return _platformConfig;
}
