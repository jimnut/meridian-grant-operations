import { describe, expect, it } from 'vitest';

import { secureMeasurementCookie } from '../../server/lib/measurement-cookie';

describe('measurement cookie transport', () => {
  it('keeps explicitly configured local HTTP development usable', () => {
    expect(secureMeasurementCookie({ secure: false }, { isProduction: false, appUrl: 'http://localhost:5173' })).toBe(false);
  });

  it('requires Secure on an HTTPS deployment even when demo mode is not production', () => {
    expect(secureMeasurementCookie({ secure: false }, { isProduction: false, appUrl: 'https://grantconsole.com' })).toBe(true);
  });

  it('requires Secure when Express identifies a trusted HTTPS request', () => {
    expect(secureMeasurementCookie({ secure: true }, { isProduction: false, appUrl: 'http://localhost:5173' })).toBe(true);
  });

  it('always requires Secure in production', () => {
    expect(secureMeasurementCookie({ secure: false }, { isProduction: true, appUrl: 'http://localhost:5173' })).toBe(true);
  });
});
