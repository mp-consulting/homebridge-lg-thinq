/* eslint-disable dot-notation */
import { vi } from 'vitest';
import axios from 'axios';
import { API } from '../../src/api/API.js';
import type { Logger } from 'homebridge';

describe('API', () => {
  let api: API;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    api = new API('EC', 'en-US', mockLogger);
  });

  test('should initialize with default values', () => {
    expect(api).toBeDefined();
    expect(api.client_id).toBeUndefined();
    expect(api.httpClient).toBeDefined();
  });

  test('should set username and password', () => {
    api.setUsernamePassword('testUser', 'testPass');
    expect(api['username']).toBe('testUser');
    expect(api['password']).toBe('testPass');
  });

  test('should set refresh token', () => {
    api.setRefreshToken('testRefreshToken');
    expect(api['session'].refreshToken).toBe('testRefreshToken');
  });

  test('should handle device list retrieval', async () => {
    const mockHomes = [{ homeId: 'home1' }];
    const mockDevices = [{ id: 'device1' }, { id: 'device2' }];

    vi.spyOn(api, 'getListHomes').mockResolvedValueOnce(mockHomes);
    vi.spyOn(api.httpClient, 'request').mockResolvedValueOnce({
      data: { result: { devices: mockDevices } },
    });

    const devices = await api.getListDevices();
    expect(devices).toEqual(mockDevices);
  });

  test('should send command to device', async () => {
    const mockRequest = vi.spyOn(api.httpClient, 'request').mockResolvedValueOnce({ data: { success: true } });

    const result = await api.sendCommandToDevice('device1', { key: 'value' }, 'Set');
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: expect.stringContaining('/devices/device1/control-sync'),
        data: expect.objectContaining({
          ctrlKey: 'basicCtrl',
          command: 'Set',
          key: 'value',
        }),
      }),
    );
    expect(result).toEqual({ success: true });
  });

  describe('quiet flag', () => {
    // Stub gateway() so request() can resolve a URL without hitting the network.
    beforeEach(() => {
      vi.spyOn(api, 'gateway').mockResolvedValue({
        thinq1_url: 'https://thinq1.example/',
        thinq2_url: 'https://thinq2.example/',
      } as never);
    });

    test('logs axios failures at error level by default', async () => {
      const axiosErr = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { status: 400, data: { resultCode: '9006', result: '' } },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      vi.spyOn(api.httpClient, 'request').mockRejectedValueOnce(axiosErr);

      await api.sendCommandToDevice('device1', { dataKey: 'foo', dataValue: 1 }, 'Set');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'axios request error: ',
        { resultCode: '9006', result: '' },
        expect.any(Object),
      );
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        'axios request error: ',
        expect.anything(),
        expect.anything(),
      );
    });

    test('demotes axios failures to debug when quiet', async () => {
      const axiosErr = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: { status: 400, data: { resultCode: '9006', result: '' } },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
      vi.spyOn(api.httpClient, 'request').mockRejectedValueOnce(axiosErr);

      await api.sendCommandToDevice(
        'device1',
        { dataKey: 'airState.mon.timeout', dataValue: 70 },
        'Set',
        'allEventEnable',
        'control',
        { quiet: true },
      );

      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'axios request error: ',
        expect.anything(),
        expect.anything(),
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'axios request error: ',
        { resultCode: '9006', result: '' },
        expect.any(Object),
      );
    });
  });

  describe('rate limiting (HTTP 429 / resultCode 9012)', () => {
    beforeEach(() => {
      // Stub gateway() so request() can resolve a URL without hitting the network.
      vi.spyOn(api, 'gateway').mockResolvedValue({
        thinq1_url: 'https://thinq1.example/',
        thinq2_url: 'https://thinq2.example/',
      } as never);
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const rateLimitError = () => Object.assign(new Error('Request failed with status code 429'), {
      isAxiosError: true,
      response: { status: 429, data: { resultCode: '9012', result: '' } },
    });

    test('opens a cooldown on 429 and skips subsequent requests', async () => {
      const request = vi.spyOn(api.httpClient, 'request').mockRejectedValueOnce(rateLimitError());

      const first = await api.getRequest('service/homes');
      expect(first).toEqual({});
      expect(api.isRateLimited()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit'));

      // While in cooldown, no network request is attempted.
      request.mockClear();
      const second = await api.getRequest('service/homes');
      expect(request).not.toHaveBeenCalled();
      expect(second).toEqual({});
    });

    test('treats resultCode 9012 as rate limited even without a 429 status', async () => {
      vi.spyOn(api.httpClient, 'request').mockRejectedValueOnce(
        Object.assign(new Error('9012'), {
          isAxiosError: true,
          response: { status: 400, data: { resultCode: '9012' } },
        }),
      );

      await api.getRequest('service/homes');
      expect(api.isRateLimited()).toBe(true);
    });

    test('suppresses the noisy axios stack while rate limited', async () => {
      vi.spyOn(api.httpClient, 'request').mockRejectedValueOnce(rateLimitError());

      await api.getRequest('service/homes');
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'axios request error: ',
        expect.anything(),
        expect.anything(),
      );
    });

    test('clears the cooldown after a later successful request', async () => {
      vi.spyOn(api.httpClient, 'request')
        .mockRejectedValueOnce(rateLimitError())
        .mockResolvedValueOnce({ data: { ok: true } });

      await api.getRequest('service/homes');
      expect(api.isRateLimited()).toBe(true);

      // Simulate the cooldown expiring; the next success resets the backoff.
      api['rateLimitedUntil'] = 0;
      const res = await api.getRequest('service/homes');
      expect(res).toEqual({ ok: true });
      expect(api.isRateLimited()).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('rate limit cleared'));
    });
  });

  describe('resilience to empty/failed responses', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('getListDevices returns [] when a home response has no result', async () => {
      vi.spyOn(api, 'getListHomes').mockResolvedValueOnce([{ homeId: 'home1' }] as never);
      vi.spyOn(api, 'gateway').mockResolvedValue({
        thinq1_url: 'https://thinq1.example/',
        thinq2_url: 'https://thinq2.example/',
      } as never);
      vi.spyOn(api.httpClient, 'request').mockResolvedValueOnce({ data: {} });

      const devices = await api.getListDevices();
      expect(devices).toEqual([]);
    });

    test('getListHomes does not permanently cache an empty response', async () => {
      vi.spyOn(api, 'gateway').mockResolvedValue({
        thinq1_url: 'https://thinq1.example/',
        thinq2_url: 'https://thinq2.example/',
      } as never);
      const request = vi.spyOn(api.httpClient, 'request')
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { result: { item: [{ homeId: 'h1' }] } } });

      expect(await api.getListHomes()).toEqual([]);
      expect(await api.getListHomes()).toEqual([{ homeId: 'h1' }]);
      expect(request).toHaveBeenCalledTimes(2);
    });
  });
});
