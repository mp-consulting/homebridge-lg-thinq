import { vi } from 'vitest';
import type { AxiosAdapter, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { requestClient } from '../../src/api/request.js';
import { TokenExpiredError, NotConnectedError } from '../../src/errors/index.js';

const okAdapter: AxiosAdapter = async (config) => ({
  data: { ok: true },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
}) as AxiosResponse;

function rejectWithStatus(status: number): AxiosAdapter {
  return async (config) => {
    const err = new Error('Request failed with status ' + status) as AxiosError;
    err.config = config as InternalAxiosRequestConfig;
    err.response = {
      status,
      statusText: 'Error',
      data: {},
      headers: {},
      config: config as InternalAxiosRequestConfig,
    };
    throw err;
  };
}

const networkFailureAdapter: AxiosAdapter = async () => {
  const err = new Error('Network down') as AxiosError;
  err.code = 'ECONNABORTED';
  throw err;
};

describe('requestClient pending-request mutex', () => {
  const originalAdapter = requestClient.defaults.adapter;

  afterEach(() => {
    requestClient.defaults.adapter = originalAdapter;
    vi.useRealTimers();
  });

  test('releases the slot after a 401 so the recovery request can proceed', async () => {
    requestClient.defaults.adapter = rejectWithStatus(401);
    await expect(requestClient.get('https://example.invalid/first'))
      .rejects.toBeInstanceOf(TokenExpiredError);

    requestClient.defaults.adapter = okAdapter;
    const res = await requestClient.get('https://example.invalid/second');
    expect(res.data).toEqual({ ok: true });
  }, 2000);

  test('releases the slot after a 403', async () => {
    requestClient.defaults.adapter = rejectWithStatus(403);
    await expect(requestClient.get('https://example.invalid/first'))
      .rejects.toBeInstanceOf(TokenExpiredError);

    requestClient.defaults.adapter = okAdapter;
    const res = await requestClient.get('https://example.invalid/second');
    expect(res.data).toEqual({ ok: true });
  }, 2000);

  test('releases the slot after a network-level failure mapped to NotConnectedError', async () => {
    requestClient.defaults.adapter = networkFailureAdapter;
    await expect(requestClient.get('https://example.invalid/first'))
      .rejects.toBeInstanceOf(NotConnectedError);

    requestClient.defaults.adapter = okAdapter;
    const res = await requestClient.get('https://example.invalid/second');
    expect(res.data).toEqual({ ok: true });
  }, 10000);
});
