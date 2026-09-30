export const roles = ['kabadiwala', 'middleman', 'recycler', 'operator', 'admin'] as const;
export type Role = (typeof roles)[number];
export interface Geo {
  lat: number;
  lng: number;
}
export interface User {
  id: string;
  role: Role;
  name: string;
  phone: string;
  email: string;
  address: string;
  locality: string;
  geo: Geo | null;
  available: boolean;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  createdAt: string;
  lastActiveAt: string;
}
export interface Price {
  category: string;
  buyPrice: number;
  sellPrice: number;
  priceUnit: 'per_kg' | 'per_piece' | 'per_lot';
  currency: 'INR';
  priceNote: string;
  marketTrend: 'stable' | 'rising' | 'falling';
  source: 'gemini_estimate' | 'operator_manual';
  lastUpdated: string;
}
export interface Detection {
  name: string;
  category: string;
  subType: string;
  condition: string;
  isEwaste: boolean;
  needsOperatorQC: boolean;
  keyComponents: string[];
  confidence: 'high' | 'medium' | 'low';
}
export interface AiPipeline {
  status: 'not_run' | 'succeeded' | 'failed';
  model: string;
  promptVersion: string;
  attemptedAt: string | null;
  completedAt: string | null;
  failureCode: 'AI_UNAVAILABLE' | 'INVALID_MODEL_RESPONSE' | 'UNKNOWN' | null;
  // These are normalized, validated model outputs. Never store provider credentials or raw errors.
  identification: string | null;
  classification: Detection | null;
  pricing: Price | null;
}
export interface Listing {
  id: string;
  type: 'known' | 'ewaste';
  status:
    'draft' | 'detected' | 'qc_pending' | 'priced' | 'listed' | 'assigned' | 'sold' | 'cancelled';
  kabadiwalaId: string;
  middlemanId: string | null;
  category: string;
  subType: string;
  name: string;
  condition: string;
  weight: number;
  volume: number;
  quantity: number;
  photoUrl: string[];
  isEwaste: boolean;
  needsOperatorQC: boolean;
  aiDescription: string;
  aiConfidence: string;
  aiFailed: boolean;
  aiPipeline: AiPipeline;
  keyComponents: string[];
  currency: 'INR';
  marketTrend: Price['marketTrend'] | null;
  buyPrice: number;
  sellPrice: number;
  priceUnit: Price['priceUnit'];
  priceNote: string;
  finalPrice: number | null;
  qcPriceLocked: boolean;
  geo: Geo | null;
  inventoryId: string | null;
  dealId: string | null;
  middlemanInspectedAt?: string | null;
  parentListingId?: string | null;
  processedInto?: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Ticket {
  id: string;
  listingId: string;
  kabadiwalaId: string;
  operatorId: string | null;
  aiCategory: string;
  aiConfidence: string;
  qcStatus: 'pending' | 'in_progress' | 'complete';
  qcCategory: string | null;
  qcCondition: string | null;
  qcNotes: string;
  finalPrice: number | null;
  useCase: string;
  collectedAt: string | null;
  pricedAt: string | null;
  createdAt: string;
}
export interface Inventory {
  id: string;
  middlemanId: string;
  sourcedFrom: string[];
  aggregatedCategory: string;
  totalWeight: number;
  askingPrice: number;
  status: 'holding' | 'listed_to_recycler' | 'assigned' | 'sold';
  dealId: string | null;
  createdAt: string;
}
export interface Subscription {
  id: string;
  recyclerId: string;
  category: string;
  premiumTier: number;
  active: boolean;
  expiresAt: string;
  createdAt: string;
}
export interface Deal {
  id: string;
  listingId: string | null;
  inventoryId: string | null;
  sellerId: string;
  buyerId: string;
  sellerRole: Role;
  buyerRole: Role;
  assignmentType: 'priority_auto' | 'open_shop' | 'direct_offer';
  agreedPrice: number;
  status: 'offered' | 'locked' | 'completed';
  sellerApproved: boolean;
  confirmations: string[];
  lockedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
export interface Thread {
  id: string;
  dealId: string;
  participantIds: string[];
  operatorId: string | null;
}
export interface Message {
  id: string;
  dealId: string;
  senderId: string;
  text: string;
  ts: string;
}
export interface Ledger {
  id: string;
  userId: string;
  role: Role;
  dealId: string;
  listingId: string | null;
  amount: number;
  direction: 'credit' | 'debit';
  ts: string;
}
export interface Notification {
  id: string;
  userId: string;
  kind: string;
  resourceId: string;
  text: string;
  createdAt: string;
}
export interface Pickup {
  id: string;
  fromNumber: string;
  address: string;
  locality: string;
  geo: Geo | null;
  wasteDescription: string;
  preferredTime: string;
  status: 'pending' | 'assigned' | 'completed';
  assignedKabadiwalaId: string | null;
  createdAt: string;
}
export interface Session {
  id: string;
  phoneNumber: string;
  conversationState: 'description' | 'address' | 'time';
  wasteDescription: string;
  address: string;
  locality: string;
  geo: Geo | null;
  updatedAt: string;
}
export interface Job {
  id: string;
  kind: 'inbound' | 'whatsapp';
  status: 'pending' | 'processing' | 'done' | 'failed';
  payload: Record<string, string>;
  attempts: number;
  availableAt: string;
  leaseUntil: string | null;
  leaseToken: string | null;
  createdAt: string;
}
export interface Schema {
  users: User;
  listings: Listing;
  tickets: Ticket;
  middlemanInventory: Inventory;
  prioritySubscriptions: Subscription;
  deals: Deal;
  chatThreads: Thread;
  chatMessages: Message;
  ledgerEntries: Ledger;
  notifications: Notification;
  whatsappRequests: Pickup;
  whatsappSessions: Session;
  jobs: Job;
  priceReference: Price & { id: string };
}
export type Collection = keyof Schema;
export interface Actor {
  uid: string;
  user: User;
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  value: unknown,
  status: number,
  code: string,
  message: string,
): asserts value {
  if (!value) throw new AppError(status, code, message);
}
export function distanceKm(a: Geo, b: Geo): number {
  const r = Math.PI / 180;
  const d =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(d), Math.sqrt(1 - d));
}
export function totalPrice(listing: Listing, buyerRole: Role): number {
  if (listing.finalPrice !== null) return listing.finalPrice;
  const rate = buyerRole === 'middleman' ? listing.buyPrice : listing.sellPrice;
  return (
    Math.round(
      rate *
        (listing.priceUnit === 'per_kg'
          ? listing.weight
          : listing.priceUnit === 'per_piece'
            ? listing.quantity
            : 1) *
        100,
    ) / 100
  );
}
