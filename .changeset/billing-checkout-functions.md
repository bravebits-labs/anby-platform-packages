---
"@anby/billing": minor
---

Add `createSubscriptionCheckout` and `createTopupCheckout` client functions for Polar checkout (pricing v2 plans pro/business + top-up packages mini/plus/max), with `PlanAlreadyActiveError` typed 409 mapping and `embedOrigin` passthrough for embedded checkout.
