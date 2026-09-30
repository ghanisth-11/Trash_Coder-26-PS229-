import { createHash, randomUUID } from 'node:crypto';
import type { Job, Pickup, Session } from './domain.js';
import { distanceKm } from './domain.js';
import type { Store, Unit } from './store.js';
import type { Integrations } from './integrations.js';
export class JobQueue {
  constructor(
    private store: Store,
    private integrations: Integrations,
  ) {}
  async enqueueInbound(messageId: string, payload: Record<string, string>) {
    return this.store.run(async (tx) => {
      const existing = await tx.get('jobs', messageId);
      if (existing) return;
      const now = new Date().toISOString();
      tx.create('jobs', messageId, {
        id: messageId,
        kind: 'inbound',
        status: 'pending',
        payload,
        attempts: 0,
        availableAt: now,
        leaseUntil: null,
        leaseToken: null,
        createdAt: now,
      });
    });
  }
  private outgoing(tx: Unit, id: string, to: string, text: string) {
    const now = new Date().toISOString();
    tx.create('jobs', id, {
      id,
      kind: 'whatsapp',
      status: 'pending',
      payload: { to, text },
      attempts: 0,
      availableAt: now,
      leaseUntil: null,
      leaseToken: null,
      createdAt: now,
    });
  }
  private async inbound(jobId: string) {
    return this.store.run(async (tx) => {
      const job = await tx.get('jobs', jobId);
      if (!job || job.status === 'done') return;
      const phone = job.payload.From!;
      const sessionId = createHash('sha256').update(phone).digest('hex');
      const session = await tx.get('whatsappSessions', sessionId);
      const preceding = await tx.query('jobs', [['kind', '==', 'inbound']]);
      if (
        preceding.some(
          (j) =>
            j.id !== job.id &&
            j.payload.From === phone &&
            j.status !== 'done' &&
            j.status !== 'failed' &&
            (j.createdAt < job.createdAt || (j.createdAt === job.createdAt && j.id < job.id)),
        )
      )
        return;
      const candidates =
        session?.conversationState === 'time'
          ? await tx.query('users', [['role', '==', 'kabadiwala']])
          : [];
      const now = new Date().toISOString();
      const text = job.payload.Body?.trim() ?? '';
      let reply: string;
      if (!session || /^restart$/i.test(text)) {
        const fresh: Session = {
          id: sessionId,
          phoneNumber: phone,
          conversationState: 'description',
          wasteDescription: '',
          address: '',
          locality: '',
          geo: null,
          updatedAt: now,
        };
        tx.set('whatsappSessions', sessionId, fresh);
        reply =
          'Welcome to Kabadiwala Connect! What waste would you like to dispose of? Send restart any time to start again.';
      } else if (session.conversationState === 'description') {
        if (!text) reply = 'Please describe the waste you want collected.';
        else {
          tx.set('whatsappSessions', sessionId, {
            ...session,
            wasteDescription: text,
            conversationState: 'address',
            updatedAt: now,
          });
          reply =
            'Please send your full address/locality, or share your WhatsApp location (include the address in its label).';
        }
      } else if (session.conversationState === 'address') {
        const lat = Number(job.payload.Latitude),
          lng = Number(job.payload.Longitude);
        const geo =
          job.payload.Latitude &&
          job.payload.Longitude &&
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
            ? { lat, lng }
            : null;
        const address = job.payload.Address || job.payload.Label || text;
        if (!address && !geo) reply = 'Please send an address or share your location.';
        else {
          tx.set('whatsappSessions', sessionId, {
            ...session,
            address: address || `Shared location ${lat}, ${lng}`,
            locality: address.trim().toLowerCase(),
            geo,
            conversationState: 'time',
            updatedAt: now,
          });
          reply = 'What day and time would you prefer for pickup?';
        }
      } else if (!text) reply = 'Please send your preferred pickup day and time.';
      else {
        const available = candidates.filter(
          (u) => u.available && u.verificationStatus !== 'rejected',
        );
        const geo = session.geo;
        const nearest = geo
          ? available
              .filter((u) => u.geo)
              .sort(
                (a, b) =>
                  distanceKm(geo, a.geo!) - distanceKm(geo, b.geo!) || a.id.localeCompare(b.id),
              )[0]
          : available
              .filter((u) => u.locality && session.locality.includes(u.locality.toLowerCase()))
              .sort((a, b) => a.id.localeCompare(b.id))[0];
        const pickup: Pickup = {
          id: job.id,
          fromNumber: phone,
          address: session.address,
          locality: session.locality,
          geo,
          wasteDescription: session.wasteDescription,
          preferredTime: text,
          status: nearest ? 'assigned' : 'pending',
          assignedKabadiwalaId: nearest?.id ?? null,
          createdAt: now,
        };
        tx.create('whatsappRequests', pickup.id, pickup);
        tx.delete('whatsappSessions', sessionId);
        if (nearest) {
          const id = `${job.id}_pickup`;
          tx.create('notifications', id, {
            id,
            userId: nearest.id,
            kind: 'pickup_assigned',
            resourceId: pickup.id,
            text: 'A household pickup has been assigned to you.',
            createdAt: now,
          });
        }
        reply = nearest
          ? `Pickup request received. ${nearest.name} has been assigned. Preferred time: ${text}. They will coordinate with you.`
          : 'Pickup request received. Our team will assign a local collector. Share location next time for nearest-collector matching.';
      }
      this.outgoing(tx, `${job.id}_reply`, phone, reply);
      tx.set('jobs', job.id, { ...job, status: 'done' });
    });
  }
  async tick() {
    const now = new Date().toISOString();
    const pending = await this.store.query('jobs', [['status', '==', 'pending']]);
    const processing = await this.store.query('jobs', [['status', '==', 'processing']]);
    const jobs = [...pending, ...processing.filter((j) => j.leaseUntil && j.leaseUntil < now)]
      .filter((j) => j.availableAt <= now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, 30);
    for (const candidate of jobs) {
      if (candidate.kind === 'inbound') {
        await this.inbound(candidate.id);
        continue;
      }
      const leaseToken = randomUUID();
      const job = await this.store.run(async (tx) => {
        const current = await tx.get('jobs', candidate.id);
        if (
          !current ||
          current.status === 'done' ||
          current.status === 'failed' ||
          (current.status === 'processing' && current.leaseUntil! > now)
        )
          return null;
        const next: Job = {
          ...current,
          status: 'processing',
          leaseToken,
          leaseUntil: new Date(Date.now() + 60000).toISOString(),
          attempts: current.attempts + 1,
        };
        tx.set('jobs', next.id, next);
        return next;
      });
      if (!job) continue;
      let success = false;
      try {
        await this.integrations.send(job.payload.to!, job.payload.text!);
        success = true;
      } catch {
        /* Retry without logging provider payloads or credentials. */
      }
      await this.store.run(async (tx) => {
        const current = await tx.get('jobs', job.id);
        if (current?.leaseToken !== leaseToken) return;
        tx.set('jobs', job.id, {
          ...current,
          status: success ? 'done' : job.attempts >= 5 ? 'failed' : 'pending',
          availableAt: new Date(
            Date.now() + Math.min(300000, 2 ** job.attempts * 1000),
          ).toISOString(),
          leaseUntil: null,
          leaseToken: null,
        });
      });
    }
  }
}
