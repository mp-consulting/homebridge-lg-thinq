import { X509Certificate } from 'crypto';
import {
  AMAZON_ROOT_CA_1,
  COMODO_AAA_CERTIFICATE_SERVICES,
  VERISIGN_CLASS3_G5,
  rootCAForMqttHost,
} from '../../src/lib/rootCAs.js';

describe('bundled MQTT root CAs', () => {
  test.each([
    ['Amazon Root CA 1', AMAZON_ROOT_CA_1, '8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E'],
    ['AAA Certificate Services', COMODO_AAA_CERTIFICATE_SERVICES,
      'D7:A7:A0:FB:5D:7E:27:31:D7:71:E9:48:4E:BC:DE:F7:1D:5F:0C:3E:0A:29:48:78:2B:C8:3E:E0:EA:69:9E:F4'],
    ['VeriSign Class 3 Public Primary Certification Authority - G5', VERISIGN_CLASS3_G5,
      '9A:CF:AB:7E:43:C8:D8:80:D0:6B:26:2A:94:DE:EE:E4:B4:65:99:89:C3:D0:CA:F1:9B:AF:64:05:E4:1A:B7:DF'],
  ])('%s matches its pinned fingerprint', (cn, pem, fingerprint) => {
    const cert = new X509Certificate(pem);
    expect(cert.subject).toContain('CN=' + cn);
    expect(cert.fingerprint256).toBe(fingerprint);
    expect(cert.ca).toBe(true);
  });

  test.each([
    ['a1b2c3-ats.iot.eu-west-1.amazonaws.com', AMAZON_ROOT_CA_1],
    ['common.iot.ruic.lgthinq.com', COMODO_AAA_CERTIFICATE_SERVICES],
    ['legacy.example.com', VERISIGN_CLASS3_G5],
    // dots in the patterns are literal, so look-alike hosts don't match
    ['a1b2c3-atsXiotXeu-west-1XamazonawsXcom', VERISIGN_CLASS3_G5],
  ])('%s uses the expected root', (host, expected) => {
    expect(rootCAForMqttHost(host)).toBe(expected);
  });
});
