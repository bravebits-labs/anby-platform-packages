export {
  configureAuth,
  verifyUserJwt,
  verifyInternalJwt,
  verifyHmac,
  signHmac,
  authenticateRequest,
  requireAuth,
  JWT_ISSUER,
  JWT_AUDIENCE,
  TYP_USER,
  TYP_INTERNAL,
  TYP_OAUTH_STATE,
  type AuthUser,
  type AuthConfig,
} from './auth/index.js';

export {
  bootstrapFromToken,
  parseAppToken,
  ANBY_TOKEN_PREFIX,
  type AnbyAppToken,
  type DiscoveryResponse,
  type BootstrapOptions,
} from './bootstrap/index.js';

export {
  configureEventTransport,
  createEvent,
  publishEvent,
  InMemoryTransport,
  PostgresEventTransport,
  type EventTransport,
  type AppProvidedEvents,
  type AppRequiredEvents,
} from './events/index.js';

export { HttpEventTransport } from './events/http-transport.js';

// PLAN-app-bootstrap-phase2 PR3: discovery state accessors for code that
// needs the discovered registry URL after bootstrap (autoPublishOnBoot,
// entity-handler verifier, etc).
export {
  getDiscoveredEndpoints,
  getDiscoveredRegistryBaseUrl,
} from './bootstrap/index.js';

export {
  configurePlatform,
  getPlatformConfig,
  type PlatformConfig,
} from './config/index.js';

export {
  publishAppFromManifest,
  autoPublishOnBoot,
  getInlinedManifest,
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

// ---------------------------------------------------------------------------
// Service-app token signing (caller side, e.g. god-brain → app feed)
// ---------------------------------------------------------------------------
export {
  signServiceToken,
  type SignServiceTokenOptions,
} from './services/sign.js';
