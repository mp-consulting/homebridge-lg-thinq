/* eslint-disable dot-notation */
import { vi } from 'vitest';
import { Auth } from '../../src/api/Auth.js';
import { Gateway } from '../../src/api/Gateway.js';
import { Session } from '../../src/api/Session.js';
import type { Logger } from 'homebridge';
import { AuthenticationError } from '../../src/errors/index.js';

describe('Auth', () => {
  let auth: Auth;
  let mockGateway: Gateway;
  let mockLogger: Logger;

  beforeEach(() => {
    mockGateway = new Gateway({
      empTermsUri: 'https://example.com/emp',
      empSpxUri: 'https://example.com/spx',
      thinq2Uri: 'https://example.com/thinq2',
      thinq1Uri: 'https://example.com/thinq1',
      countryCode: 'US',
      languageCode: 'en-US',
    });

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    auth = new Auth(mockGateway, mockLogger);
  });

  test('should initialize with correct API URL', () => {
    expect(auth.lgeapi_url).toBe('https://us.lgeapi.com/');
  });

  test('should generate default EMP headers', () => {
    const headers = auth.defaultEmpHeaders;
    expect(headers['X-Device-Country']).toBe('US');
    expect(headers['X-Device-Language']).toBe('en-US');
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=UTF-8');
  });

  test('should login and return a session', async () => {
    const mockSession = new Session('accessToken', 'refreshToken', Date.now() + 3600 * 1000);
    vi.spyOn(auth, 'loginStep2').mockResolvedValueOnce(mockSession);

    const session = await auth.login('testUser', 'testPassword');
    expect(session).toBe(mockSession);
    expect(auth.loginStep2).toHaveBeenCalledWith('testUser', expect.any(String));
  });

  test('should handle loginStep2 and return a session', async () => {
    const mockPreLoginResponse = {
      signature: 'mockSignature',
      tStamp: 'mockTimestamp',
      encrypted_pw: 'mockEncryptedPassword',
    };
    const mockAccountResponse = {
      account: {
        userIDType: 'EMP',
        country: 'US',
        userID: 'testUser',
        loginSessionID: 'session123',
      },
    };
    const mockSecretKeyResponse = { returnData: 'mockSecretKey' };
    const mockAuthorizeResponse = {
      status: 1,
      redirect_uri: 'https://example.com/oauth?code=mockCode',
    };
    const mockTokenResponse = {
      access_token: 'accessToken',
      refresh_token: 'refreshToken',
      expires_in: 3600,
      oauth2_backend_url: 'https://example.com/oauth',
    };

    vi.spyOn(auth['gateway'], 'emp_base_url', 'get').mockReturnValue('https://example.com/emp/');
    vi.spyOn(auth['gateway'], 'login_base_url', 'get').mockReturnValue('https://example.com/spx/');
    vi.spyOn(auth['gateway'], 'country_code', 'get').mockReturnValue('US');
    vi.spyOn(auth['gateway'], 'language_code', 'get').mockReturnValue('en-US');

    const { requestClient } = await import('../../src/api/request.js');
    vi.spyOn(requestClient, 'post')
      .mockResolvedValueOnce({ data: mockPreLoginResponse }) // Mock preLogin response
      .mockResolvedValueOnce({ data: mockAccountResponse }) // Mock account response
      .mockResolvedValueOnce({ data: mockTokenResponse }); // Mock token response

    vi.spyOn(requestClient, 'get')
      .mockResolvedValueOnce({ data: mockSecretKeyResponse }) // Mock secret key response
      .mockResolvedValueOnce({ data: mockAuthorizeResponse }); // Mock authorize response

    const session = await auth.loginStep2('testUser', 'mockEncryptedPassword');
    expect(session).toBeInstanceOf(Session);
    expect(session.accessToken).toBe('accessToken');
    expect(session.refreshToken).toBe('refreshToken');
  });

  test('should throw AuthenticationError for invalid login', async () => {
    const mockErrorResponse = {
      response: {
        data: {
          error: {
            code: 'MS.001.03',
            message: 'Account already registered.',
          },
        },
      },
    };
    const mockPreLoginResponse = {
      signature: 'mockSignature',
      tStamp: 'mockTimestamp',
      encrypted_pw: 'mockEncryptedPassword',
    };
    const { requestClient } = await import('../../src/api/request.js');
    vi.spyOn(requestClient, 'post')
      .mockResolvedValueOnce({ data: mockPreLoginResponse }) // Mock preLogin response
      .mockRejectedValueOnce(mockErrorResponse);

    await expect(auth.loginStep2('testUser', 'mockEncryptedPassword')).rejects.toThrow(AuthenticationError);
  });

});
