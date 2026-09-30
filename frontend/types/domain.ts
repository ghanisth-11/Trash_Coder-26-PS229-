import type { AppLanguage } from '@/lib/i18n';

export type UserRole = 'KABADIWALA' | 'MIDDLEMAN' | 'RECYCLER' | 'ADMIN';
export type MaterialCategory =
  'paper' | 'plastic' | 'metal' | 'glass' | 'cardboard' | 'textile' | 'e-waste' | 'mixed' | 'other';
export type LotStatus =
  | 'DRAFT'
  | 'LISTED'
  | 'RESERVED'
  | 'PURCHASED'
  | 'PICKUP_SCHEDULED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'PAYMENT_PENDING'
  | 'COMPLETED'
  | 'CANCELLED';
export type InventoryStatus =
  | 'PURCHASED'
  | 'RECEIVED'
  | 'AWAITING_INSPECTION'
  | 'UNDER_INSPECTION'
  | 'SEGREGATION_REQUIRED'
  | 'SEGREGATED'
  | 'READY_FOR_BATCH'
  | 'ALLOCATED_TO_BATCH';
export type PickupStatus =
  | 'REQUESTED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COLLECTOR_EN_ROUTE'
  | 'COLLECTED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'EXPIRED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';
export interface Address {
  locality?: string;
  address?: string;
  lat?: number;
  lng?: number;
}
export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  language: AppLanguage;
  address?: Address;
}
export interface CollectorLot {
  id: string;
  type: 'single' | 'mixed' | 'e-waste';
  category?: MaterialCategory;
  weight?: number;
  unit?: 'kg' | 'piece';
  expectedPrice?: number;
  location?: Address;
  status: LotStatus;
  isRawEWaste?: boolean;
  photos: string[];
  notes?: string;
}
export interface BulkLot extends CollectorLot {
  grade?: string;
  processingInfo?: string;
}
export interface PickupRequest {
  id: string;
  status: PickupStatus;
  householdName: string;
  phone: string;
  description: string;
  address?: Address;
  requestedTime?: string;
  images: string[];
}
export interface LedgerTransaction {
  id: string;
  lotName: string;
  buyer: string;
  amount: number;
  paymentStatus: PaymentStatus;
  date: string;
}
export interface PriceReference {
  category: MaterialCategory;
  price: number;
  unit: string;
  updatedAt: string;
  trend?: 'up' | 'down' | 'flat';
}
export interface MaterialDetectionResult {
  material: string;
  confidence: number;
  category: MaterialCategory;
  estimatedPriceRange?: string;
  pricePerKg?: number;
  reference?: string;
  disclaimer: string;
}
export interface InventoryItem {
  id: string;
  material: string;
  status: InventoryStatus;
  weight?: number;
  acquiredAt: string;
}
export interface Order {
  id: string;
  source: 'COLLECTOR_SHOP' | 'MIDDLEMAN_SHOP';
  status: LotStatus;
}
