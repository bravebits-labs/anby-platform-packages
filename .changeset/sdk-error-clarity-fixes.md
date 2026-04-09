---
"@anby/platform-sdk": patch
---

fix(platform-sdk): stop hiding ScopedTokenError under EntityProviderUnreachableError + clarify 304-with-no-cache resolver edge case

Two debugging-papercut fixes that hid the real cause of failures behind misleading wrappers:

**1. `entities/client.ts` — auth failures were misreported as network failures.**
The `try/catch` around `doRequest()` wrapped *every* error from the underlying call (including `ScopedTokenError` from `getScopedToken()`) as `EntityProviderUnreachableError`. That sent operators chasing phantom IPv6/firewall/DNS issues for hours when the real cause was a registry 401 ("signature mismatch", "app not installed", revoked, etc.). `ScopedTokenError` now propagates with its original message and HTTP status.

**2. `entities/resolver.ts` — 304 Not Modified with an empty in-memory cache fell through to the generic error branch.**
If the registry replied 304 to a cold caller (cache cleared mid-flight, stale ETag in a race), the function fell through `if (cur) return ...` into `if (!res.ok)` and threw `"registry entity-map fetch failed (304)"` — wrong root cause and wrong status semantics. Now it throws an explicit message naming the contract violation.
