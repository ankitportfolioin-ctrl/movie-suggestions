import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceHardConstraints, GateConstraints, normalizeCert } from '../server/gate.js';

function base(): GateConstraints {
  return {
    maxMinutes: Infinity, maxRuntimeLabel: 'Any length', langCodes: [],
    highlyRated: false, recent: false, classics: false,
    audience: 'Just me', matureAllowed: false,
  };
}

function movie(over: Record<string, unknown> = {}) {
  return {
    id: 1, title: 'Test Film', year: 2020, genres: ['Comedy'], runtime: 90,
    rating: 7.5, language: 'en', certificate: 'PG', isMature: false,
    ...over,
  };
}

test('runtime: over-cap dropped with notice; unknown runtime fails a finite cap', () => {
  const r = enforceHardConstraints(
    [movie({ id: 1, runtime: 187 }), movie({ id: 2, runtime: 90 }), movie({ id: 3, runtime: 0 })],
    { ...base(), maxMinutes: 150, maxRuntimeLabel: 'Under 2.5 hours' }
  );
  assert.deepEqual(r.movies.map((m) => m.id), [2]);
  assert.ok(r.relaxed.some((n) => n.includes('Under 2.5 hours')));
});

test('runtime: unknown runtime passes when no cap is set', () => {
  const r = enforceHardConstraints([movie({ runtime: 0 })], base());
  assert.equal(r.movies.length, 1);
});

test('language: mismatch dropped; Any passes everything', () => {
  const hi = movie({ id: 1, language: 'hi' });
  const en = movie({ id: 2, language: 'en' });
  const r = enforceHardConstraints([hi, en], { ...base(), langCodes: ['hi'] });
  assert.deepEqual(r.movies.map((m) => m.id), [1]);
  assert.ok(r.relaxed.some((n) => n.includes('another language')));
});

test('rating floor enforced only when Highly rated is on', () => {
  const low = movie({ rating: 6.5 });
  assert.equal(enforceHardConstraints([low], { ...base(), highlyRated: true }).movies.length, 0);
  assert.equal(enforceHardConstraints([low], base()).movies.length, 1);
});

test('recent keeps 2021+, drops 2020; classics keeps pre-2000 only', () => {
  const y = (year: number, id: number) => movie({ id, year });
  const r = enforceHardConstraints([y(2021, 1), y(2020, 2)], { ...base(), recent: true });
  assert.deepEqual(r.movies.map((m) => m.id), [1]);
  const c = enforceHardConstraints([y(1999, 1), y(2000, 2)], { ...base(), classics: true });
  assert.deepEqual(c.movies.map((m) => m.id), [1]);
});

test('mature certs dropped when mature OFF (standard audience)', () => {
  const films = ['R', 'NC-17', 'TV-MA', 'X', 'A', '18', '18+'].map((c, i) =>
    movie({ id: i + 1, certificate: c, isMature: false })
  );
  const r = enforceHardConstraints(films, base());
  assert.equal(r.movies.length, 0);
  assert.ok(r.relaxed.some((n) => n.includes('adult ratings')));
});

test('certificate wins over a contradicting catalog flag', () => {
  // Flag says mature but cert is PG → kept (cert wins).
  const r = enforceHardConstraints([movie({ certificate: 'PG', isMature: true })], base());
  assert.equal(r.movies.length, 1);
});

test('family allows only G/PG/TV-G/TV-Y/TV-Y7/TV-PG/U with Family/Animation genres; unknown excluded', () => {
  const mk = (certificate: string | undefined, id: number, isMature = false) =>
    movie({ id, certificate, isMature, genres: ['Family'] });
  const fam = { ...base(), audience: 'Family with kids' };
  for (const c of ['G', 'PG', 'TV-G', 'TV-Y', 'TV-Y7', 'TV-PG', 'U']) {
    assert.equal(enforceHardConstraints([mk(c, 1)], fam).movies.length, 1, c);
  }
  for (const c of ['PG-13', 'R', 'TV-MA', 'TV-14', '', 'Not Rated']) {
    assert.equal(enforceHardConstraints([mk(c, 1)], fam).movies.length, 0, String(c));
  }
  // Unknown minAge without a Family/Animation genre fails closed, even with a safe cert.
  assert.equal(enforceHardConstraints([movie({ id: 9, certificate: 'G', genres: ['Comedy'] })], fam).movies.length, 0);
  // Horror/Crime/Thriller never passes Family on unknown minAge.
  assert.equal(enforceHardConstraints([movie({ id: 10, certificate: 'G', genres: ['Animation', 'Horror'] })], fam).movies.length, 0);
});

