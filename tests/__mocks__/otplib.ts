export class TOTP {
  generateSecret() {
    return 'MOCKSECRET';
  }
  async verify(token: string, _options?: any) {
    if (token !== '123456') {
      return { valid: false };
    }
    return { valid: true, delta: 0, timeStep: Math.floor(Date.now() / 30000) };
  }
  toURI(_options?: any) {
    return 'otpauth://totp/mock';
  }
}

export class NobleCryptoPlugin {}
export class ScureBase32Plugin {}
