import crypto from 'crypto';
import { DateTime } from 'luxon';
import qs from 'qs';
import { URL } from 'url';
import { AuthenticationError, ManualProcessNeededErrorCode, TokenError } from '../errors/index.js';
import * as constants from '../lib/constants.js';
import type { Gateway } from './Gateway.js';
import { requestClient } from './request.js';
import { Session } from './Session.js';
import type { Logger } from 'homebridge';

/**
 * Handles authentication with the LG ThinQ API.
 * This class manages login, token refresh, and user session handling.
 */
export class Auth {
  /**
   * The base URL for the LG API, determined by the user's country code.
   */
  public lgeapi_url: string;

  /**
   * Creates a new `Auth` instance.
   *
   * @param gateway - The `Gateway` instance containing API endpoint information.
   * @param logger - The logger instance for logging debug and error messages.
   */
  public constructor(
    protected gateway: Gateway,
    public logger: Logger,
  ) {
    this.lgeapi_url = `https://${this.gateway.country_code.toLowerCase()}.lgeapi.com/`;
  }

  /**
   * Logs in to the LG ThinQ API using the provided username and password.
   *
   * @param username - The user's username.
   * @param password - The user's password.
   * @returns A promise that resolves with a `Session` instance.
   */
  public async login(username: string, password: string) {
    // get signature and timestamp in login form
    const hash = crypto.createHash('sha512');
    const encrypted_password = hash.update(password).digest('hex');

    // LG removed the legacy `searchKey?key_name=OAUTH_SECRETKEY` endpoint (it 404s in every
    // region), so the EMP session flow can no longer be signed. Sign in through the new
    // lgemembers.com account system instead, keeping the old path as a fallback in case LG
    // restores it or a region is still served by it.
    try {
      return await this.loginNew(username, encrypted_password);
    } catch (err: unknown) {
      if (err instanceof AuthenticationError) {
        throw err;
      }

      this.logger.debug('lgemembers.com sign-in failed, falling back to the legacy EMP flow:', err);
      return await this.loginStep2(username, encrypted_password);
    }
  }

  /**
   * Signs in through LG's lgemembers.com account system.
   *
   * This replaces the legacy EMP session flow, whose `searchKey` secret lookup LG removed.
   * The final token exchange is signed with the static `OAUTH_SECRET_KEY` — the same key
   * `refreshNewToken` already uses — so no dynamic secret is needed.
   *
   * @param username - The user's username.
   * @param encrypted_password - The SHA-512 hex digest of the user's password.
   * @returns A promise that resolves with a `Session` instance.
   */
  public async loginNew(username: string, encrypted_password: string) {
    const country = this.gateway.country_code;
    const language = this.gateway.language_code;
    const host = `https://${country.toLowerCase()}.${constants.LGACC_BASE_URL}`;
    const headers = {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': `${language},${country.toLowerCase()};q=0.9`,
      'Origin': host,
      'User-Agent': constants.EMP_USER_AGENT,
    };

    // 1. open the sign-in page to get a session cookie
    const signInParams = {
      callback_url: constants.LGACC_REDIRECT_URI,
      client_id: constants.CLIENT_ID,
      close_type: '0',
      country: country,
      language: language,
      pre_login: '',
      redirect_url: constants.LGACC_REDIRECT_URI,
      state: 'signin',
      svc_code: constants.SVC_CODE,
      svc_integrated: 'Y',
      ui_mode: 'light',
      webview_yn: 'Y',
    };
    const pageResponse = await requestClient.get(`${host}/lgacc/service/v1/signin?` + qs.stringify(signInParams), {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': headers['Accept-Language'],
        'User-Agent': constants.EMP_USER_AGENT,
      },
    });
    const cookie = this.firstCookie(pageResponse.headers['set-cookie']);

    // 2. hand the hashed password over so LG can re-hash it with its own salt
    const preLoginResponse = await requestClient.post(`${host}/lgacc/front/v1/signin/signInPre`, qs.stringify({
      userAuth2: encrypted_password,
      password_hash_prameter_flag: 'Y',
      svc_list: 'SVC202,SVC710', // SVC202=LG SmartHome, SVC710=EMP OAuth
    }), { headers: { ...headers, Cookie: cookie } });

