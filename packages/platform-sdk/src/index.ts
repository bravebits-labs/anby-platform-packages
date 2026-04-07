export {
  configureAuth,
  verifyJwt,
  verifyHmac,
  signHmac,
  authenticateRequest,
  requireAuth,
  type AuthUser,
  type AuthConfig,
} from './auth/index.js';

export {
  configureEventTransport,
  createEvent,
  publishEvent,
  InMemoryTransport,
  PostgresEventTransport,
  type EventTransport,
} from './events/index.js';

export {
  configurePlatform,
  getPlatformConfig,
  type PlatformConfig,
} from './config/index.js';

export {
  publishAppFromManifest,
  autoPublishOnBoot,
  type PublishAppOptions,
  type PublishAppResult,
} from './apps/publish.js';

export {
  getPreviewModeFromRequest,
  isPreviewMode,
  type PreviewMode,
} from './preview.js';

// ---------------------------------------------------------------------------
// Entity sharing layer (Wave 1)
// ---------------------------------------------------------------------------
export * from './entities/index.js';
