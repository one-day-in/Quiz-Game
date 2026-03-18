import { describe, expect, it } from 'vitest';
import { isGameDeleteAdminEmail, isGameDeleteAdminUser } from './adminAccess.js';

describe('adminAccess', () => {
  it('allows game deletion only for the configured admin email', () => {
    expect(isGameDeleteAdminEmail('skabullartem@gmail.com')).toBe(true);
    expect(isGameDeleteAdminEmail('SKABULLARTEM@GMAIL.COM')).toBe(true);
    expect(isGameDeleteAdminEmail('other@example.com')).toBe(false);
  });

  it('reads admin access from the current user email', () => {
    expect(isGameDeleteAdminUser({ email: 'skabullartem@gmail.com' })).toBe(true);
    expect(isGameDeleteAdminUser({ email: 'other@example.com' })).toBe(false);
    expect(isGameDeleteAdminUser(null)).toBe(false);
  });
});