test('family allows minAge <= 6, drops minAge 12+', () => {
  const fam = { ...base(), audience: 'Family with kids' };
  assert.equal(enforceHardConstraints([movie({ id: 1, minAge: 0 })], fam).movies.length, 1);
  assert.equal(enforceHardConstraints([movie({ id: 2, minAge: 6 })], fam).movies.length, 1);
  assert.equal(enforceHardConstraints([movie({ id: 3, minAge: 12 })], fam).movies.length, 0);
  assert.equal(enforceHardConstraints([movie({ id: 4, minAge: 18 })], fam).movies.length, 0);
});

test('mature OFF excludes minAge >= 16 even with a benign certificate', () => {
  assert.equal(enforceHardConstraints([movie({ id: 1, certificate: 'PG', minAge: 16 })], base()).movies.length, 0);
  assert.equal(enforceHardConstraints([movie({ id: 2, certificate: '12', minAge: 18 })], base()).movies.length, 0);
  assert.equal(enforceHardConstraints([movie({ id: 3, certificate: 'PG-13', minAge: 12 })], base()).movies.length, 1);
  assert.equal(enforceHardConstraints([movie({ id: 4, certificate: 'U', minAge: 0 })], base()).movies.length, 1);
});

test('mature OFF drops R, UK-15 and TV-MA titles', () => {
  const films = [
    movie({ id: 1, certificate: 'R', minAge: 16 }), // US R
    movie({ id: 2, certificate: '15', minAge: 16 }), // UK 15
    movie({ id: 3, certificate: 'TV-MA' }), // unknown age: certificate fallback still excludes
  ];
  const r = enforceHardConstraints(films, base());
  assert.equal(r.movies.length, 0);
  assert.ok(r.relaxed.some((n) => n.includes('adult ratings')));
});

test('PG-13 passes standard mature-OFF; unknown cert allowed with flag fallback', () => {
  assert.equal(enforceHardConstraints([movie({ certificate: 'PG-13' })], base()).movies.length, 1);
  // Unknown cert + mature flag set → still excluded (conservative fallback).
  assert.equal(enforceHardConstraints([movie({ certificate: '', isMature: true })], base()).movies.length, 0);
});

test('non-movie types dropped; duplicates removed by id and title+year', () => {
  const r = enforceHardConstraints(
    [
      movie({ id: 1 }),
      movie({ id: 1 }),
      movie({ id: 2, title: 'Other Film', year: 2021 }),
      movie({ id: 3, mediaType: 'tv' }),
    ],
    base()
  );
  assert.deepEqual(r.movies.map((m) => m.id), [1, 2]);
  assert.ok(r.relaxed.some((n) => n.includes('non-movie')));
});

test('emptied list adds guidance notice', () => {
  const r = enforceHardConstraints([movie({ runtime: 200 })], { ...base(), maxMinutes: 90, maxRuntimeLabel: 'Under 90 min' });
  assert.equal(r.movies.length, 0);
  assert.ok(r.relaxed.some((n) => n.includes('Nothing left')));
});

test('normalizeCert handles variants', () => {
  assert.equal(normalizeCert('r'), 'R');
  assert.equal(normalizeCert(' tv-ma '), 'TV-MA');
  assert.equal(normalizeCert('Not Rated'), '');
  assert.equal(normalizeCert('N/A'), '');
  assert.equal(normalizeCert(undefined), '');
});
