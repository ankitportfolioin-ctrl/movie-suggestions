import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MAX_EVENTS_PER_ANON_PER_DAY,
  _resetSecretForTests,
  anonOverDailyCap,
  buildContextKey,
  burstExceeded,
  countAnonEventsSince,
  deleteAnonData,
  findImpression,
  openLearningDb,
  recordEvent,
  recordImpressions,
  signImpression,
  validateEventBody,
  verifyImpression,
  type BurstSlot,
} from '../server/learning.js';

// Skip the whole suite when the optional SQLite addon isn't installed (the
// learning layer is disabled-on-Vercel and optional locally).
const sqliteAvailable = ((): boolean => {
  try {
    createRequire(import.meta.url)('better-sqlite3');
    return true;
  } catch {
    return false;
  }
})();
const skip = sqliteAvailable ? false : 'better-sqlite3 (optional dependency) is not installed';

function memDb() {
  process.env.LEARNING_HMAC_SECRET = 'test-secret-for-unit-tests-only';
  _resetSecretForTests();
  return openLearningDb(':memory:');
}

const IMP = {
  impressionId: 'imp-1',
  anonId: 'anon-abc',
  ts: Date.now(),
  contextKey: 'mood=Happy|aud=Just me',
  movieId: 862,
  slot: 0,
  rankPosition: 1,
  isExploration: 0,
  explorationProb: 0,
  scoreBreakdownJson: '{}',
  variant: 'control',
};

test('token roundtrips and binds anonId', { skip }, () => {
  memDb();
  const t = signImpression(IMP.impressionId, IMP.movieId, IMP.anonId);
  const v = verifyImpression(t, IMP.anonId);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.impressionId, IMP.impressionId);
    assert.equal(v.movieId, IMP.movieId);
  }
});

test('forged and expired tokens are rejected', { skip }, () => {
  memDb();
  const t = signImpression(IMP.impressionId, IMP.movieId, IMP.anonId);
  const forged = t.slice(0, -1) + (t.endsWith('0') ? '1' : '0');
  assert.equal(verifyImpression(forged, IMP.anonId).ok, false);
  const expired = signImpression(IMP.impressionId, IMP.movieId, IMP.anonId, Date.now() - 1000);
  const ev = verifyImpression(expired, IMP.anonId);
  assert.equal(ev.ok, false);
  if (!ev.ok) assert.equal(ev.reason, 'expired');
  const wrongAnon = verifyImpression(t, 'someone-else');
  assert.equal(wrongAnon.ok, false);
  if (!wrongAnon.ok) assert.equal(wrongAnon.reason, 'anon-mismatch');
});

test('event insert is idempotent by eventId', { skip }, () => {
  const db = memDb();
  recordImpressions(db, [IMP]);
  const evt = {
    eventId: 'evt-1',
    impressionId: IMP.impressionId,
    anonId: IMP.anonId,
    action: 'save',
    movieId: IMP.movieId,
    ts: Date.now(),
  };
  assert.equal(recordEvent(db, evt), 'stored');
  assert.equal(recordEvent(db, evt), 'duplicate');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
  assert.equal(n, 1);
});

test('unknown impression is detectable', { skip }, () => {
  const db = memDb();
  assert.equal(findImpression(db, 'nope'), null);
  recordImpressions(db, [IMP]);
  const found = findImpression(db, IMP.impressionId);
  assert.ok(found && found.movieId === IMP.movieId && found.anonId === IMP.anonId);
});

test('D-07: deleteAnonData removes only this anonId\'s rows', { skip }, () => {
  const db = memDb();
  recordImpressions(db, [IMP, { ...IMP, impressionId: 'imp-2', anonId: 'someone-else' }]);
  recordEvent(db, {
    eventId: 'evt-1', impressionId: IMP.impressionId, anonId: IMP.anonId,
    action: 'save', movieId: IMP.movieId, ts: Date.now(),
  });
  recordEvent(db, {
    eventId: 'evt-2', impressionId: 'imp-2', anonId: 'someone-else',
    action: 'save', movieId: IMP.movieId, ts: Date.now(),
  });

  const deleted = deleteAnonData(db, IMP.anonId);
  assert.deepEqual(deleted, { impressions: 1, events: 1 });
  assert.equal(findImpression(db, IMP.impressionId), null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events WHERE anonId = ?').get(IMP.anonId) as { n: number }).n, 0);
  // The other anonymous visitor's rows are untouched.
  assert.ok(findImpression(db, 'imp-2'));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events WHERE anonId = ?').get('someone-else') as { n: number }).n, 1);
});

test('event body validation rejects junk', { skip }, () => {
  assert.equal(validateEventBody(null).ok, false);
  assert.equal(validateEventBody({}).ok, false);
  const base = {
    eventId: 'e1',
    impressionId: 'i1',
    anonId: 'anon-abc',
    action: 'save',
    movieId: 5,
    token: 'x.y',
  };
  assert.equal(validateEventBody({ ...base, action: 'nuke' }).ok, false);
  assert.equal(validateEventBody({ ...base, anonId: 'has spaces!' }).ok, false);
  assert.equal(validateEventBody({ ...base, movieId: 1.5 }).ok, false);
  assert.equal(validateEventBody({ ...base, token: 42 }).ok, false);
});

test('contextKey never contains free text', { skip }, () => {
  const key = buildContextKey(
    {
      mood: 'Curious',
      genres: ['Mystery'],
      audience: 'Just me',
      maxRuntime: 'Any length',
      languages: ['Korean'],
      preferences: {},
      note: 'Loved Knives Out, nothing with Tom Cruise, gory stuff sucks',
      excludeIds: [],
    },
    'Loved Knives Out, nothing with Tom Cruise, gory stuff sucks'
  );
  assert.ok(!key.includes('Knives'), 'title leaked');
  assert.ok(!key.includes('Cruise'), 'person leaked');
  assert.ok(!key.includes('Loved'), 'note text leaked');
  assert.ok(key.includes('mood=Curious'));
});

test('daily per-anon cap trips at the limit', { skip }, () => {
  const db = memDb();
  const anon = 'anon-heavy';
  assert.equal(anonOverDailyCap(db, anon), false);
  const stmt = db.prepare(
    'INSERT INTO events (eventId, impressionId, anonId, ts, action, movieId) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < MAX_EVENTS_PER_ANON_PER_DAY; i++) {
      stmt.run(`e${i}`, 'imp-x', anon, Date.now(), 'save', 1);
    }
  });
  tx();
  assert.equal(countAnonEventsSince(db, anon, Date.now() - 24 * 3600 * 1000), MAX_EVENTS_PER_ANON_PER_DAY);
  assert.equal(anonOverDailyCap(db, anon), true);
});

test('burst gate trips and resets', { skip }, () => {
  const store = new Map<string, BurstSlot>();
  const now = Date.now();
  assert.equal(burstExceeded(store, 'k', 3, 60_000, now), false);
  assert.equal(burstExceeded(store, 'k', 3, 60_000, now), false);
  assert.equal(burstExceeded(store, 'k', 3, 60_000, now), false);
  assert.equal(burstExceeded(store, 'k', 3, 60_000, now + 1), true);
  assert.equal(burstExceeded(store, 'k', 3, 60_000, now + 61_000), false);
});
