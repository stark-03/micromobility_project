import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type { Socket } from 'socket.io';
import type { Role } from '@mm/shared-types';
import { env } from '../config/env.ts';
import { verifyAccessToken } from '../lib/access-token.ts';
import { logger } from '../lib/logger.ts';
import { bus } from './bus.ts';

interface SocketUser {
  id: string;
  roles: Role[];
  operatorId: string | null;
}

declare module 'socket.io' {
  interface Socket {
    mmUser?: SocketUser;
  }
}

/**
 * Decides whether a socket may join a room.
 *
 * CLAUDE.md is explicit: join is authorized on connect against the user's
 * roles — never trust a client-supplied room name. Without this, any signed-in
 * commuter could subscribe to `operator:2` and watch another company's fleet
 * move in real time.
 */
export function canJoin(user: SocketUser, room: string): boolean {
  const [kind, id] = room.split(':');

  switch (kind) {
    // Traffic is city-wide public information to any signed-in user.
    case 'zone':
      return Boolean(id);
    // Your own user room only.
    case 'user':
      return id === user.id;
    // Your own operator, unless you are staff.
    case 'operator':
      return (
        user.roles.includes('admin') ||
        user.roles.includes('planner') ||
        user.roles.includes('analyst') ||
        (user.roles.includes('operator') && id === user.operatorId)
      );
    // Simulation runs — planners and above. Sprint 4 populates these.
    case 'run':
      return (
        user.roles.includes('admin') ||
        user.roles.includes('planner') ||
        user.roles.includes('analyst')
      );
    default:
      return false;
  }
}

let io: Server | null = null;

export function attachGateway(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: env.corsOrigin, credentials: true },
    // The refresh cookie is path-scoped to /api/v1/auth and never reaches here,
    // so the socket authenticates with the access token in the handshake.
    transports: ['websocket', 'polling'],
  });

  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth as { token?: string } | undefined)?.token ??
      socket.handshake.headers.authorization?.replace(/^Bearer /, '');

    if (!token) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }

    try {
      const claims = verifyAccessToken(token);
      socket.mmUser = {
        id: claims.sub,
        roles: claims.roles,
        operatorId: claims.operatorId,
      };
      next();
    } catch {
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.mmUser!;
    // Everyone lands in their own room; nothing else is automatic.
    void socket.join(`user:${user.id}`);

    socket.on('subscribe', (room: unknown, ack?: (ok: boolean) => void) => {
      if (typeof room !== 'string' || !canJoin(user, room)) {
        logger.warn('socket subscribe denied', { userId: user.id, room: String(room) });
        ack?.(false);
        return;
      }
      void socket.join(room);
      ack?.(true);
    });

    socket.on('unsubscribe', (room: unknown) => {
      if (typeof room === 'string') void socket.leave(room);
    });
  });

  // The bus is the only thing services talk to; the gateway is the only thing
  // that talks to sockets. This function is the seam between them.
  bus.on('traffic:update', (payload) => {
    io?.emit('traffic:update', payload);
  });
  bus.on('weather:update', (payload) => {
    io?.to(`zone:${payload.zoneId}`).emit('weather:update', payload);
    io?.emit('weather:update', payload);
  });
  bus.on('vehicle:status', (payload) => {
    io?.emit('vehicle:status', payload);
  });
  bus.on('vehicle:created', (payload) => {
    io?.to(`operator:${payload.operatorId}`).emit('vehicle:created', payload);
  });

  // M06. Scoped to the run's room: progress for a scenario nobody is watching
  // should not be broadcast to every connected planner.
  bus.on('run:progress', (payload) => {
    io?.to(`run:${payload.runId}`).emit('run:progress', payload);
  });
  bus.on('run:completed', (payload) => {
    io?.to(`run:${payload.runId}`).emit('run:completed', payload);
  });

  logger.info('Socket.IO gateway attached');
  return io;
}

export function closeGateway(): Promise<void> {
  return new Promise((resolve) => {
    if (!io) return resolve();
    io.close(() => {
      io = null;
      resolve();
    });
  });
}
