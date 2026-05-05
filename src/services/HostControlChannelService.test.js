import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock('../api/supabaseClient.js', () => ({
  supabase: mockSupabase,
}));

import { HostControlChannelService } from './HostControlChannelService.js';

describe('HostControlChannelService connect handshake', () => {
  let statusHandler = null;
  let channel = null;

  beforeEach(() => {
    statusHandler = null;
    channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb) => {
        statusHandler = cb;
        return channel;
      }),
      httpSend: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
    };
    mockSupabase.channel.mockReset();
    mockSupabase.removeChannel.mockReset();
    mockSupabase.channel.mockImplementation(() => channel);
  });

  it('waits for SUBSCRIBED before sending broadcast payload', async () => {
    const service = new HostControlChannelService({ gameId: 'game-1', role: 'host' });
    const sendPromise = service.send('modal_sync_request', {});

    await Promise.resolve();
    expect(channel.send).not.toHaveBeenCalled();

    statusHandler?.('SUBSCRIBED');
    const sent = await sendPromise;

    expect(sent).toBe(true);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'host-command',
      payload: expect.objectContaining({
        type: 'modal_sync_request',
        senderRole: 'host',
      }),
    });
  });

  it('returns false on transient subscribe failure instead of throwing', async () => {
    const service = new HostControlChannelService({ gameId: 'game-1', role: 'controller' });
    const sendPromise = service.send('host_runtime_state_request', {});

    await Promise.resolve();
    statusHandler?.('CHANNEL_ERROR');
    const sent = await sendPromise;

    expect(sent).toBe(false);
    expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(1);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('cleans up channel once when CLOSED is emitted multiple times', async () => {
    const service = new HostControlChannelService({ gameId: 'game-1', role: 'host' });
    const connectPromise = service.connect();

    await Promise.resolve();
    statusHandler?.('SUBSCRIBED');
    await connectPromise;

    statusHandler?.('CLOSED');
    statusHandler?.('CLOSED');

    expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
