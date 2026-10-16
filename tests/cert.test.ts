import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CERT_MIN_AGE, certToMinAge, releaseInfo, storedCertAge } from '../scripts/ingest-tmdb.mjs';

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

  test('disagreement across countries stores the HIGHEST minAge', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'IN', release_dates: [{ certification: 'U' }] },
          { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
        ],
      },
    };
    assert.deepEqual(releaseInfo(details), { certificate: 'R', minAge: 16 });
  });

  test('disagreement picks highest even when listed in reverse order', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'DE', release_dates: [{ certification: 'FSK 18' }] },
          { iso_3166_1: 'GB', release_dates: [{ certification: 'PG' }] },
        ],
      },
    };
    assert.deepEqual(releaseInfo(details), { certificate: 'FSK 18', minAge: 18 });
  });

  test('agreement keeps the shared age with a raw certificate', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] },
          { iso_3166_1: 'AU', release_dates: [{ certification: 'G' }] },
        ],
      },
    };
    // US PG -> 6 beats AU G -> 0, so PG wins.
    assert.deepEqual(releaseInfo(details), { certificate: 'PG', minAge: 6 });
  });

  test('no usable release dates gives empty certificate and null minAge', () => {
    assert.deepEqual(releaseInfo({}), { certificate: '', minAge: null });
    assert.deepEqual(releaseInfo({ release_dates: { results: [] } }), { certificate: '', minAge: null });
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
  });
});
