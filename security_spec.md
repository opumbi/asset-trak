# Asset Track — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants & Master Source of Truth

1. **Master Gate & Relational Ownership**:
   - Every `/assets/{assetId}` document is owned exclusively by `ownerId == request.auth.uid` with a verified email (`request.auth.token.email_verified == true`).
   - `/assets/{assetId}/events/{eventId}` is a subcollection governed by `/assets/{assetId}`. An `AssetEvent` can only be created if `getAfter(/databases/$(database)/documents/assets/$(assetId)).data.ownerId == request.auth.uid`, and can only be read (`get`) or deleted if `get(/databases/$(database)/documents/assets/$(assetId)).data.ownerId == request.auth.uid`.
2. **Strict Schema & Zero Shadow Fields**:
   - `Asset` documents must contain all 17 required fields and zero extra fields (`hasAll` + `hasOnly`).
   - `AssetEvent` documents must contain all 7 required fields and zero extra fields (`hasAll` + `hasOnly`).
3. **Path Variable Hardening**:
   - `{assetId}` and `{eventId}` must match `^[a-zA-Z0-9_\-]+$` with length `1..128` (`isValidId`) and equal `data.assetId` / `data.eventId`.
4. **Temporal & Immutable Field Integrity**:
   - `createdAt` must equal `request.time` on `create` and is strictly immutable on `update`.
   - `updatedAt` must equal `request.time` on both `create` and `update`.
   - `assetId` and `ownerId` are strictly immutable on `update`.
   - `AssetEvent` documents are append-only (`allow update: if false`).
5. **Terminal State Locking**:
   - Once an `Asset` reaches `status == 'Disposed'`, all subsequent `update` operations are rejected (`existing().status != 'Disposed'`).
6. **PII & Query Isolation**:
   - `actorEmail` in `AssetEvent` and `assignedTo` in `Asset` are strictly isolated to `ownerId == request.auth.uid`.
   - `allow list` rules explicitly enforce `resource.data.ownerId == request.auth.uid` (and `resource.data.assetId == assetId` for events) with zero `get()` calls inside `list`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Identity Spoofing on Asset Create**:
   `{ ...validAsset, ownerId: "victim-uid-999" }` -> Rejected (`data.ownerId == request.auth.uid` fails).
2. **Payload 2 — Unverified Email Spoof Attack**:
   Auth token has `email: "mikelopum@gmail.com", email_verified: false` -> Rejected (`isEmailVerified()` fails).
3. **Payload 3 — Shadow Field Injection on Create**:
   `{ ...validAsset, isAdminApproved: true }` -> Rejected (`data.keys().hasOnly(...)` fails).
4. **Payload 4 — Shadow Field / Update-Gap on Asset Update**:
   Updating `{ status: "Maintenance", shadowFlag: "bypass", updatedAt: request.time }` -> Rejected (`hasOnly` in `isValidAsset` and `affectedKeys().hasOnly(...)` fail).
5. **Payload 5 — Path ID Poisoning**:
   Creating `/assets/malicious$path!id` or mismatching `data.assetId != assetId` -> Rejected (`isValidId(assetId)` and `data.assetId == assetId` fail).
6. **Payload 6 — Denial-of-Wallet Oversized String**:
   Setting `notes` to a 5,000-character string (exceeds `maxLength: 1000`) -> Rejected (`data.notes.size() <= 1000` fails).
7. **Payload 7 — Client Timestamp Forgery**:
   Supplying a past timestamp `2020-01-01T00:00:00Z` for `createdAt` or `updatedAt` -> Rejected (`incoming().createdAt == request.time` / `incoming().updatedAt == request.time` fails).
8. **Payload 8 — Immutable `ownerId` / `createdAt` Transfer on Update**:
   Attempting to mutate `ownerId` or `createdAt` during an `update` -> Rejected (`incoming().ownerId == existing().ownerId` and `affectedKeys().hasOnly(...)` fail).
9. **Payload 9 — Terminal State Bypass (`Disposed` Asset Mutation)**:
   Attempting to update `currentValuation` or `status` on an asset whose `existing().status == "Disposed"` -> Rejected (`existing().status != 'Disposed'` fails).
10. **Payload 10 — Orphaned Subcollection Event Write**:
    Creating `/assets/non-existent-asset/events/evt-1` where parent asset does not exist or belongs to another user -> Rejected (`getAfter(...)` Master Gate fails).
11. **Payload 11 — Audit Log Tampering (Event Update)**:
    Attempting `updateDoc` on `/assets/{assetId}/events/{eventId}` -> Rejected (`allow update: if false`).
12. **Payload 12 — Unauthorized Blanket `list` Scraping**:
    Authenticated user executing `getDocs(collection(db, 'assets'))` without `where('ownerId', '==', uid)` -> Rejected (`resource.data.ownerId == request.auth.uid` fails).
