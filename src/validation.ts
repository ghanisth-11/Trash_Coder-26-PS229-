import { z } from 'zod';
import { roles } from './domain.js';
export const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
export const category = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => !v.includes('/'), 'Use category slugs, e.g. ram-storage');
export const categories = [
  'electronic-battery',
  'ram-storage',
  'integrated-circuits',
  'ewaste-cables',
  'copper-scrap',
  'paper',
  'cardboard',
  'plastic',
  'metal',
  'glass',
  'mixed',
  'other',
] as const;
export const money = z.coerce
  .number()
  .finite()
  .min(0)
  .max(100000000)
  .transform((v) => Math.round(v * 100) / 100);
export const geo = z
  .object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) })
  .strict();
export const condition = z.enum(['intact', 'damaged', 'broken', 'corroded', 'burnt', 'unknown']);
export const unit = z.enum(['per_kg', 'per_piece', 'per_lot']);
export const profile = z
  .object({
    role: z.enum(['kabadiwala', 'middleman', 'recycler']),
    name: z.string().trim().min(1).max(120),
    address: z.string().max(500).default(''),
    locality: z.string().trim().max(120).default(''),
    geo: geo.nullable().default(null),
    available: z.boolean().default(false),
  })
  .strict();
export const profileUpdate = profile.omit({ role: true }).partial().strict();
export const known = z
  .object({
    category: z.enum(['paper', 'cardboard', 'plastic', 'metal', 'glass', 'mixed', 'other']),
    name: z.string().trim().min(1).max(160).default('Scrap material'),
    weight: z.coerce.number().positive().max(1000000),
    volume: z.coerce.number().min(0).max(1000000).default(0),
    quantity: z.coerce.number().int().positive().max(1000000).default(1),
    geo: geo.nullable().default(null),
    buyPrice: money.optional(),
    sellPrice: money.optional(),
    priceUnit: unit.default('per_kg'),
  })
  .strict();
export const ewaste = z
  .object({
    category: category.default('other'),
    weight: z.coerce.number().min(0).max(1000000).default(0),
    volume: z.coerce.number().min(0).max(1000000).default(0),
    quantity: z.coerce.number().int().positive().max(1000000).default(1),
    geo: geo.nullable().default(null),
  })
  .strict();
export const qc = z
  .object({
    category,
    condition,
    finalPrice: money,
    qcNotes: z.string().max(4000).default(''),
    useCase: z.string().max(1000).default(''),
  })
  .strict();
export const offer = z.object({ agreedPrice: money }).strict();
export const buy = offer.extend({ listingId: id }).strict();
export const aggregate = z
  .object({
    listingIds: z
      .array(id)
      .min(1)
      .max(100)
      .refine((v) => new Set(v).size === v.length, 'Duplicate listing IDs'),
    aggregatedCategory: category,
    askingPrice: money,
  })
  .strict();
export const processListing = z.object({
  listingId: id,
  materials: z.array(z.object({
    name: z.string().trim().min(1).max(160),
    category: z.enum(categories.filter((item) => item !== 'mixed') as [string, ...string[]]),
    condition,
    weight: z.coerce.number().positive().max(1000000),
    quantity: z.coerce.number().int().positive().max(1000000),
  }).strict()).min(1).max(30),
}).strict();
export const listInventory = z.object({ inventoryId: id, askingPrice: money.optional() }).strict();
export const priority = z
  .object({
    category,
    premiumTier: z.coerce.number().int().min(1).max(3),
    active: z.boolean().default(true),
    expiresAt: z
      .string()
      .datetime()
      .refine(
        (v) => Date.parse(v) > Date.now() && Date.parse(v) < Date.now() + 366 * 86400000,
        'Expiry must be within the next year',
      ),
  })
  .strict();
export const roleChange = z.object({ role: z.enum(roles) }).strict();
export const price = z
  .object({
    buyPrice: money,
    sellPrice: money,
    priceUnit: unit,
    priceNote: z.string().trim().min(1).max(500),
  })
  .strict();
export const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  after: id.optional(),
});
export const shopQuery = page
  .extend({
    category: category.optional(),
    minPrice: money.optional(),
    maxPrice: money.optional(),
    lat: geo.shape.lat.optional(),
    lng: geo.shape.lng.optional(),
    radiusKm: z.coerce.number().positive().max(500).optional(),
  })
  .strict()
  .refine(
    (v) => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice,
    'Invalid price range',
  )
  .refine(
    (v) =>
      [v.lat, v.lng, v.radiusKm].every((x) => x === undefined) ||
      [v.lat, v.lng, v.radiusKm].every((x) => x !== undefined),
    'lat, lng, radiusKm must be supplied together',
  );
export type KnownInput = z.infer<typeof known>;
export type EwasteInput = z.infer<typeof ewaste>;
export type QCInput = z.infer<typeof qc>;
export function slug(value: string) {
  const aliases: Record<string, string> = {
    'RAM / Storage': 'ram-storage',
    'ICs / Integrated Circuits': 'integrated-circuits',
    'Electronic Battery': 'electronic-battery',
    'E-waste Cables': 'ewaste-cables',
    'Copper Scrap': 'copper-scrap',
  };
  return (
    aliases[value] ??
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}
