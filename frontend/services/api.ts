import type {
  BulkLot,
  CollectorLot,
  InventoryItem,
  LedgerTransaction,
  PickupRequest,
  PriceReference,
} from '@/types/domain';
import { getFirebaseAuth } from '@/lib/firebase';
export interface DirectBulkLotInput {
  category: string;
  weight: number;
  unit: 'kg' | 'piece';
  grade: string;
  expectedPrice: number;
  location: string;
  description?: string;
  processingInfo?: string;
}

export type BackendRole = 'kabadiwala' | 'middleman' | 'recycler' | 'operator' | 'admin';
export interface BackendProfile {
  id: string;
  name: string;
  role: BackendRole;
  verificationStatus: 'pending' | 'verified' | 'rejected';
  email?: string;
}
export interface CreateProfileInput {
  role: Exclude<BackendRole, 'operator' | 'admin'>;
  name: string;
  address?: string;
  locality?: string;
}
export interface ShopItem {
  id: string;
  name: string;
  category: string;
  condition: string;
  weight: number;
  quantity: number;
  photoUrl: string[];
  price: number;
  priceUnit: string;
  priceNote: string;
  status: string;
  requiresMiddlemanProcessing?: boolean;
}
export interface ShopQuery {
  category?: string;
  minPrice?: string;
  maxPrice?: string;
}
export interface MaterialScanResult {
  description: string;
  detection: {
    name: string;
    category: string;
    subType: string;
    condition: string;
    isEwaste: boolean;
    needsOperatorQC: boolean;
    keyComponents: string[];
    confidence: 'high' | 'medium' | 'low';
  };
  price: {
    buyPrice: number;
    sellPrice: number;
    priceUnit: 'per_kg' | 'per_piece' | 'per_lot';
    currency: 'INR';
    priceNote: string;
    marketTrend: 'stable' | 'rising' | 'falling';
  };
}
export interface AdminStats {
  totalListings: number;
  completedDeals: number;
  activeKabadiwalas: number;
  activeRecyclers: number;
  totalValueTransacted: number;
  currency: string;
}
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: BackendRole;
  verificationStatus: 'pending' | 'verified' | 'rejected';
}
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly requestId?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
const isVercelPreview =
  typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app');
// Vercel forwards /api requests through frontend/vercel.json. Keeping calls same-origin
// there prevents an outdated public environment variable from reaching a missing route
// and avoids browser CORS restrictions on camera uploads.
const BASE_URL = isVercelPreview
  ? ''
  : (configuredApiBaseUrl ||
    (process.env.NODE_ENV === 'production'
      ? 'https://trash-coder-26-ps229.onrender.com'
      : 'http://localhost:3000'));
function queryString(query: ShopQuery) {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.minPrice) params.set('minPrice', query.minPrice);
  if (query.maxPrice) params.set('maxPrice', query.maxPrice);
  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new ApiError('Sign in is required to use Kabadiwala Connect.', 'UNAUTHENTICATED');
  const token = await user.getIdToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; requestId?: string } }
      | null;
    throw new ApiError(
      body?.error?.message ?? 'Unable to complete this request right now.',
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.requestId,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export const api = {
  verifyToken: () => request<{ uid: string; profile: BackendProfile | null }>('/api/auth/verify-token', { method: 'POST' }),
  createProfile: (body: CreateProfileInput) =>
    request<BackendProfile>('/api/auth/profile', { method: 'POST', body: JSON.stringify(body) }),
  getAdminStats: () => request<AdminStats>('/api/admin/stats'),
  getAdminUsers: () => request<{ items: AdminUser[] }>('/api/admin/users'),
  verifyUser: (uid: string, verificationStatus: 'verified' | 'rejected') =>
    request<AdminUser>(`/api/admin/users/${encodeURIComponent(uid)}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ verificationStatus }),
    }),
  getCollectorLots: (query: ShopQuery = {}) =>
    request<{ items: ShopItem[] }>(`/api/middleman/collector-shop${queryString(query)}`),
  getRecyclerCollectorLots: (query: ShopQuery = {}) =>
    request<{ items: ShopItem[] }>(`/api/recycler/collector-shop${queryString(query)}`),
  getMiddlemanLots: (query: ShopQuery = {}) =>
    request<{ items: ShopItem[] }>(`/api/recycler/middleman-shop${queryString(query)}`),
  createKnownListing: (body: FormData) =>
    request<CollectorLot>('/api/listings/known', { method: 'POST', body }),
  createEwasteListing: (body: FormData) =>
    request<CollectorLot>('/api/listings/ewaste', { method: 'POST', body }),
  scanMaterial: (photo: File) => {
    const body = new FormData();
    body.set('photo', photo);
    return request<MaterialScanResult>('/api/detection/material', { method: 'POST', body });
  },
  getPickupRequests: () => request<{ items: PickupRequest[] }>('/api/pickups'),
  getLocalPrice: (category: string) => request<PriceReference>(`/api/price/${encodeURIComponent(category)}`),
  getLedger: () => request<{ items: LedgerTransaction[] }>('/api/ledger'),
  getInventory: () => request<{ items: InventoryItem[] }>('/api/middleman/inventory'),
  purchaseCollectorLot: (listingId: string, agreedPrice: number) =>
    request('/api/middleman/buy', { method: 'POST', body: JSON.stringify({ listingId, agreedPrice }) }),
  processInventoryLot: (body: object) =>
    request('/api/middleman/process', { method: 'POST', body: JSON.stringify(body) }),
  createBulkLot: (body: object) =>
    request('/api/middleman/aggregate', { method: 'POST', body: JSON.stringify(body) }),
  purchaseMiddlemanLot: (id: string, agreedPrice: number) =>
    request(`/api/recycler/offer/inventory/${id}`, {
      method: 'POST',
      body: JSON.stringify({ agreedPrice }),
    }),
};
