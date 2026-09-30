import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z, ZodError } from 'zod';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  ensure,
  distanceKm,
  roles,
  totalPrice,
  type Actor,
  type Role,
} from './domain.js';
import type { Store } from './store.js';
import { MAX_IMAGE_BYTES, validateImageInput, type Integrations } from './integrations.js';
import { Marketplace } from './marketplace.js';
import { JobQueue } from './whatsapp.js';
import * as v from './validation.js';
export interface Identity {
  uid: string;
  phone_number?: string;
  email?: string;
}
export interface AppDependencies {
  store: Store;
  integrations: Integrations;
  verifyToken(token: string): Promise<Identity>;
  corsOrigins?: string[];
  trustProxyHops?: number;
  validateWebhook?: (secret: string) => boolean;
}
declare global {
  namespace Express {
    interface Request {
      identity: Identity;
      actor: Actor;
      requestId: string;
    }
  }
}
const param = (req: Request, key = 'id') => v.id.parse(req.params[key]);
function secretsMatch(received: string, expected: string | undefined) {
  if (!expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
function paginate<T extends { id: string }>(items: T[], query: unknown) {
  const { limit, after } = v.page.parse(query);
  const sorted = items
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((i) => !after || i.id > after);
  return {
    items: sorted.slice(0, limit),
    nextCursor: sorted.length > limit ? sorted[limit - 1]!.id : null,
  };
}
function image(req: Request) {
  if (!req.file) return undefined;
  return validateImageInput({ buffer: req.file.buffer, mimetype: req.file.mimetype });
}
function form(req: Request) {
  if (req.is('multipart/form-data') && typeof req.body.geo === 'string') {
    try {
      req.body.geo = JSON.parse(req.body.geo);
    } catch {
      throw new AppError(400, 'INVALID_INPUT', 'geo must be JSON');
    }
  }
  return req.body;
}
export function createApp(deps: AppDependencies) {
  const app = express();
  const { store } = deps;
  const market = new Marketplace(store, deps.integrations);
  const queue = new JobQueue(store, deps.integrations);
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxyHops ?? 0);
  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigins ?? ['http://localhost:5173'] }));
  app.use((req, _res, next) => {
    req.requestId = randomUUID();
    next();
  });
  app.use((req, res, next) => {
    const startedAt = performance.now();
    res.on('finish', () =>
      console.info(
        JSON.stringify({
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        }),
      ),
    );
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: (req: Request) => ({
        error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.requestId },
      }),
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    ensure(token, 401, 'UNAUTHENTICATED', 'Firebase bearer token required');
    try {
      req.identity = await deps.verifyToken(token);
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired authentication token');
    }
    next();
  };
  const profile = async (req: Request, _res: Response, next: NextFunction) => {
    const user = await store.get('users', req.identity.uid);
    ensure(user, 403, 'PROFILE_REQUIRED', 'Create your profile first');
    ensure(user.verificationStatus !== 'rejected', 403, 'ACCOUNT_REJECTED', 'Account is disabled');
    req.actor = { uid: req.identity.uid, user };
    next();
  };
  const requireRole =
    (...allowed: Role[]) =>
    (req: Request, _res: Response, next: NextFunction) => {
      ensure(
        allowed.includes(req.actor.user.role),
        403,
        'FORBIDDEN',
        'Your role cannot perform this action',
      );
      next();
    };
  const verified = (req: Request, _res: Response, next: NextFunction) => {
    ensure(
      req.actor.user.verificationStatus === 'verified',
      403,
      'VERIFICATION_REQUIRED',
      'An admin must verify your account',
    );
    next();
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 15, fieldSize: 8192 },
  }).single('photo');
  const aiLimit = rateLimit({
    windowMs: 60000,
    limit: 8,
    keyGenerator: (req) => req.actor.uid,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: (req: Request) => ({
      error: { code: 'RATE_LIMITED', message: 'Too many AI requests', requestId: req.requestId },
    }),
  });
  app.post('/api/whatsapp/openwa/webhook', async (req, res) => {
    const secret = req.get('x-webhook-secret') ?? '';
    const valid = deps.validateWebhook
      ? deps.validateWebhook(secret)
      : secretsMatch(secret, process.env.OPENWA_WEBHOOK_SECRET);
    ensure(valid, 403, 'INVALID_WEBHOOK_SECRET', 'Invalid OpenWA webhook secret');
    const envelope = z
      .object({
        webhookId: z.string().min(1).max(200),
        sessionId: z.string().min(1).max(100),
        event: z.string().min(1).max(120),
        timestamp: z.number().finite(),
        payload: z
          .object({
            message: z
              .object({
                id: z.string().min(1).max(500),
                from: z.string().regex(/^\d{7,15}@c\.us$/),
                body: z.string().max(4000).optional(),
                caption: z.string().max(4000).optional(),
                // OpenWA emits these fields for messages shared from WhatsApp's location UI.
                // They are normalized to the existing durable inbound-job payload below.
                lat: z.union([z.number().finite(), z.string().max(40)]).optional(),
                lng: z.union([z.number().finite(), z.string().max(40)]).optional(),
                loc: z.string().max(4000).optional(),
                fromMe: z.boolean().default(false),
                isGroupMsg: z.boolean().default(false),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough()
      .parse(req.body);
    if (
      envelope.event !== 'message.received' ||
      envelope.payload.message.fromMe ||
      envelope.payload.message.isGroupMsg
    )
      return res.status(204).end();
    const message = envelope.payload.message;
    const from = `whatsapp:+${message.from.slice(0, message.from.indexOf('@'))}`;
    const payload: Record<string, string> = {
      From: from,
      Body: message.body || message.caption || '',
    };
    if (message.lat !== undefined) payload.Latitude = String(message.lat);
    if (message.lng !== undefined) payload.Longitude = String(message.lng);
    if (message.loc) {
      payload.Address = message.loc;
      payload.Label = message.loc;
    }
    // Acknowledge only after durable enqueue. OpenWA retries non-2xx delivery.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        queue.enqueueInbound(`${envelope.sessionId}:${message.id}`, payload),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new AppError(503, 'QUEUE_BUSY', 'Please retry webhook delivery')),
            4000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    res.status(204).end();
  });
  app.post('/api/auth/verify-token', authenticate, async (req, res) => {
    const user = await store.run(async (tx) => {
      const current = await tx.get('users', req.identity.uid);
      if (!current) return null;
      const updated = { ...current, lastActiveAt: market.now() };
      tx.set('users', current.id, updated);
      return updated;
    });
    res.json({ uid: req.identity.uid, profile: user });
  });
  app.post('/api/auth/profile', authenticate, async (req, res) => {
    const input = v.profile.parse(req.body);
    const user = await store.run(async (tx) => {
      const existing = await tx.get('users', req.identity.uid);
      ensure(!existing, 409, 'PROFILE_EXISTS', 'Profile already exists');
      const now = market.now();
      const user = {
        ...input,
        id: req.identity.uid,
        phone: req.identity.phone_number ?? '',
        email: req.identity.email ?? '',
        verificationStatus:
          input.role === 'kabadiwala' ? ('verified' as const) : ('pending' as const),
        createdAt: now,
        lastActiveAt: now,
      };
      tx.create('users', user.id, user);
      return user;
    });
    res.status(201).json(user);
  });
  app.get('/api/categories', (_req, res) => res.json({ categories: v.categories }));
  const shop = async (req: Request, res: Response, buyerRole: 'middleman' | 'recycler') => {
    const q = v.shopQuery.parse(req.query);
    const listings = await store.query('listings', [['status', '==', 'listed']]);
    const filtered = listings.filter(
      (l) =>
        (!q.category || l.category === q.category) &&
        (q.minPrice === undefined || totalPrice(l, buyerRole) >= q.minPrice) &&
        (q.maxPrice === undefined || totalPrice(l, buyerRole) <= q.maxPrice) &&
        (q.radiusKm === undefined ||
          (l.geo && distanceKm({ lat: q.lat!, lng: q.lng! }, l.geo) <= q.radiusKm)),
    );
    // Public DTO deliberately excludes seller IDs, exact coordinates and internal AI/QC fields.
    const items = filtered.map((l) => ({
      id: l.id,
      name: l.name,
      category: l.category,
      condition: l.condition,
      weight: l.weight,
      quantity: l.quantity,
      photoUrl: l.photoUrl,
      price: totalPrice(l, buyerRole),
      priceUnit: l.priceUnit,
      priceNote: l.priceNote,
      priceIsTotal: true,
      status: l.status,
      requiresMiddlemanProcessing: l.isEwaste || l.category === 'mixed',
    }));
    res.json(paginate(items, q));
  };
  app.use('/api', authenticate, profile);
  app.patch('/api/auth/profile', async (req, res) => {
    const input = v.profileUpdate.parse(req.body);
    const result = await store.run(async (tx) => {
      const current = await tx.get('users', req.actor.uid);
      ensure(current, 404, 'NOT_FOUND', 'Profile not found');
      const next = { ...current, ...input, lastActiveAt: market.now() };
      tx.set('users', current.id, next);
      return next;
    });
    res.json(result);
  });
  const changeRole = async (uid: string, role: Role) =>
    store.run(async (tx) => {
      const user = await tx.get('users', uid);
      ensure(user, 404, 'NOT_FOUND', 'User not found');
      const active = await tx.query('deals');
      ensure(
        !active.some((d) => d.status !== 'completed' && (d.buyerId === uid || d.sellerId === uid)),
        409,
        'ACTIVE_DEALS',
        'Finish active deals before changing roles',
      );
      const listings = await tx.query('listings', [['kabadiwalaId', '==', uid]]);
      const inventory = await tx.query('middlemanInventory', [['middlemanId', '==', uid]]);
      ensure(
        role === user.role ||
          (!listings.some((l) => !['sold', 'cancelled'].includes(l.status)) &&
            !inventory.some((i) => i.status !== 'sold')),
        409,
        'ACTIVE_HOLDINGS',
        'Resolve listings and inventory before changing roles',
      );
      tx.set('users', uid, {
        ...user,
        role,
        verificationStatus:
          role === user.role
            ? user.verificationStatus
            : ['middleman', 'recycler'].includes(role)
              ? 'pending'
              : 'verified',
      });
      return { uid, role };
    });
  app.post('/api/auth/set-role', requireRole('admin'), async (req, res) => {
    const input = v.roleChange.extend({ uid: v.id }).strict().parse(req.body);
    res.json(await changeRole(input.uid, input.role));
  });
  app.post('/api/listings/known', requireRole('kabadiwala'), upload, async (req, res) =>
    res.status(201).json(await market.createKnown(req.actor, v.known.parse(form(req)), image(req))),
  );
  app.post('/api/listings/ewaste', requireRole('kabadiwala'), aiLimit, upload, async (req, res) => {
    const photo = image(req);
    ensure(photo, 400, 'PHOTO_REQUIRED', 'Photo is required');
    res.status(201).json(await market.createEwaste(req.actor, v.ewaste.parse(form(req)), photo));
  });
  app.post('/api/detection/material', requireRole('kabadiwala'), aiLimit, upload, async (req, res) => {
    const photo = image(req);
    ensure(photo, 400, 'PHOTO_REQUIRED', 'Photo is required');
    const result = await deps.integrations.detect(photo);
    // A scan is intentionally read-only. It should help a collector decide what to list,
    // without creating a draft or uploading the image to their inventory.
    res.json({
      description: result.description,
      detection: result.detection,
      price: result.price,
    });
  });
  app.get('/api/listings/mine', async (req, res) =>
    res.json(
      paginate(await store.query('listings', [['kabadiwalaId', '==', req.actor.uid]]), req.query),
    ),
  );
  app.patch('/api/listings/:id/manual', requireRole('kabadiwala'), async (req, res) => {
    const input = v.price.omit({ priceNote: true }).strict().parse(req.body);
    const listingId = param(req);
    await store.run(async (tx) => {
      const listing = await tx.get('listings', listingId);
      ensure(listing?.kabadiwalaId === req.actor.uid, 404, 'NOT_FOUND', 'Listing not found');
      ensure(
        listing.type === 'known' && listing.status === 'draft',
        409,
        'INVALID_STATE',
        'Only known-material drafts can be manually priced',
      );
      tx.set('listings', listingId, {
        ...listing,
        ...input,
        status: 'priced',
        priceNote: 'Seller supplied price; verify before trading.',
        updatedAt: market.now(),
      });
    });
    res.json(await market.checkPriorityAndAssign(listingId));
  });
  app.get('/api/listings/:id', async (req, res) => {
    const listing = await store.get('listings', param(req));
    ensure(listing, 404, 'NOT_FOUND', 'Listing not found');
    const deal = listing.dealId ? await store.get('deals', listing.dealId) : null;
    const participant =
      listing.kabadiwalaId === req.actor.uid ||
      listing.middlemanId === req.actor.uid ||
      deal?.buyerId === req.actor.uid ||
      ['operator', 'admin'].includes(req.actor.user.role);
    if (!participant && listing.status === 'listed') {
      res.json({
        id: listing.id,
        name: listing.name,
        category: listing.category,
        subType: listing.subType,
        condition: listing.condition,
        weight: listing.weight,
        volume: listing.volume,
        quantity: listing.quantity,
        photoUrl: listing.photoUrl,
        price: totalPrice(listing, req.actor.user.role),
        priceUnit: listing.priceUnit,
        priceIsTotal: true,
        priceNote: listing.priceNote,
        status: listing.status,
      });
      return;
    }
    ensure(participant, 403, 'FORBIDDEN', 'This listing is private');
    res.json(listing);
  });
  const cancel = async (req: Request, admin = false) =>
    store.run(async (tx) => {
      const listing = await tx.get('listings', param(req));
      ensure(listing, 404, 'NOT_FOUND', 'Listing not found');
      ensure(
        admin || listing.kabadiwalaId === req.actor.uid,
        403,
        'FORBIDDEN',
        'Listing belongs to another user',
      );
      ensure(
        !listing.dealId && listing.status !== 'sold',
        409,
        'ACTIVE_DEAL',
        'Cannot remove an item with a deal',
      );
      ensure(
        admin || listing.status === 'draft',
        409,
        'INVALID_STATE',
        'Only drafts can be cancelled',
      );
      const tickets = await tx.query('tickets', [['listingId', '==', listing.id]]);
      tx.set('listings', listing.id, { ...listing, status: 'cancelled', updatedAt: market.now() });
      for (const t of tickets) tx.delete('tickets', t.id);
      return { id: listing.id, status: 'cancelled' };
    });
  app.delete('/api/listings/:id', requireRole('kabadiwala', 'admin'), async (req, res) =>
    res.json(await cancel(req, req.actor.user.role === 'admin')),
  );
  app.patch('/api/listings/:id/price', requireRole('operator', 'admin'), async (req, res) => {
    const listingId = param(req);
    const body = v.qc.parse(req.body);
    const tickets = await store.query('tickets', [['listingId', '==', listingId]]);
    const ticket = tickets.find((t) => t.qcStatus !== 'complete');
    if (ticket) {
      res.json(await market.qc(req.actor, ticket.id, body));
      return;
    }
    ensure(
      req.actor.user.role === 'admin',
      409,
      'QC_REQUIRED',
      'Submit the pending QC ticket to set the final price',
    );
    await store.run(async (tx) => {
      const listing = await tx.get('listings', listingId);
      ensure(listing, 404, 'NOT_FOUND', 'Listing not found');
      ensure(
        !listing.dealId && !['sold', 'cancelled', 'qc_pending'].includes(listing.status),
        409,
        'INVALID_STATE',
        'Cannot reprice a reserved, sold, cancelled or uninspected listing',
      );
      tx.set('listings', listingId, {
        ...listing,
        finalPrice: body.finalPrice,
        category: body.category,
        condition: body.condition,
        qcPriceLocked: true,
        status: 'priced',
        updatedAt: market.now(),
      });
    });
    res.json(await market.checkPriorityAndAssign(listingId));
  });
  app.post('/api/middleman/buy', requireRole('middleman'), verified, async (req, res) => {
    const body = v.buy.parse(req.body);
    res
      .status(201)
      .json(await market.offer(req.actor, 'listings', body.listingId, body.agreedPrice));
  });
  app.get('/api/middleman/collector-shop', requireRole('middleman'), (req, res) =>
    shop(req, res, 'middleman'),
  );
  app.post('/api/middleman/aggregate', requireRole('middleman'), verified, async (req, res) => {
    const b = v.aggregate.parse(req.body);
    res
      .status(201)
      .json(await market.aggregate(req.actor, b.listingIds, b.aggregatedCategory, b.askingPrice));
  });
  app.post('/api/middleman/process', requireRole('middleman'), verified, async (req, res) => {
    const body = v.processListing.parse(req.body);
    res
      .status(201)
      .json(await market.processOwnedListing(req.actor, body.listingId, body.materials));
  });
  app.post(
    '/api/middleman/list-to-recycler',
    requireRole('middleman'),
    verified,
    async (req, res) => {
      const b = v.listInventory.parse(req.body);
      res.json(
        await store.run(async (tx) => {
          const item = await tx.get('middlemanInventory', b.inventoryId);
          ensure(item?.middlemanId === req.actor.uid, 404, 'NOT_FOUND', 'Inventory not found');
          ensure(
            item.status === 'holding' || item.status === 'listed_to_recycler',
            409,
            'INVALID_STATE',
            'Inventory already reserved',
          );
          const next = {
            ...item,
            status: 'listed_to_recycler' as const,
            askingPrice: b.askingPrice ?? item.askingPrice,
          };
          tx.set('middlemanInventory', item.id, next);
          return next;
        }),
      );
    },
  );
  app.get('/api/middleman/inventory', requireRole('middleman'), async (req, res) =>
    res.json({
      batches: paginate(
        await store.query('middlemanInventory', [['middlemanId', '==', req.actor.uid]]),
        req.query,
      ),
      unaggregated: paginate(
        (await store.query('listings', [['middlemanId', '==', req.actor.uid]])).filter(
          (l) => !l.inventoryId,
        ),
        req.query,
      ),
    }),
  );
  app.get('/api/recycler/collector-shop', requireRole('recycler'), (req, res) =>
    shop(req, res, 'recycler'),
  );
  app.get('/api/recycler/middleman-shop', requireRole('recycler'), async (req, res) => {
    const q = v.shopQuery.parse(req.query);
    const batches = (
      await store.query('middlemanInventory', [['status', '==', 'listed_to_recycler']])
    ).filter(
      (b) =>
        (!q.category || b.aggregatedCategory === q.category) &&
        (q.minPrice === undefined || b.askingPrice >= q.minPrice) &&
        (q.maxPrice === undefined || b.askingPrice <= q.maxPrice) &&
        q.radiusKm === undefined,
    );
    res.json({ items: [], nextCursor: null, inventory: paginate(batches, q) });
  });
  app.post('/api/recycler/priority', requireRole('recycler'), verified, async (req, res) => {
    const b = v.priority.parse(req.body);
    const id = `${req.actor.uid}_${b.category}`;
    res.json(
      await store.run(async (tx) => {
        const previous = await tx.get('prioritySubscriptions', id);
        const sub = {
          ...b,
          id,
          recyclerId: req.actor.uid,
          createdAt: previous?.createdAt ?? market.now(),
        };
        tx.set('prioritySubscriptions', id, sub);
        return sub;
      }),
    );
  });
  app.get('/api/recycler/priority', requireRole('recycler'), async (req, res) =>
    res.json(
      paginate(
        (await store.query('prioritySubscriptions', [['recyclerId', '==', req.actor.uid]])).filter(
          (s) => s.active && s.expiresAt > market.now(),
        ),
        req.query,
      ),
    ),
  );
  app.post(
    '/api/recycler/offer/listings/:id',
    requireRole('recycler'),
    verified,
    async (req, res) =>
      res
        .status(201)
        .json(
          await market.offer(
            req.actor,
            'listings',
            param(req),
            v.offer.parse(req.body).agreedPrice,
          ),
        ),
  );
  app.post(
    '/api/recycler/offer/inventory/:id',
    requireRole('recycler'),
    verified,
    async (req, res) =>
      res
        .status(201)
        .json(
          await market.offer(
            req.actor,
            'middlemanInventory',
            param(req),
            v.offer.parse(req.body).agreedPrice,
          ),
        ),
  );
  app.post('/api/recycler/offer/:id', requireRole('recycler'), verified, async (req, res) => {
    const id = param(req);
    const listing = await store.get('listings', id);
    const inventory = await store.get('middlemanInventory', id);
    ensure(
      !(listing && inventory),
      409,
      'AMBIGUOUS_ID',
      'Use the explicit listings or inventory route',
    );
    res
      .status(201)
      .json(
        await market.offer(
          req.actor,
          listing ? 'listings' : 'middlemanInventory',
          id,
          v.offer.parse(req.body).agreedPrice,
        ),
      );
  });
  app.get('/api/operator/tickets', requireRole('operator', 'admin'), async (req, res) =>
    res.json(
      paginate(
        (await store.query('tickets')).filter(
          (t) =>
            t.qcStatus !== 'complete' &&
            (!t.operatorId || t.operatorId === req.actor.uid || req.actor.user.role === 'admin'),
        ),
        req.query,
      ),
    ),
  );
  app.patch('/api/operator/tickets/:id', requireRole('operator', 'admin'), async (req, res) =>
    res.json(await market.qc(req.actor, param(req), v.qc.parse(req.body))),
  );
  app.post('/api/operator/tickets/:id/claim', requireRole('operator', 'admin'), async (req, res) =>
    res.json(
      await store.run(async (tx) => {
        const ticket = await tx.get('tickets', param(req));
        ensure(ticket, 404, 'NOT_FOUND', 'Ticket not found');
        ensure(
          ticket.qcStatus !== 'complete' &&
            (!ticket.operatorId || ticket.operatorId === req.actor.uid),
          409,
          'UNAVAILABLE',
          'Ticket is already claimed',
        );
        const next = {
          ...ticket,
          operatorId: req.actor.uid,
          qcStatus: 'in_progress' as const,
          collectedAt: market.now(),
        };
        tx.set('tickets', ticket.id, next);
        return next;
      }),
    ),
  );
  const readDeal = async (req: Request) => {
    const deal = await store.get('deals', param(req));
    ensure(deal, 404, 'NOT_FOUND', 'Deal not found');
    ensure(
      [deal.buyerId, deal.sellerId].includes(req.actor.uid) ||
        ['operator', 'admin'].includes(req.actor.user.role),
      403,
      'FORBIDDEN',
      'Deal is private',
    );
    return deal;
  };
  app.get('/api/deals', async (req, res) => {
    const [buy, sell] = await Promise.all([
      store.query('deals', [['buyerId', '==', req.actor.uid]]),
      store.query('deals', [['sellerId', '==', req.actor.uid]]),
    ]);
    res.json(paginate([...buy, ...sell], req.query));
  });
  app.get('/api/deals/:id', async (req, res) => res.json(await readDeal(req)));
  app.post('/api/deals/:id/accept', async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    res.json(await market.accept(req.actor, param(req)));
  });
  app.post('/api/deals/:id/complete', async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    res.json(await market.complete(req.actor, param(req)));
  });
  app.get('/api/deals/:id/chat', async (req, res) => {
    const deal = await readDeal(req);
    res.json({
      thread: await store.get('chatThreads', deal.id),
      ...paginate(await store.query('chatMessages', [['dealId', '==', deal.id]]), req.query),
    });
  });
  app.post('/api/deals/:id/chat', async (req, res) => {
    const text = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(req.body).text;
    const deal = await readDeal(req);
    const result = await store.run(async (tx) => {
      const thread = await tx.get('chatThreads', deal.id);
      ensure(thread, 404, 'NOT_FOUND', 'Thread not found');
      const isStaff = ['operator', 'admin'].includes(req.actor.user.role);
      ensure(
        !isStaff ||
          !thread.operatorId ||
          thread.operatorId === req.actor.uid ||
          req.actor.user.role === 'admin',
        403,
        'ASSIGNED_ELSEWHERE',
        'Another operator mediates this chat',
      );
      if (isStaff && !thread.operatorId)
        tx.set('chatThreads', thread.id, { ...thread, operatorId: req.actor.uid });
      const message = {
        id: store.id(),
        dealId: deal.id,
        senderId: req.actor.uid,
        text,
        ts: market.now(),
      };
      tx.create('chatMessages', message.id, message);
      return message;
    });
    res.status(201).json(result);
  });
  app.get('/api/ledger', async (req, res) =>
    res.json(
      paginate(await store.query('ledgerEntries', [['userId', '==', req.actor.uid]]), req.query),
    ),
  );
  app.get('/api/notifications', async (req, res) =>
    res.json(
      paginate(await store.query('notifications', [['userId', '==', req.actor.uid]]), req.query),
    ),
  );
  app.get('/api/pickups', requireRole('kabadiwala', 'admin'), async (req, res) =>
    res.json(
      paginate(
        req.actor.user.role === 'admin'
          ? await store.query('whatsappRequests')
          : await store.query('whatsappRequests', [['assignedKabadiwalaId', '==', req.actor.uid]]),
        req.query,
      ),
    ),
  );
  app.patch('/api/pickups/:id', requireRole('kabadiwala', 'admin'), async (req, res) => {
    const body = z
      .object({ status: z.literal('completed') })
      .strict()
      .parse(req.body);
    res.json(
      await store.run(async (tx) => {
        const pickup = await tx.get('whatsappRequests', param(req));
        ensure(pickup, 404, 'NOT_FOUND', 'Pickup not found');
        ensure(
          pickup.assignedKabadiwalaId === req.actor.uid || req.actor.user.role === 'admin',
          403,
          'FORBIDDEN',
          'Pickup belongs to another collector',
        );
        ensure(pickup.status !== 'pending', 409, 'INVALID_STATE', 'Assign a collector first');
        const next = { ...pickup, ...body };
        tx.set('whatsappRequests', pickup.id, next);
        return next;
      }),
    );
  });
  app.get('/api/price/:category', aiLimit, async (req, res) =>
    res.json(await market.reference(v.category.parse(req.params.category))),
  );
  app.use('/api/admin', requireRole('admin'));
  app.get('/api/admin/users', async (req, res) => {
    const query = v.page
      .extend({ role: z.enum(roles).optional() })
      .strict()
      .parse(req.query);
    res.json(
      paginate(await store.query('users', query.role ? [['role', '==', query.role]] : []), query),
    );
  });
  app.patch('/api/admin/users/:uid/verify', async (req, res) => {
    const body = z
      .object({ verificationStatus: z.enum(['verified', 'rejected']) })
      .strict()
      .parse(req.body);
    res.json(
      await store.run(async (tx) => {
        const user = await tx.get('users', param(req, 'uid'));
        ensure(user, 404, 'NOT_FOUND', 'User not found');
        ensure(
          ['middleman', 'recycler'].includes(user.role),
          400,
          'INVALID_ROLE',
          'Verification applies to buyers',
        );
        const next = { ...user, ...body };
        tx.set('users', user.id, next);
        return next;
      }),
    );
  });
  app.patch('/api/admin/users/:uid/role', async (req, res) =>
    res.json(await changeRole(param(req, 'uid'), v.roleChange.parse(req.body).role)),
  );
  for (const collection of ['listings', 'tickets', 'deals'] as const)
    app.get(`/api/admin/${collection}`, async (req, res) =>
      res.json(paginate(await store.query(collection), req.query)),
    );
  app.get('/api/admin/stats', async (_req, res) => {
    const [listings, deals, users] = await Promise.all([
      store.query('listings'),
      store.query('deals'),
      store.query('users'),
    ]);
    const completed = deals.filter((d) => d.status === 'completed');
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const active = (role: Role) =>
      users.filter(
        (u) => u.role === role && u.verificationStatus !== 'rejected' && u.lastActiveAt >= cutoff,
      ).length;
    res.json({
      totalListings: listings.length,
      completedDeals: completed.length,
      activeKabadiwalas: active('kabadiwala'),
      activeRecyclers: active('recycler'),
      activeUsersByRole: Object.fromEntries(roles.map((r) => [r, active(r)])),
      totalValueTransacted:
        Math.round(completed.reduce((s, d) => s + d.agreedPrice, 0) * 100) / 100,
      currency: 'INR',
      activeWindowDays: 30,
    });
  });
  app.patch('/api/admin/price/:category', async (req, res) => {
    const category = v.category.parse(req.params.category);
    const input = v.price.parse(req.body);
    const price = {
      ...input,
      id: category,
      category,
      currency: 'INR' as const,
      marketTrend: 'stable' as const,
      source: 'operator_manual' as const,
      lastUpdated: market.now(),
    };
    await store.run(async (tx) => {
      tx.set('priceReference', category, price);
    });
    res.json(price);
  });
  app.delete('/api/admin/listings/:id', async (req, res) => res.json(await cancel(req, true)));
  app.patch('/api/admin/pickups/:id/assign', async (req, res) => {
    const body = z.object({ kabadiwalaId: v.id }).strict().parse(req.body);
    res.json(
      await store.run(async (tx) => {
        const pickup = await tx.get('whatsappRequests', param(req));
        const collector = await tx.get('users', body.kabadiwalaId);
        ensure(
          pickup && pickup.status !== 'completed',
          409,
          'INVALID_STATE',
          'Pickup is unavailable',
        );
        ensure(
          collector?.role === 'kabadiwala' &&
            collector.available &&
            collector.verificationStatus !== 'rejected',
          409,
          'UNAVAILABLE',
          'Collector unavailable',
        );
        const next = { ...pickup, status: 'assigned' as const, assignedKabadiwalaId: collector.id };
        tx.set('whatsappRequests', pickup.id, next);
        market.notify(
          tx,
          collector.id,
          'pickup_assigned',
          pickup.id,
          'A household pickup has been assigned.',
        );
        return next;
      }),
    );
  });
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'An unexpected error occurred';
    if (error instanceof AppError) {
      ({ status, code, message } = error);
    } else if (error instanceof ZodError) {
      status = 400;
      code = 'INVALID_INPUT';
      message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } else if (error instanceof multer.MulterError) {
      status = 400;
      code = 'INVALID_UPLOAD';
      message = 'Upload must be one image no larger than 8 MB';
    } else if (
      error instanceof SyntaxError ||
      (typeof error === 'object' && error !== null && 'status' in error && error.status === 400)
    ) {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Malformed request body';
    }
    if (status === 500) console.error(JSON.stringify({ requestId: req.requestId, code }));
    res.status(status).json({ error: { code, message, requestId: req.requestId } });
  });
  return app;
}
