import type { Actor, Deal, Inventory, Listing, Price, Ticket } from './domain.js';
import { AppError, ensure, totalPrice } from './domain.js';
import type { Store, Unit } from './store.js';
import type { Integrations, ImageInput } from './integrations.js';
import type { EwasteInput, KnownInput, QCInput } from './validation.js';
export class Marketplace {
  constructor(
    public store: Store,
    public integrations: Integrations,
  ) {}
  now() {
    return new Date().toISOString();
  }
  notify(tx: Unit, userId: string, kind: string, resourceId: string, text: string) {
    const id = this.store.id();
    tx.create('notifications', id, { id, userId, kind, resourceId, text, createdAt: this.now() });
  }
  async reference(category: string): Promise<Price> {
    const existing = await this.store.get('priceReference', category);
    if (existing) return existing;
    const estimate = await this.integrations.estimate(category);
    return this.store.run(async (tx) => {
      const current = await tx.get('priceReference', category);
      if (current) return current;
      tx.create('priceReference', category, { ...estimate, id: category });
      return estimate;
    });
  }
  private base(actor: Actor, input: KnownInput | EwasteInput, photoUrl: string[]): Listing {
    const now = this.now();
    return {
      id: this.store.id(),
      type: 'known',
      status: 'draft',
      kabadiwalaId: actor.uid,
      middlemanId: null,
      category: input.category,
      subType: '',
      name: 'Scrap material',
      condition: 'unknown',
      weight: input.weight,
      volume: input.volume,
      quantity: input.quantity,
      photoUrl,
      isEwaste: false,
      needsOperatorQC: false,
      aiDescription: '',
      aiConfidence: '',
      aiFailed: false,
      aiPipeline: {
        status: 'not_run',
        model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
        promptVersion: 'scrap-v1',
        attemptedAt: null,
        completedAt: null,
        failureCode: null,
        identification: null,
        classification: null,
        pricing: null,
      },
      keyComponents: [],
      currency: 'INR',
      marketTrend: null,
      buyPrice: 0,
      sellPrice: 0,
      priceUnit: 'per_kg',
      priceNote: '',
      finalPrice: null,
      qcPriceLocked: false,
      geo: input.geo ?? actor.user.geo,
      inventoryId: null,
      dealId: null,
      createdAt: now,
      updatedAt: now,
    };
  }
  async createKnown(actor: Actor, input: KnownInput, image?: ImageInput) {
    const photos = image ? [await this.integrations.upload(image)] : [];
    let price: Price | null = await this.store.get('priceReference', input.category);
    if (!price && (input.buyPrice === undefined || input.sellPrice === undefined)) {
      try {
        price = await this.reference(input.category);
      } catch {
        /* Draft preserves manual pricing fallback. */
      }
    }
    const listing = {
      ...this.base(actor, input, photos),
      name: input.name,
      buyPrice: input.buyPrice ?? price?.buyPrice ?? 0,
      sellPrice: input.sellPrice ?? price?.sellPrice ?? 0,
      priceUnit:
        input.buyPrice !== undefined && input.sellPrice !== undefined
          ? input.priceUnit
          : (price?.priceUnit ?? input.priceUnit),
      priceNote: price?.priceNote ?? 'Seller supplied price; verify before trading.',
      marketTrend: price?.marketTrend ?? null,
    };
    listing.status =
      price || (input.buyPrice !== undefined && input.sellPrice !== undefined) ? 'priced' : 'draft';
    await this.store.run(async (tx) => {
      tx.create('listings', listing.id, listing);
    });
    if (listing.status === 'priced') await this.checkPriorityAndAssign(listing.id);
    return this.store.get('listings', listing.id);
  }
  async createEwaste(actor: Actor, input: EwasteInput, image: ImageInput) {
    const listing = this.base(actor, input, [await this.integrations.upload(image)]);
    listing.type = 'ewaste';
    listing.isEwaste = true;
    listing.needsOperatorQC = true;
    let aiResult = null;
    const attemptedAt = this.now();
    listing.aiPipeline = { ...listing.aiPipeline, status: 'failed', attemptedAt };
    try {
      aiResult = await this.integrations.detect(image);
      Object.assign(listing, {
        category: aiResult.detection.category,
        subType: aiResult.detection.subType,
        name: aiResult.detection.name,
        condition: aiResult.detection.condition,
        isEwaste: aiResult.detection.isEwaste,
        needsOperatorQC: aiResult.detection.needsOperatorQC,
        aiDescription: aiResult.description,
        aiConfidence: aiResult.detection.confidence,
        keyComponents: aiResult.detection.keyComponents,
        currency: aiResult.price.currency,
        marketTrend: aiResult.price.marketTrend,
        buyPrice: aiResult.price.buyPrice,
        sellPrice: aiResult.price.sellPrice,
        priceUnit: aiResult.price.priceUnit,
        priceNote: aiResult.price.priceNote,
        aiPipeline: {
          ...aiResult.provenance,
          status: 'succeeded',
          attemptedAt,
          completedAt: this.now(),
          failureCode: null,
        },
      });
    } catch (error) {
      listing.aiFailed = true;
      listing.aiConfidence = 'low';
      listing.aiPipeline = {
        ...listing.aiPipeline,
        failureCode:
          error instanceof AppError && error.code === 'AI_UNAVAILABLE'
            ? 'AI_UNAVAILABLE'
            : error instanceof Error && /zod|json|parse|model response/i.test(error.message)
              ? 'INVALID_MODEL_RESPONSE'
              : error instanceof Error && /AI_UNAVAILABLE/i.test(error.message)
                ? 'AI_UNAVAILABLE'
                : 'UNKNOWN',
      };
      listing.priceNote =
        'AI unavailable. Operator must identify and price this material manually.';
    }
    if (listing.priceUnit === 'per_kg' && listing.weight <= 0) listing.needsOperatorQC = true;
    listing.status = listing.needsOperatorQC ? 'qc_pending' : 'priced';
    const ticket: Ticket | null = listing.needsOperatorQC
      ? {
          id: this.store.id(),
          listingId: listing.id,
          kabadiwalaId: actor.uid,
          operatorId: null,
          aiCategory: listing.category,
          aiConfidence: listing.aiConfidence,
          qcStatus: 'pending',
          qcCategory: null,
          qcCondition: null,
          qcNotes: '',
          finalPrice: null,
          useCase: '',
          collectedAt: null,
          pricedAt: null,
          createdAt: this.now(),
        }
      : null;
    await this.store.run(async (tx) => {
      const ref = aiResult ? await tx.get('priceReference', listing.category) : null;
      tx.create('listings', listing.id, listing);
      if (ticket) tx.create('tickets', ticket.id, ticket);
      if (aiResult && ref?.source !== 'operator_manual')
        tx.set('priceReference', listing.category, { ...aiResult.price, id: listing.category });
      if (ticket && process.env.OPERATOR_ALERT_WHATSAPP) {
        const id = this.store.id();
        tx.create('jobs', id, {
          id,
          kind: 'whatsapp',
          status: 'pending',
          payload: {
            to: process.env.OPERATOR_ALERT_WHATSAPP,
            text: `QC ticket ${ticket.id} needs inspection.`,
          },
          attempts: 0,
          availableAt: this.now(),
          leaseUntil: null,
          leaseToken: null,
          createdAt: this.now(),
        });
      }
    });
    if (!ticket) await this.checkPriorityAndAssign(listing.id);
    return {
      listingId: listing.id,
      ticketId: ticket?.id ?? null,
      aiResult,
      manualReviewRequired: listing.aiFailed,
      listing: await this.store.get('listings', listing.id),
    };
  }
  async checkPriorityAndAssign(listingId: string) {
    return this.store.run(async (tx) => {
      const listing = await tx.get('listings', listingId);
      ensure(listing, 404, 'NOT_FOUND', 'Listing not found');
      if (listing.status !== 'priced') return listing;
      if (listing.isEwaste || listing.category === 'mixed') {
        listing.status = 'listed';
        listing.updatedAt = this.now();
        tx.set('listings', listing.id, listing);
        return listing;
      }
      const subscriptions = await tx.query('prioritySubscriptions', [
        ['category', '==', listing.category],
      ]);
      const eligible = subscriptions
        .filter((s) => s.active && s.expiresAt > this.now())
        .sort(
          (a, b) =>
            b.premiumTier - a.premiumTier ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        );
      let buyer = null;
      for (const sub of eligible) {
        const u = await tx.get('users', sub.recyclerId);
        if (u?.role === 'recycler' && u.verificationStatus === 'verified') {
          buyer = u;
          break;
        }
      }
      if (buyer) {
        const deal = this.newDeal(
          listing.kabadiwalaId,
          'kabadiwala',
          buyer.id,
          'recycler',
          totalPrice(listing, 'recycler'),
          listing.id,
          null,
          'priority_auto',
          true,
        );
        this.writeDeal(tx, deal);
        listing.status = 'assigned';
        listing.dealId = deal.id;
        this.notify(
          tx,
          buyer.id,
          'priority_assignment',
          deal.id,
          'A matching listing has been reserved for you.',
        );
      } else listing.status = 'listed';
      listing.updatedAt = this.now();
      tx.set('listings', listing.id, listing);
      return listing;
    });
  }
  private newDeal(
    sellerId: string,
    sellerRole: Deal['sellerRole'],
    buyerId: string,
    buyerRole: Deal['buyerRole'],
    agreedPrice: number,
    listingId: string | null,
    inventoryId: string | null,
    assignmentType: Deal['assignmentType'],
    sellerApproved: boolean,
  ): Deal {
    return {
      id: this.store.id(),
      sellerId,
      sellerRole,
      buyerId,
      buyerRole,
      agreedPrice,
      listingId,
      inventoryId,
      assignmentType,
      sellerApproved,
      status: 'offered',
      confirmations: [],
      lockedAt: null,
      completedAt: null,
      createdAt: this.now(),
    };
  }
  private writeDeal(tx: Unit, deal: Deal) {
    tx.create('deals', deal.id, deal);
    tx.create('chatThreads', deal.id, {
      id: deal.id,
      dealId: deal.id,
      participantIds: [deal.sellerId, deal.buyerId],
      operatorId: null,
    });
  }
  async offer(
    actor: Actor,
    target: 'listings' | 'middlemanInventory',
    targetId: string,
    amount: number,
  ) {
    return this.store.run(async (tx) => {
      ensure(
        actor.user.role === 'middleman' || actor.user.role === 'recycler',
        403,
        'FORBIDDEN',
        'Buyer role required',
      );
      const item = await tx.get(target, targetId);
      ensure(item, 404, 'NOT_FOUND', 'Item not found');
      let sellerId: string;
      let sellerRole: Deal['sellerRole'];
      let asking: number;
      if (target === 'listings') {
        const listing = item as Listing;
        ensure(
          actor.user.role !== 'recycler' || (!listing.isEwaste && listing.category !== 'mixed'),
          403,
          'MIDDLEMEN_REQUIRED',
          'Mixed material and e-waste must be processed by a middleman before recycler purchase',
        );
        ensure(
          listing.status === 'listed' && !listing.dealId,
          409,
          'UNAVAILABLE',
          'Listing is already reserved or unavailable',
        );
        sellerId = listing.kabadiwalaId;
        sellerRole = 'kabadiwala';
        asking = totalPrice(listing, actor.user.role);
        ensure(
          !listing.qcPriceLocked || amount === listing.finalPrice,
          409,
          'QC_PRICE_LOCKED',
          'Operator QC price is final',
        );
      } else {
        ensure(actor.user.role === 'recycler', 403, 'FORBIDDEN', 'Only recyclers buy inventory');
        const inventory = item as Inventory;
        ensure(
          inventory.status === 'listed_to_recycler' && !inventory.dealId,
          409,
          'UNAVAILABLE',
          'Inventory is unavailable',
        );
        sellerId = inventory.middlemanId;
        sellerRole = 'middleman';
        asking = inventory.askingPrice;
      }
      ensure(sellerId !== actor.uid, 409, 'SELF_PURCHASE', 'Cannot buy your own item');
      const deal = this.newDeal(
        sellerId,
        sellerRole,
        actor.uid,
        actor.user.role,
        amount,
        target === 'listings' ? targetId : null,
        target === 'middlemanInventory' ? targetId : null,
        'direct_offer',
        amount >= asking,
      );
      this.writeDeal(tx, deal);
      if (target === 'listings')
        tx.set('listings', targetId, {
          ...(item as Listing),
          status: 'assigned',
          dealId: deal.id,
          updatedAt: this.now(),
        });
      else
        tx.set('middlemanInventory', targetId, {
          ...(item as Inventory),
          status: 'assigned',
          dealId: deal.id,
        });
      this.notify(tx, sellerId, 'offer', deal.id, 'An offer is waiting for your review.');
      return deal;
    });
  }
  async qc(actor: Actor, ticketId: string, input: QCInput) {
    const listingId = await this.store.run(async (tx) => {
      const ticket = await tx.get('tickets', ticketId);
      ensure(ticket, 404, 'NOT_FOUND', 'Ticket not found');
      ensure(ticket.qcStatus !== 'complete', 409, 'ALREADY_COMPLETE', 'QC already completed');
      ensure(
        !ticket.operatorId || ticket.operatorId === actor.uid || actor.user.role === 'admin',
        403,
        'ASSIGNED_ELSEWHERE',
        'Ticket belongs to another operator',
      );
      const listing = await tx.get('listings', ticket.listingId);
      ensure(
        listing?.status === 'qc_pending' && !listing.dealId,
        409,
        'INVALID_STATE',
        'Listing is not awaiting QC',
      );
      tx.set('tickets', ticket.id, {
        ...ticket,
        operatorId: actor.uid,
        qcStatus: 'complete',
        qcCategory: input.category,
        qcCondition: input.condition,
        qcNotes: input.qcNotes,
        useCase: input.useCase,
        finalPrice: input.finalPrice,
        collectedAt: ticket.collectedAt ?? this.now(),
        pricedAt: this.now(),
      });
      tx.set('listings', listing.id, {
        ...listing,
        category: input.category,
        condition: input.condition,
        finalPrice: input.finalPrice,
        qcPriceLocked: true,
        status: 'priced',
        updatedAt: this.now(),
      });
      this.notify(
        tx,
        listing.kabadiwalaId,
        'qc_complete',
        listing.id,
        `QC complete. Final total price INR ${input.finalPrice}.`,
      );
      return listing.id;
    });
    return this.checkPriorityAndAssign(listingId);
  }
  async aggregate(
    actor: Actor,
    listingIds: string[],
    aggregatedCategory: string,
    askingPrice: number,
  ) {
    return this.store.run(async (tx) => {
      const listings = await Promise.all(listingIds.map((id) => tx.get('listings', id)));
      for (const listing of listings)
        ensure(
          listing?.status === 'sold' && listing.middlemanId === actor.uid && !listing.inventoryId,
          409,
          'INVALID_HOLDING',
          'Every listing must be purchased, completed, owned by you and not already aggregated',
        );
      ensure(
        listings.every(
          (listing) =>
            (!listing!.isEwaste && listing!.category !== 'mixed') || listing!.middlemanInspectedAt,
        ),
        409,
        'PROCESSING_REQUIRED',
        'Inspect and categorize e-waste and mixed material before creating a batch',
      );
      ensure(
        aggregatedCategory !== 'mixed' &&
          listings.every((listing) => listing!.category === aggregatedCategory),
        409,
        'CATEGORY_MISMATCH',
        'A category bulk lot can contain only one segregated material category',
      );
      const batch: Inventory = {
        id: this.store.id(),
        middlemanId: actor.uid,
        sourcedFrom: listingIds,
        aggregatedCategory,
        totalWeight: listings.reduce((s, l) => s + l!.weight, 0),
        askingPrice,
        status: 'holding',
        dealId: null,
        createdAt: this.now(),
      };
      tx.create('middlemanInventory', batch.id, batch);
      for (const listing of listings)
        tx.set('listings', listing!.id, { ...listing!, inventoryId: batch.id });
      return batch;
    });
  }
  async processOwnedListing(
    actor: Actor,
    listingId: string,
    materials: Array<{
      name: string;
      category: string;
      condition: Listing['condition'];
      weight: number;
      quantity: number;
    }>,
  ) {
    return this.store.run(async (tx) => {
      const source = await tx.get('listings', listingId);
      ensure(
        source?.status === 'sold' && source.middlemanId === actor.uid && !source.inventoryId,
        409,
        'INVALID_HOLDING',
        'Only your completed purchases can be processed',
      );
      ensure(
        source.isEwaste || source.category === 'mixed',
        409,
        'PROCESSING_NOT_REQUIRED',
        'This material does not need special processing',
      );
      ensure(
        !source.middlemanInspectedAt && !source.processedInto?.length,
        409,
        'ALREADY_PROCESSED',
        'This lot was already processed',
      );
      const processedWeight = materials.reduce((sum, material) => sum + material.weight, 0);
      ensure(
        processedWeight > 0 &&
          (source.weight === 0 || Math.abs(processedWeight - source.weight) <= 0.05),
        400,
        'WEIGHT_MISMATCH',
        'Processed material weights must add up to the purchased lot weight',
      );
      if (source.category === 'mixed')
        ensure(
          materials.length >= 2,
          400,
          'SEGREGATION_REQUIRED',
          'Split a mixed lot into at least two material categories',
        );
      const outputIds = materials.map(() => this.store.id());
      materials.forEach((material, index) => {
        const output: Listing = {
          ...source,
          id: outputIds[index]!,
          type: 'known',
          name: material.name,
          category: material.category,
          condition: material.condition,
          weight: material.weight,
          quantity: material.quantity,
          isEwaste: false,
          needsOperatorQC: false,
          inventoryId: null,
          dealId: null,
          middlemanInspectedAt: this.now(),
          parentListingId: source.id,
          processedInto: [],
          updatedAt: this.now(),
        };
        tx.create('listings', output.id, output);
      });
      tx.set('listings', source.id, {
        ...source,
        weight: source.weight || processedWeight,
        processedInto: outputIds,
        updatedAt: this.now(),
      });
      return { sourceListingId: source.id, outputListingIds: outputIds };
    });
  }
  async accept(actor: Actor, dealId: string) {
    return this.store.run(async (tx) => {
      const deal = await tx.get('deals', dealId);
      ensure(deal, 404, 'NOT_FOUND', 'Deal not found');
      ensure(
        [deal.sellerId, deal.buyerId].includes(actor.uid),
        403,
        'FORBIDDEN',
        'Only deal parties can accept',
      );
      ensure(deal.status !== 'completed', 409, 'INVALID_STATE', 'Deal already complete');
      if (deal.status === 'locked') return deal;
      if (actor.uid === deal.sellerId) deal.sellerApproved = true;
      else {
        ensure(
          deal.sellerApproved,
          409,
          'SELLER_APPROVAL_REQUIRED',
          'Seller must approve a below-asking offer',
        );
        deal.status = 'locked';
        deal.lockedAt = this.now();
      }
      tx.set('deals', deal.id, deal);
      return deal;
    });
  }
  async complete(actor: Actor, dealId: string) {
    return this.store.run(async (tx) => {
      const deal = await tx.get('deals', dealId);
      ensure(deal, 404, 'NOT_FOUND', 'Deal not found');
      ensure(
        [deal.sellerId, deal.buyerId].includes(actor.uid),
        403,
        'FORBIDDEN',
        'Only deal parties can complete',
      );
      if (deal.status === 'completed') return deal;
      ensure(deal.status === 'locked', 409, 'INVALID_STATE', 'Accept the deal first');
      const listing = deal.listingId ? await tx.get('listings', deal.listingId) : null;
      const inventory = deal.inventoryId
        ? await tx.get('middlemanInventory', deal.inventoryId)
        : null;
      ensure(
        (listing ?? inventory)?.dealId === deal.id,
        409,
        'INVALID_STATE',
        'Reservation does not match deal',
      );
      deal.confirmations = Array.from(new Set([...deal.confirmations, actor.uid]));
      if (deal.confirmations.length === 2) {
        deal.status = 'completed';
        deal.completedAt = this.now();
        for (const [userId, role, direction] of [
          [deal.sellerId, deal.sellerRole, 'credit'],
          [deal.buyerId, deal.buyerRole, 'debit'],
        ] as const) {
          const id = `${deal.id}_${direction}`;
          tx.create('ledgerEntries', id, {
            id,
            userId,
            role,
            dealId: deal.id,
            listingId: deal.listingId,
            amount: deal.agreedPrice,
            direction,
            ts: this.now(),
          });
        }
        if (listing)
          tx.set('listings', listing.id, {
            ...listing,
            status: 'sold',
            middlemanId: deal.buyerRole === 'middleman' ? deal.buyerId : null,
            updatedAt: this.now(),
          });
        if (inventory) tx.set('middlemanInventory', inventory.id, { ...inventory, status: 'sold' });
      }
      tx.set('deals', deal.id, deal);
      return deal;
    });
  }
}
