import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CERT_MIN_AGE, certToMinAge, releaseAges, storedCertAge } from '../scripts/ingest-tmdb.mjs';

const COUNTRIES = ['US', 'IN', 'GB', 'DE', 'FR', 'KR', 'JP', 'BR', 'AU', 'ES',
  'IT', 'RU', 'CA', 'MX', 'TR', 'NL', 'SE', 'PL', 'TH', 'ID', 'SG', 'ZA'];

describe('certificate mapping', () => {
  test('mapping table covers all required countries', () => {
    const table = CERT_MIN_AGE as Record<string, Record<string, number>>;
    for (const c of COUNTRIES) assert.ok(table[c], `missing country ${c}`);
  });

  test('mapping values are only 0, 6, 12, 16 or 18', () => {
    const table = CERT_MIN_AGE as Record<string, Record<string, number>>;
    for (const [c, certs] of Object.entries(table)) {
      for (const [cert, age] of Object.entries(certs)) {
        assert.ok([0, 6, 12, 16, 18].includes(age), `${c} ${cert} -> ${age}`);
      }
    }
  });

  test('spot checks per country', () => {
    assert.equal(certToMinAge('US', 'G'), 0);
    assert.equal(certToMinAge('US', 'PG-13'), 12);
    assert.equal(certToMinAge('US', 'R'), 16);
    assert.equal(certToMinAge('US', 'NC-17'), 18);
    assert.equal(certToMinAge('US', 'TV-MA'), 16);
    assert.equal(certToMinAge('US', 'TV-14'), 12);
    assert.equal(certToMinAge('IN', 'U'), 0);
    assert.equal(certToMinAge('IN', 'A'), 18);
    assert.equal(certToMinAge('GB', '15'), 16);
    assert.equal(certToMinAge('DE', 'FSK 12'), 12);
    assert.equal(certToMinAge('FR', '-12'), 12);
    assert.equal(certToMinAge('KR', '15'), 16);
    assert.equal(certToMinAge('JP', 'R18+'), 18);
    assert.equal(certToMinAge('BR', 'L'), 0);
    assert.equal(certToMinAge('AU', 'MA15+'), 16);
    assert.equal(certToMinAge('ES', '7'), 6);
    assert.equal(certToMinAge('IT', 'VM14'), 16);
    assert.equal(certToMinAge('RU', '18+'), 18);
    assert.equal(certToMinAge('CA', '14A'), 12);
    assert.equal(certToMinAge('MX', 'B-15'), 16);
    assert.equal(certToMinAge('TR', '6A'), 6);
    assert.equal(certToMinAge('NL', 'MG6'), 6);
    assert.equal(certToMinAge('SE', '11'), 12);
    assert.equal(certToMinAge('PL', 'BO'), 0);
    assert.equal(certToMinAge('TH', '18'), 18);
    assert.equal(certToMinAge('ID', 'SU'), 0);
    assert.equal(certToMinAge('SG', 'NC16'), 16);
    assert.equal(certToMinAge('ZA', '10-12PG'), 12);
  });

  test('empty and unknown certificates map to null', () => {
    assert.equal(certToMinAge('US', ''), null);
    assert.equal(certToMinAge('US', '   '), null);
    assert.equal(certToMinAge('US', 'ZZZ-no-such-rating'), null);
  });

  test('median across countries; IN-A vs US-R shows per-country mapping', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'IN', release_dates: [{ certification: 'A' }] },
          { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
        ],
      },
    };
    assert.deepEqual(releaseAges(details), {
      certificate: 'A', minAge: 18, minAgeStrict: 18, adultVotes: 1,
      certByCountry: { IN: 'A', US: 'R' },
    });
  });

  test('DE 18 lifts a low median to the 16 floor; strict stays highest', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'DE', release_dates: [{ certification: 'FSK 18' }] },
          { iso_3166_1: 'GB', release_dates: [{ certification: 'PG' }] },
        ],
      },
    };
    // ages [18, 6]: median 12, DE >= 16 floors minAge to 16.
    assert.deepEqual(releaseAges(details), {
      certificate: 'FSK 18', minAge: 16, minAgeStrict: 18, adultVotes: 1,
      certByCountry: { DE: 'FSK 18', GB: 'PG' },
    });
  });

  test('even-count median snaps up; MX-A maps to 0, not IN-18', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'MX', release_dates: [{ certification: 'A' }] },
          { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
        ],
      },
    };
    // ages [0, 12]: median 6.
    assert.deepEqual(releaseAges(details), {
      certificate: 'PG-13', minAge: 6, minAgeStrict: 12, adultVotes: 0,
      certByCountry: { MX: 'A', US: 'PG-13' },
    });
  });

  test('median 14 snaps up to 16; adultVotes counts 18s', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
          { iso_3166_1: 'KR', release_dates: [{ certification: '15' }] },
          { iso_3166_1: 'FR', release_dates: [{ certification: '18' }] },
          { iso_3166_1: 'JP', release_dates: [{ certification: 'R18+' }] },
        ],
      },
    };
    // ages [12, 16, 18, 18]: median 17 -> 18, strict 18, two 18s.
    const got = releaseAges(details);
    assert.equal(got.minAge, 18);
    assert.equal(got.minAgeStrict, 18);
    assert.equal(got.adultVotes, 2);
  });

  test('no usable release dates gives nulls and an empty country map', () => {
    assert.deepEqual(releaseAges({}), {
      certificate: '', minAge: null, minAgeStrict: null, adultVotes: 0, certByCountry: {},
    });
    assert.deepEqual(releaseAges({ release_dates: { results: [] } }), {
      certificate: '', minAge: null, minAgeStrict: null, adultVotes: 0, certByCountry: {},
    });
  });

  test('storedCertAge derives minAge from known US/IN/GB certificates', () => {
    assert.deepEqual(storedCertAge('R'), { certificate: 'R', minAge: 16 });
    assert.deepEqual(storedCertAge('UA'), { certificate: 'UA', minAge: 6 });
    assert.deepEqual(storedCertAge('15'), { certificate: '15', minAge: 16 });
    assert.deepEqual(storedCertAge('U'), { certificate: 'U', minAge: 0 });
    assert.deepEqual(storedCertAge('  pg-13 '), { certificate: 'pg-13', minAge: 12 });
    assert.equal(storedCertAge('ZZZ-no-such-rating'), null);
    assert.equal(storedCertAge(''), null);
    assert.equal(storedCertAge(null), null);
    // Bare "A" is ambiguous without a country (MX all-ages vs IN adult).
    assert.equal(storedCertAge('A'), null);
  });
});
