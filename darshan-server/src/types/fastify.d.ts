import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    device?: {
      id: string;
      authType: 'device' | 'user';
      certificateId?: string;
      credentialId?: string;
      fingerprint?: string;
      authMethod?: 'legacy_serial' | 'signature' | 'native_signature';
      userId?: string;
    };
  }
}
