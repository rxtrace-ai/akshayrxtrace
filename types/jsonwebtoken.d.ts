declare module "jsonwebtoken" {
  export interface JwtPayload {
    [key: string]: unknown;
    sub?: string;
    exp?: number;
    iat?: number;
  }

  export interface SignOptions {
    algorithm?: string;
    expiresIn?: string | number;
  }

  export function sign(
    payload: string | Buffer | object,
    secretOrPrivateKey: string,
    options?: SignOptions
  ): string;

  export function verify(token: string, secretOrPublicKey: string): string | JwtPayload;

  const jwt: {
    sign: typeof sign;
    verify: typeof verify;
  };

  export default jwt;
}
