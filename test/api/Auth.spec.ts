/* eslint-disable dot-notation */
import { vi } from 'vitest';
import { Auth } from '../../src/api/Auth.js';
import { Gateway } from '../../src/api/Gateway.js';
import { Session } from '../../src/api/Session.js';
import type { Logger } from 'homebridge';
import { AuthenticationError } from '../../src/errors/index.js';
import * as constants from '../../src/lib/constants.js';

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
    expect(headers['User-Agent']).toBe(constants.EMP_USER_AGENT);
  });

  test('should login through the lgemembers flow and return a session', async () => {
    const mockSession = new Session('accessToken', 'refreshToken', Date.now() + 3600 * 1000);
    vi.spyOn(auth, 'loginNew').mockResolvedValueOnce(mockSession);
    vi.spyOn(auth, 'loginStep2');

    const session = await auth.login('testUser', 'testPassword');
    expect(session).toBe(mockSession);
    expect(auth.loginNew).toHaveBeenCalledWith('testUser', expect.any(String));
    expect(auth.loginStep2).not.toHaveBeenCalled();
  });

  test('should fall back to the legacy EMP flow when lgemembers sign-in fails', async () => {
    const mockSession = new Session('accessToken', 'refreshToken', Date.now() + 3600 * 1000);
    vi.spyOn(auth, 'loginNew').mockRejectedValueOnce(new Error('Request failed with status code 404'));
    vi.spyOn(auth, 'loginStep2').mockResolvedValueOnce(mockSession);

    const session = await auth.login('testUser', 'testPassword');
    expect(session).toBe(mockSession);
    expect(auth.loginStep2).toHaveBeenCalledWith('testUser', expect.any(String));
  });

  test('should not fall back when LG rejects the credentials', async () => {
    vi.spyOn(auth, 'loginNew').mockRejectedValueOnce(new AuthenticationError('Wrong password'));
    vi.spyOn(auth, 'loginStep2');

    await expect(auth.login('testUser', 'testPassword')).rejects.toThrow(AuthenticationError);
    expect(auth.loginStep2).not.toHaveBeenCalled();
  });

  test('should walk the lgemembers sign-in flow and exchange the code for a session', async () => {
    // Build the SK account this flow is reported against: lgeapi_url is derived at construction.
    auth = new Auth(new Gateway({
      empTermsUri: 'https://sk.emp.lgsmartplatform.com',
      empSpxUri: 'https://sk.m.lgaccount.com/spx',
      thinq2Uri: 'https://eic-service.lgthinq.com:46030/v1',
      thinq1Uri: 'https://eic.lgthinq.com:46030/api',
      countryCode: 'SK',
      languageCode: 'en-SK',
    }), mockLogger);

    const { requestClient } = await import('../../src/api/request.js');
    const get = vi.spyOn(requestClient, 'get')
      .mockResolvedValueOnce({ data: '<html/>', headers: { 'set-cookie': ['JSESSIONID=abc; Path=/; HttpOnly'] } });
    const post = vi.spyOn(requestClient, 'post')
      .mockResolvedValueOnce({ data: 'saltedPassword' }) // signInPre
      .mockResolvedValueOnce({ data: { account: { loginSessionID: 'session123', userID: 'testUser', userIDType: 'LGE' } } })
      .mockResolvedValueOnce({ data: { code: 'SUCCESS' }, headers: { 'set-cookie': ['JSESSIONID=def; Path=/'] } })
      .mockResolvedValueOnce({ data: 'SUCCESS' }) // token
      .mockResolvedValueOnce({ data: { redirect_uri: 'lgaccount.lgsmartthinq:/?code=theCode&state=signin' } })
      .mockResolvedValueOnce({ data: { access_token: 'accessToken', refresh_token: 'refreshToken', expires_in: 3600 } });

    const session = await auth.loginNew('testUser', 'hashedPassword');

    expect(session).toBeInstanceOf(Session);
    expect(session.accessToken).toBe('accessToken');

    // The sign-in page is opened on the country's lgemembers host, not the retired spx host.
    expect(get.mock.calls[0][0]).toContain('https://sk.lgemembers.com/lgacc/service/v1/signin?');

    // The cookie from signInComplete supersedes the one from the sign-in page.
    expect(post.mock.calls[2][2]?.headers?.Cookie).toBe('JSESSIONID=abc');
    expect(post.mock.calls[4][2]?.headers?.Cookie).toBe('JSESSIONID=def');

    // The code is exchanged at the country's OAuth backend, signed with the static secret.
    expect(post.mock.calls[5][0]).toBe('https://sk.lgeapi.com/oauth/1.0/oauth2/token');
    expect(post.mock.calls[5][1]).toContain('code=theCode');
    expect(post.mock.calls[5][2]?.headers?.['x-lge-oauth-signature']).toEqual(expect.any(String));

    // No request touches the removed searchKey endpoint.
    expect([...get.mock.calls, ...post.mock.calls].some(call => String(call[0]).includes('searchKey'))).toBe(false);
  });

  test('should surface an authentication error when lgemembers returns no account', async () => {
    const { requestClient } = await import('../../src/api/request.js');
    vi.spyOn(requestClient, 'get').mockResolvedValueOnce({ data: '<html/>', headers: {} });
    vi.spyOn(requestClient, 'post')
      .mockResolvedValueOnce({ data: 'saltedPassword' })
      .mockResolvedValueOnce({ data: { error: { code: 'MS.001.02', message: 'Wrong password' } } });

    await expect(auth.loginNew('testUser', 'hashedPassword')).rejects.toThrow(AuthenticationError);
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

    // LG returns HTTP 403 for the secret-key lookup unless it carries a ThinQ app User-Agent.
    expect(requestClient.get).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('searchKey'),
      { headers: { 'User-Agent': constants.EMP_USER_AGENT } },
    );
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