    // 3. authenticate — the user id travels RSA-encrypted
    const accountResponse = await requestClient.post(`${host}/lgacc/front/v1/signin/signInAct`, qs.stringify({
      clientId: constants.CLIENT_ID,
      doneYn: '',
      ipadYn: 'N',
      itgTermsUseFlag: 'Y',
      itgUserType: 'A',
      local_country: country,
      local_lang: language.split('-')[0],
      skipYn: 'N',
      svcCode: constants.SVC_CODE,
      svc_code: constants.SVC_CODE,
      userId: encodeURIComponent(this.encryptUserId(username)),
      userPw: preLoginResponse.data,
    }), { headers: { ...headers, Cookie: cookie } });

    const account = accountResponse.data?.account;
    if (!account) {
      const { code, message } = accountResponse.data?.error || {};
      if (code === 'MS.001.03') {
        throw new AuthenticationError('Your account was already used to registered in ' + message + '.');
      }

      throw new AuthenticationError(message || accountResponse.data?.message
        || 'LG rejected the sign-in. If you sign in to LG with Google, Apple or Facebook, use a token instead.');
    }

    // 4. complete the sign-in, which upgrades the session cookie
    const loginSessionID = account.loginSessionID;
    const loginUuid = crypto.randomUUID();
    const completeResponse = await requestClient.post(`${host}/lgacc/front/v1/signin/signInComplete`, qs.stringify({
      loginSessionID,
      additionalInfo: encodeURIComponent(JSON.stringify({
        uuid: loginUuid,
        user_id: account.userID,
        user_id_type: account.userIDType,
        svc_integrated: 'Y',
      })),
      autoYn: 'N',
      deviceId: this.randomString(32),
      ipadYn: 'N',
      local_country: country,
      local_lang: language.split('-')[0],
      serviceYn: 'Y',
      svcCode: constants.SVC_CODE,
      svc_code: constants.SVC_CODE,
      uuid: loginUuid,
    }), { headers: { ...headers, Cookie: cookie } });

    if (completeResponse.data?.code !== 'SUCCESS') {
      throw new TokenError(completeResponse.data?.message || JSON.stringify(completeResponse.data));
    }
    const sessionCookie = this.firstCookie(completeResponse.headers['set-cookie']) || cookie;

    // 5. mark the session as issued
    await requestClient.post(`${host}/lgacc/front/v1/signin/token`, qs.stringify({
      loginSessionID,
      uuid: loginUuid,
    }), { headers: { ...headers, Cookie: sessionCookie } });

    // 6. exchange the session for an OAuth authorization code
    const oauthResponse = await requestClient.post(`${host}/lgacc/front/v1/signin/oauth`, qs.stringify({
      loginSessionID,
      accountType: 'LGE',
      clientId: constants.CLIENT_ID,
      countryCode: country,
      local_country: country,
      local_lang: language.split('-')[0],
      redirectUri: constants.LGACC_REDIRECT_URI,
      state: 'signin',
      svc_code: constants.SVC_CODE,
      userName: username,
    }), { headers: { ...headers, Cookie: sessionCookie } });

    const redirectUri = oauthResponse.data?.redirect_uri;
    if (!redirectUri) {
      throw new TokenError(oauthResponse.data?.message || JSON.stringify(oauthResponse.data));
    }
    const code = qs.parse(decodeURIComponent(redirectUri).split('?')[1])?.code;
    if (!code) {
      throw new TokenError('LG returned no authorization code.');
    }

