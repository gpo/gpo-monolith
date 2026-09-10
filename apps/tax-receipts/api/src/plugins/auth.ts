import fastifyCookie from '@fastify/cookie';
import { Authenticator } from '@fastify/passport';
import fastifySession from '@fastify/session';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Strategy as LocalStrategy } from 'passport-local';
import type { PrismaClient } from '../generated/prisma/index.js';
import { verifyPassword } from '../auth/password.js';
import { PrismaSessionStore } from '../auth/session-store.js';
import {
  defineAbilitiesFor,
  type AbilityUser,
  type AppAbility,
} from '../auth/abilities.js';

export interface AuthPluginOptions {
  prisma: PrismaClient;
  sessionSecret: string;
  secureCookie: boolean;
}

/** The user as attached to a request. */
export interface SessionUser extends AbilityUser {
  name: string;
  email: string;
  active: boolean;
}

const ANONYMOUS: AbilityUser = {
  id: 'anonymous',
  role: 'readonly',
  isCfoDesignate: false,
  allRidings: false,
  ridingGrants: [],
};

async function authPlugin(
  app: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<void> {
  const { prisma } = opts;
  const passport = new Authenticator();

  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: opts.sessionSecret,
    store: new PrismaSessionStore(prisma) as never,
    cookieName: 'gpo_tr_sid',
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookie,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    },
    saveUninitialized: false,
  });
  await app.register(passport.initialize());
  await app.register(passport.secureSession());

  passport.use(
    'local',
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      (email, password, done) => {
        prisma.user
          .findUnique({ where: { email: email.toLowerCase() } })
          .then(async (user) => {
            if (!user || !user.active) return done(null, false);
            const ok = await verifyPassword(password, user.passwordHash);
            if (!ok) return done(null, false);
            done(null, toSessionUser(user));
          })
          .catch((err) => done(err as Error));
      },
    ),
  );

  passport.registerUserSerializer(async (user: SessionUser) => user.id);
  passport.registerUserDeserializer(async (id: string) => {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || !user.active) return null;
    return toSessionUser(user);
  });

  app.decorate('passport', passport);
  app.decorateRequest('ability');

  app.addHook('preHandler', async (request) => {
    const user = request.user as SessionUser | undefined;
    request.ability = defineAbilitiesFor(user ?? ANONYMOUS);
  });

  app.decorate(
    'requireUser',
    async function requireUser(request: FastifyRequest, reply: FastifyReply) {
      if (!request.user) {
        reply.code(401).send({ error: 'authentication required' });
      }
    },
  );
}

function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  role: SessionUser['role'];
  active: boolean;
  isCfoDesignate: boolean;
  allRidings: boolean;
  ridingGrants: number[];
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    isCfoDesignate: user.isCfoDesignate,
    allRidings: user.allRidings,
    ridingGrants: user.ridingGrants,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    ability: AppAbility;
  }
  interface FastifyInstance {
    passport: Authenticator;
    requireUser: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface PassportUser extends SessionUser {}
}

export default fp(authPlugin, { name: 'auth' });
