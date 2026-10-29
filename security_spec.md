# Asset Track — Firestore Security Specification (Multicurrency Edition)

## 1. Data Invariants & Master Source of Truth

1. **Master Gate & Relational Ownership**:
   - Every `/assets/{assetId}` document is owned exclusively by `ownerId == request.auth.uid` with a verified email (`request.auth.token.email_verified == true`).
   - `/assets/{assetId}/events/{eventId}` is governed by `/assets/{assetId}` via `getAfter` on create and `get` on single-doc read/delete.
   - `/userSettings/{userId}` is strictly isolated to `userId == request.auth.uid` with `allow list: if false` and `allow delete: if false`.
2. **Strict Schema & Multicurrency ISO Allowlist**:
   - `Asset.currency` and `UserSettings.reportingCurrency` must be a 3-character string strictly within the 12 supported ISO 4217 currency codes (`USD`, `EUR`, `GBP`, `CAD`, `AUD`, `JPY`, `CHF`, `INR`, `SGD`, `ZAR`, `NGN`, `BRL`).
   - `Asset` documents must contain all 18 required fields and zero shadow fields (`hasAll` + `hasOnly`).
   - `UserSettings` documents must contain all 3 required fields and zero shadow fields (`hasAll` + `hasOnly`).
3. **Path Variable Hardening**:
   - `{assetId}`, `{eventId}`, and `{userId}` must match `^[a-zA-Z0-9_\-]+$` with length `1..128` (`isValidId`).
4. **Temporal & Immutable Field Integrity**:
   - `createdAt` must equal `request.time` on `create` and is strictly immutable on `update`.
   - `updatedAt` must equal `request.time` on both `create` and `update`.
   - `assetId`, `ownerId`, and `userId` are strictly immutable on `update`.
5. **Terminal State Locking**:
   - Once an `Asset` reaches `status == 'Disposed'`, all subsequent `update` operations are rejected (`existing().status != 'Disposed'`).
6. **PII & Query Isolation**:
   - `allow list` on `assets` and `events` explicitly enforces `resource.data.ownerId == request.auth.uid` with zero `get()` calls inside `list`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Identity Spoofing on Asset Create**: `{ ...validAsset, ownerId: "victim-uid-999" }` -> `PERMISSION_DENIED`.
2. **Payload 2 — Unverified Email Spoof Attack**: `email_verified: false` -> `PERMISSION_DENIED`.
3. **Payload 3 — Unsupported / Poisoned Currency Code**: `{ ...validAsset, currency: "BTC" }` or `currency: "US DOLLAR"` -> `PERMISSION_DENIED`.
4. **Payload 4 — Shadow Field / Update-Gap on Asset Update**: `{ status: "Maintenance", shadowFlag: "bypass", updatedAt: request.time }` -> `PERMISSION_DENIED`.
5. **Payload 5 — Path ID Poisoning**: Mismatched `data.assetId != assetId` -> `PERMISSION_DENIED`.
6. **Payload 6 — Denial-of-Wallet Oversized String**: `notes` > 1000 chars -> `PERMISSION_DENIED`.
7. **Payload 7 — Client Timestamp Forgery**: Forged `createdAt` -> `PERMISSION_DENIED`.
8. **Payload 8 — Immutable `ownerId` Transfer on Update**: Mutating `ownerId` -> `PERMISSION_DENIED`.
9. **Payload 9 — Terminal State Bypass (`Disposed` Asset Mutation)**: Updating `currentValuation` or `currency` on a `Disposed` asset -> `PERMISSION_DENIED`.
10. **Payload 10 — Orphaned Subcollection Event Write**: Event write for non-existent parent asset -> `PERMISSION_DENIED`.
11. **Payload 11 — Cross-User Settings Tampering / Reading**: Reading or writing `/userSettings/other_uid` -> `PERMISSION_DENIED`.
12. **Payload 12 — Unauthorized Blanket `list` Scraping**: Querying `/assets` without `where('ownerId', '==', uid)` or listing `/userSettings` -> `PERMISSION_DENIED`.