    // 7. trade the code for tokens, signed with the static OAuth secret
    return await this.requestToken({ code: code as string, grant_type: 'authorization_code' });
  }

  /**
   * RSA-encrypts a user id with LG's account public key, as the sign-in form does.
   */
  protected encryptUserId(username: string) {
    return crypto.publicEncrypt({
      key: constants.LGACC_PUBLIC_KEY,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }, Buffer.from(username)).toString('base64');
  }

  /**
   * Extracts the cookie pair from a `set-cookie` header, dropping its attributes.
   */
  protected firstCookie(setCookie?: string[]) {
    return setCookie?.[0]?.split(';')[0] || '';
  }

  /**
   * Generates a random alphanumeric string of the requested length.
   */
  protected randomString(length: number) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length }, () => characters[crypto.randomInt(characters.length)]).join('');
  }

  /**
   * Exchanges an authorization code for a session at the country's OAuth backend.
   */
  protected async requestToken(data: Record<string, string>, backendUrl?: string) {
    const tokenData = { ...data, redirect_uri: constants.LGACC_REDIRECT_URI };
    const timestamp = DateTime.utc().toRFC2822();
    const requestUrl = '/oauth/1.0/oauth2/token?' + qs.stringify(tokenData);

    const res = await requestClient.post((backendUrl || this.lgeapi_url) + 'oauth/1.0/oauth2/token',
      qs.stringify(tokenData),
      {
        headers: {
          'x-lge-app-os': 'ADR',
          'x-lge-appkey': constants.CLIENT_ID,
          'x-lge-oauth-signature': this.signature(`${requestUrl}\n${timestamp}`, constants.OAUTH_SECRET_KEY),
          'x-lge-oauth-date': timestamp,
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    const token = res.data;

    this.lgeapi_url = token.oauth2_backend_url || this.lgeapi_url;

    return new Session(token.access_token, token.refresh_token, token.expires_in);
  }

  /**
   * Performs the second step of the login process using an encrypted password.
   *
   * @param username - The user's username.
   * @param encrypted_password - The encrypted password.
   * @param extra_headers - Optional additional headers for the request.
   * @returns A promise that resolves with a `Session` instance.
   */
  public async loginStep2(username: string, encrypted_password: string, extra_headers?: Record<string, string>) {
    const headers: Record<string, string> = this.defaultEmpHeaders;

    const preLoginData = {
      'user_auth2': encrypted_password,
      'log_param': 'login request / user_id : ' + username + ' / third_party : null / svc_list : SVC202,SVC710 / 3rd_service : ',
    };
    const preLoginResponse = await requestClient.post(this.gateway.login_base_url + 'preLogin', qs.stringify(preLoginData), { headers });
    const preLogin = preLoginResponse.data;

    headers['X-Signature'] = preLogin.signature;
    headers['X-Timestamp'] = preLogin.tStamp;

    const data = {
      'user_auth2': preLogin.encrypted_pw,
      'password_hash_prameter_flag': 'Y',
      'svc_list': 'SVC202,SVC710', // SVC202=LG SmartHome, SVC710=EMP OAuth
      ...extra_headers,
    };

    // try login with username and hashed password
    const loginUrl = this.gateway.emp_base_url + 'emp/v2.0/account/session/' + encodeURIComponent(username);
    let account;
    try {
      const loginResponse = await requestClient.post(loginUrl, qs.stringify(data), { headers });
      account = loginResponse.data.account;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data: { error: { code: string; message: string } } } };
      if (!axiosErr.response) {
        throw err;
      }

      const { code, message } = axiosErr.response.data.error;
      if (code === 'MS.001.03') {
        throw new AuthenticationError('Your account was already used to registered in ' + message + '.');
      }

      throw new AuthenticationError(message);
    }

    // dynamic get secret key for emp signature
    const empSearchKeyUrl = this.gateway.login_base_url + 'searchKey?key_name=OAUTH_SECRETKEY&sever_type=OP';
    const secretKeyResponse = await requestClient.get(empSearchKeyUrl, {
      headers: {
        'User-Agent': constants.EMP_USER_AGENT,
      },
    });
    const secretKey = secretKeyResponse.data.returnData;

    const timestamp = DateTime.utc().toRFC2822();
    const empData = {
      account_type: account.userIDType,
      client_id: constants.CLIENT_ID,
      country_code: account.country,
      redirect_uri: 'lgaccount.lgsmartthinq:/',
      response_type: 'code',
      state: '12345',
      username: account.userID,
    };
    const empUrl = new URL('https://emp-oauth.lgecloud.com/emp/oauth2/authorize/empsession?' + qs.stringify(empData));
    const signature = this.signature(`${empUrl.pathname}${empUrl.search}\n${timestamp}`, secretKey);
    const empHeaders = {
      'lgemp-x-app-key': constants.OAUTH_CLIENT_KEY,
      'lgemp-x-date': timestamp,
      'lgemp-x-session-key': account.loginSessionID,
      'lgemp-x-signature': signature,
      'Accept': 'application/json',
      'X-Device-Type': 'M01',
      'X-Device-Platform': 'ADR',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Access-Control-Allow-Origin': '*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',

      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36 Edg/93.0.961.44',
    };
    // create emp session and get access token
    let authorize;
    try {
      const authorizeResponse = await requestClient.get(empUrl.href, { headers: empHeaders });
      authorize = authorizeResponse.data;
    } catch (err: unknown) {
      const axiosErr = err as { response: { data: { error: { message: string } } } };
      throw new AuthenticationError(axiosErr.response.data.error.message);
    }
    if (authorize.status !== 1) {
      throw new TokenError(authorize.message || authorize);
    }

    const redirect_uri = new URL(authorize.redirect_uri);

    return await this.requestToken(
      {
        code: redirect_uri.searchParams.get('code') || '',
        grant_type: 'authorization_code',
      },
      redirect_uri.searchParams.get('oauth2_backend_url') || undefined,
    );
  }

  /**
   * Retrieves the default headers for EMP requests.
   */
  public get defaultEmpHeaders() {
    return {
      'Accept': 'application/json',
      'X-Application-Key': constants.APPLICATION_KEY,
      'X-Client-App-Key': constants.CLIENT_ID,
      'X-Lge-Svccode': 'SVC709',
      'X-Device-Type': 'M01',
      'X-Device-Platform': 'ADR',
      'X-Device-Language-Type': 'IETF',
      'X-Device-Publish-Flag': 'Y',
      'X-Device-Country': this.gateway.country_code,
      'X-Device-Language': this.gateway.language_code,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Access-Control-Allow-Origin': '*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': constants.EMP_USER_AGENT,
    };
  }

  /**
   * Handles new terms and conditions that require user agreement.
   *
   * @param accessToken - The access token for the session.
   */
  public async handleNewTerm(accessToken: string) {
    const showTermUrl = 'common/showTerms?callback_url=lgaccount.lgsmartthinq:/updateTerms'
      + '&country=VN&language=en-VN&division=ha:T20&terms_display_type=3&svc_list=SVC202';
    const showTermResponse = await requestClient.get(this.gateway.login_base_url + showTermUrl, {
      headers: {
        'X-Login-Session': accessToken,
      },
    });
    const showTermHtml = showTermResponse.data;

    const headers = {
      ...this.defaultEmpHeaders,
      'X-Login-Session': accessToken,
      'X-Signature': showTermHtml.match(/signature[\s]+:[\s]+"([^"]+)"/)[1],
      'X-Timestamp': showTermHtml.match(/tStamp[\s]+:[\s]+"([^"]+)"/)[1],
    };

    const accountTermUrl = 'emp/v2.0/account/user/terms?opt_term_cond=001&term_data=SVC202&itg_terms_use_flag=Y&dummy_terms_use_flag=Y';
    const accountTermResponse = await requestClient.get(this.gateway.emp_base_url + accountTermUrl, { headers });
    const accountTerms = (accountTermResponse.data.account?.terms || []).map((term: { termsID: string }) => {
      return term.termsID;
    });

    const termInfoUrl = 'emp/v2.0/info/terms?opt_term_cond=001&only_service_terms_flag=&itg_terms_use_flag=Y&term_data=SVC202';
    const termInfoResponse = await requestClient.get(this.gateway.emp_base_url + termInfoUrl, { headers });
    const infoTerms = termInfoResponse.data.info.terms;

    const newTermAgreeNeeded = infoTerms.filter((term: { termsID: string }) => {
      return accountTerms.indexOf(term.termsID) === -1;
    }).map((term: { termsType: string; termsID: string; defaultLang: string }) => {
      return [term.termsType, term.termsID, term.defaultLang].join(':');
    }).join(',');

    if (newTermAgreeNeeded) {
      const updateAccountTermUrl = 'emp/v2.0/account/user/terms';
      await requestClient.post(this.gateway.emp_base_url + updateAccountTermUrl, qs.stringify({ terms: newTermAgreeNeeded }), {
        headers,
      });
    }
  }

  /**
   * Retrieves the JSession ID for ThinQ v1 API compatibility.
   *
   * @param accessToken - The access token for the session.
   * @returns A promise that resolves with the JSession ID.
   */
  public async getJSessionId(accessToken: string) {
    // login to old gateway also - thinq v1
    const memberLoginUrl = this.gateway.thinq1_url + 'member/login';
    const memberLoginHeaders = {
      'x-thinq-application-key': 'wideq',
      'x-thinq-security-key': 'nuts_securitykey',
      'Accept': 'application/json',
      'x-thinq-token': accessToken,
    };
    const memberLoginData = {
      countryCode: this.gateway.country_code,
      langCode: this.gateway.language_code,
      loginType: 'EMP',
      token: accessToken,
    };

    try {
      const memberLoginResponse = await requestClient.post(memberLoginUrl, { lgedmRoot: memberLoginData }, {
        headers: memberLoginHeaders,
      });
      return memberLoginResponse.data.lgedmRoot.jsessionId;
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.debug(
        error.message.startsWith(ManualProcessNeededErrorCode)
          ? 'Please open the native LG App and sign in to your account to see what happened,'
          + ' maybe new agreement need your accept. Then try restarting Homebridge.'
          : error.message,
      );
      this.logger.debug(String(err));
      this.logger.info('Failed to login to old thinq v1 gateway. See debug logs for more details. Continuing anyways.');
    }
  }

  /**
   * Refreshes the access token using the refresh token.
   *
   * @param session - The current `Session` instance.
   * @returns A promise that resolves with the updated `Session` instance.
   */
  public async refreshNewToken(session: Session) {
    try {
      const gatewayResponse = await requestClient.post('https://kic.lgthinq.com:46030/api/common/gatewayUriList', {
        lgedmRoot: {
          countryCode: this.gateway.country_code,
          langCode: this.gateway.language_code,
        },
      }, {
        headers: {
          'Accept': 'application/json',
          'x-thinq-application-key': 'wideq',
          'x-thinq-security-key': 'nuts_securitykey',
        },
      });

      this.lgeapi_url = gatewayResponse.data.lgedmRoot.oauthUri + '/';
    } catch (err) {
      // ignore this error
    }

    const tokenUrl = this.lgeapi_url + 'oauth/1.0/oauth2/token';
    const data = {
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    };

    const timestamp = DateTime.utc().toRFC2822();

    const requestUrl = '/oauth/1.0/oauth2/token' + qs.stringify(data, { addQueryPrefix: true });
    const signature = this.signature(`${requestUrl}\n${timestamp}`, constants.OAUTH_SECRET_KEY);

    const headers = {
      'x-lge-app-os': 'ADR',
      'x-lge-appkey': constants.CLIENT_ID,
      'x-lge-oauth-signature': signature,
      'x-lge-oauth-date': timestamp,
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const tokenResponse = await requestClient.post(tokenUrl, qs.stringify(data), { headers });

    session.newToken(tokenResponse.data.access_token, parseInt(tokenResponse.data.expires_in));

    return session;
  }

  /**
   * Retrieves the user's unique number from the LG API.
   *
   * @param accessToken - The access token for the session.
   * @returns A promise that resolves with the user's unique number.
   */
  public async getUserNumber(accessToken: string) {
    const profileUrl = this.lgeapi_url + 'users/profile';
    const timestamp = DateTime.utc().toRFC2822();
    const signature = this.signature(`/users/profile\n${timestamp}`, constants.OAUTH_SECRET_KEY);

    const headers = {
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + accessToken,
      'X-Lge-Svccode': 'SVC202',
      'X-Application-Key': constants.APPLICATION_KEY,
      'lgemp-x-app-key': constants.CLIENT_ID,
      'X-Device-Type': 'M01',
      'X-Device-Platform': 'ADR',
      'x-lge-oauth-date': timestamp,
      'x-lge-oauth-signature': signature,
    };

    const profileResponse = await requestClient.get(profileUrl, { headers });
    if (profileResponse.data.status === 2) {
      throw new AuthenticationError(profileResponse.data.message);
    }

    return profileResponse.data.account.userNo as string;
  }

  /**
   * Constructs the login URL for the LG ThinQ API.
   *
   * @returns The login URL.
   */
  public async getLoginUrl() {
    const params = {
      country: this.gateway.country_code,
      language: this.gateway.language_code,
      client_id: constants.CLIENT_ID,
      svc_list: constants.SVC_CODE,
      svc_integrated: 'Y',
      redirect_uri: 'lgaccount.lgsmartthinq:/',
      show_thirdparty_login: 'LGE,MYLG,GGL,AMZ,FBK,APPL',
      division: 'ha:T20',
      callback_url: 'lgaccount.lgsmartthinq:/',
      oauth2State: '12345',
      show_select_country: 'N',
    };

    return this.gateway.login_base_url + 'login/signIn' + qs.stringify(params, { addQueryPrefix: true });
  }

  /**
   * Generates a signature for API requests.
   *
   * @param message - The message to sign.
   * @param secret - The secret key used for signing.
   * @returns The generated signature.
   */
  protected signature(message: string, secret: string) {
    return crypto.createHmac('sha1', Buffer.from(secret)).update(message).digest('base64');
  }
}
