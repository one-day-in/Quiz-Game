import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('./supabaseClient.js', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

describe('authApi.isAuthorized', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses the current-user access RPC without querying allowlist tables', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ authorized: true, role: 'host' }],
      error: null,
    });
    const { isAuthorized } = await import('./authApi.js');

    await expect(isAuthorized({ id: 'user-1', email: 'private@example.com' })).resolves.toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('get_current_user_access');
  });

  it('fails closed when the authenticated user has no enabled role', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ authorized: false, role: null }],
      error: null,
    });
    const { isAuthorized } = await import('./authApi.js');

    await expect(isAuthorized({ id: 'user-2' })).resolves.toBe(false);
  });

  it('returns the current application role without exposing allowlist data', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ authorized: true, role: 'admin' }],
      error: null,
    });
    const { getCurrentUserAccess } = await import('./authApi.js');

    await expect(getCurrentUserAccess({ id: 'user-3' })).resolves.toEqual({
      authorized: true,
      role: 'admin',
    });
  });
});
