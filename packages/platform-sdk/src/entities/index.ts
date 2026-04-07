// Public surface for the entity-sharing layer.
// Consumers should import from '@anby/platform-sdk/entities' (or the barrel).

export {
  EntityNotInstalledError,
  EntityProviderUnreachableError,
  EntitySchemaViolationError,
  ScopedTokenError,
  TenantMismatchError,
} from './errors.js';

export {
  parseEntityRequires,
  qualifyEntity,
  type EntityProvidesDecl,
  type EntityRequiresDecl,
  type EntityProviderEntry,
  type EntityMapResponse,
  type ScopedTokenClaims,
  type ScopedToken,
  type EntityHandlerContext,
  type EntityHandlerConfig,
  type AppIdentitySignatureHeaders,
} from './types.js';

export {
  configureAppIdentity,
  getAppIdentity,
  generateAppKeyPair,
  signAppRequest,
  verifyAppRequest,
  hashBody,
  canonicalSigString,
  _resetAppIdentity,
  type AppIdentity,
  type AppKeyPair,
  type SignedRequestHeaders,
} from './identity.js';

export {
  getScopedToken,
  invalidateToken,
} from './token.js';

export {
  bootstrapEntityMap,
  ensureAndResolveEntityProvider,
  resolveEntityProvider,
  _injectEntityMap,
  _clearResolver,
} from './resolver.js';

export {
  getEntityClient,
  type EntityClient,
  type EntityClientOptions,
} from './client.js';

export {
  dispatchEntityRequest,
  handleEntityRemixRequest,
  requestToDispatch,
  dispatchResponseToResponse,
  RegistryPublicKeyVerifier,
  SharedSecretVerifier,
  type EntityHandlerRegistration,
  type TokenVerifier,
  type DispatchRequest,
  type DispatchResponse,
} from './handler.js';

export {
  InMemoryEntityCache,
  configureEntityCache,
  getEntityCache,
  entityCacheKey,
  type EntityCache,
} from './cache.js';

export {
  configureRedis,
  getRedisOrNull,
  RedisEntityCache,
  startInvalidationSubscriber,
  publishInvalidation,
  startResolverMapSubscriber,
  publishResolverMapUpdate,
  _resetRedisModule,
  type ConfigureRedisOptions,
  type RedisEntityCacheOptions,
  type InvalidationSubscriberOptions,
  type ResolverStreamOptions,
} from './redis.js';

export {
  registerEntitySchema,
  validateEntityPayload,
  schemaChecksum,
  _resetSchemaCache,
} from './schema.js';

export {
  scopedDb,
  tenantClause,
  type ScopedTableQuery,
  type DrizzleLike,
  type ScopedDbOptions,
} from './scopedDb.js';
