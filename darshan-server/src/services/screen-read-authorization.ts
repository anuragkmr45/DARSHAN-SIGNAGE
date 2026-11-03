import type { FastifyRequest } from 'fastify';
import { subject } from '@casl/ability';
import { eq } from 'drizzle-orm';
import { extractTokenFromHeader, verifyAccessToken, type JWTPayload } from '@/auth/jwt';
import { withCurrentMutationAuthorization, type MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { schema } from '@/db';
import { AppError } from '@/utils/app-error';

type ReaderIdentity = Pick<JWTPayload, 'sub' | 'jti'>;
async function currentPayload(request: FastifyRequest): Promise<ReaderIdentity> {
  const token = extractTokenFromHeader(request.headers.authorization);
  if (!token) throw AppError.unauthorized('Missing authorization header');
  return verifyAccessToken(token);
}

async function readRecord<Row extends object>(identity: ReaderIdentity, kind: 'Screen' | 'ScreenGroup',
  load: (context: MutationAuthorizationContext) => Promise<Row | undefined>): Promise<Row> {
  return withCurrentMutationAuthorization(identity, async context => {
    if (!context.ability.can('read', kind)) throw AppError.forbidden();
    const row = await load(context);
    if (!row) throw AppError.notFound(kind === 'Screen' ? 'Screen not found' : 'Screen group not found');
    if (!context.ability.can('read', subject(kind, row) as never)) throw AppError.forbidden();
    return row;
  }, { userLock: 'share' });
}

/** CMS user access only. Device certificate/signature principals do not use a
 * user's Screen grants. Authorization finishes before transport signing/I/O. */
export async function readAuthorizedScreenForIdentity(identity: ReaderIdentity, id: string) {
  return readRecord(identity, 'Screen', async context => {
    const [row] = await context.executor.select().from(schema.screens).where(eq(schema.screens.id, id)).for('share');
    return row;
  });
}
export async function readAuthorizedScreen(request: FastifyRequest, id: string) {
  return readAuthorizedScreenForIdentity(await currentPayload(request), id);
}
export async function readAuthorizedScreenGroup(request: FastifyRequest, id: string) {
  return readRecord(await currentPayload(request), 'ScreenGroup', async context => {
    const [row] = await context.executor.select().from(schema.screenGroups).where(eq(schema.screenGroups.id, id)).for('share');
    return row;
  });
}
