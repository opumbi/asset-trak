import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

/**
 * Phase 0 TDD Security Test Suite — Asset Track
 * Verifies all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED
 * and legitimate verified-owner operations succeed.
 */
export async function runSecurityRulesSuite() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'demo-asset-track-security',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  const aliceCtx = testEnv.authenticatedContext('alice_uid_01', {
    email: 'alice@enterprise.com',
    email_verified: true,
  });
  const unverifiedCtx = testEnv.authenticatedContext('alice_uid_01', {
    email: 'alice@enterprise.com',
    email_verified: false,
  });
  const malloryCtx = testEnv.authenticatedContext('mallory_uid_99', {
    email: 'mallory@attacker.org',
    email_verified: true,
  });

  const baseAsset = {
    assetId: 'asset_001',
    ownerId: 'alice_uid_01',
    name: 'Dell Precision 5680 Workstation',
    serialNumber: 'DL-5680-9921',
    category: 'IT Hardware',
    purchasePrice: 3200,
    currentValuation: 2850,
    purchaseDate: '2026-10-05',
    warrantyExpiry: '2029-10-05',
    status: 'In Use',
    department: 'Engineering',
    location: 'Floor 4 · Desk 12',
    assignedTo: 'Alice Vance',
    notes: 'Primary CAD & ML workstation',
    photoUrl: 'https://firebasestorage.googleapis.com/v0/b/example/o/laptop.jpg',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    // Legitimate baseline creation succeeds
    const aliceDb = aliceCtx.firestore();
    await assertSucceeds(setDoc(doc(aliceDb, 'assets', 'asset_001'), baseAsset));

    // Dirty Dozen #1: Identity Spoofing on Asset Create
    const malloryDb = malloryCtx.firestore();
    await assertFails(
      setDoc(doc(malloryDb, 'assets', 'asset_spoof'), {
        ...baseAsset,
        assetId: 'asset_spoof',
        ownerId: 'alice_uid_01',
      })
    );

    // Dirty Dozen #2: Unverified Email Spoof Attack
    const unverifiedDb = unverifiedCtx.firestore();
    await assertFails(
      setDoc(doc(unverifiedDb, 'assets', 'asset_unverified'), {
        ...baseAsset,
        assetId: 'asset_unverified',
      })
    );

    // Dirty Dozen #3: Shadow Field Injection on Create
    await assertFails(
      setDoc(doc(aliceDb, 'assets', 'asset_shadow'), {
        ...baseAsset,
        assetId: 'asset_shadow',
        isSuperAdmin: true,
      })
    );

    // Dirty Dozen #4: Shadow Field / Update-Gap on Asset Update
    await assertFails(
      updateDoc(doc(aliceDb, 'assets', 'asset_001'), {
        status: 'Maintenance',
        shadowFlag: 'injected',
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #5: Path ID Poisoning (mismatched payload assetId vs path)
    await assertFails(
      setDoc(doc(aliceDb, 'assets', 'asset_mismatch'), {
        ...baseAsset,
        assetId: 'different_id',
      })
    );

    // Dirty Dozen #6: Denial-of-Wallet Oversized String
    await assertFails(
      updateDoc(doc(aliceDb, 'assets', 'asset_001'), {
        currentValuation: 2800,
        notes: 'X'.repeat(2500),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #7: Client Timestamp Forgery
    await assertFails(
      setDoc(doc(aliceDb, 'assets', 'asset_forged_time'), {
        ...baseAsset,
        assetId: 'asset_forged_time',
        createdAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #8: Immutable ownerId Transfer on Update
    await assertFails(
      updateDoc(doc(aliceDb, 'assets', 'asset_001'), {
        ownerId: 'mallory_uid_99',
        updatedAt: serverTimestamp(),
      })
    );

    // Transition to Disposed (valid terminal transition)
    await assertSucceeds(
      updateDoc(doc(aliceDb, 'assets', 'asset_001'), {
        status: 'Disposed',
        assignedTo: '',
        location: 'Archive Vault',
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #9: Terminal State Bypass (Mutating Disposed Asset)
    await assertFails(
      updateDoc(doc(aliceDb, 'assets', 'asset_001'), {
        currentValuation: 99999,
        notes: 'Reviving disposed asset',
        updatedAt: serverTimestamp(),
      })
    );

    // Dirty Dozen #10: Orphaned Subcollection Event Write
    await assertFails(
      setDoc(doc(aliceDb, 'assets', 'non_existent_asset', 'events', 'evt_01'), {
        eventId: 'evt_01',
        assetId: 'non_existent_asset',
        ownerId: 'alice_uid_01',
        action: 'Asset Registered',
        summary: 'Orphan event',
        actorEmail: 'alice@enterprise.com',
        createdAt: serverTimestamp(),
      })
    );

    // Valid Event Creation on existing owned asset
    const batch = writeBatch(aliceDb);
    batch.set(doc(aliceDb, 'assets', 'asset_001', 'events', 'evt_valid'), {
      eventId: 'evt_valid',
      assetId: 'asset_001',
      ownerId: 'alice_uid_01',
      action: 'Asset Registered',
      summary: 'Registered Dell Precision 5680',
      actorEmail: 'alice@enterprise.com',
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    // Dirty Dozen #11: Audit Log Tampering (Updating an Event)
    await assertFails(
      updateDoc(doc(aliceDb, 'assets', 'asset_001', 'events', 'evt_valid'), {
        summary: 'Tampered history entry',
      })
    );

    // Dirty Dozen #12: Unauthorized Blanket list Scraping
    await assertFails(getDocs(collection(malloryDb, 'assets')));
    // Valid scoped list query succeeds
    await assertSucceeds(
      getDocs(query(collection(aliceDb, 'assets'), where('ownerId', '==', 'alice_uid_01')))
    );
  } finally {
    await testEnv.cleanup();
  }
}
