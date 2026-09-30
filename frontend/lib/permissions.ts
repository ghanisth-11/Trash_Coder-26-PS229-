import { UserRole } from "@/types/domain";
export type Capability = "sell" | "pickups" | "ledger" | "collectorShop" | "buyCollector" | "buyRawEWaste" | "inventory" | "process" | "batches" | "middlemanShop" | "buyBulk";
const capabilities: Record<UserRole, Capability[]> = {
  KABADIWALA: ["sell", "pickups", "ledger"],
  MIDDLEMAN: ["collectorShop", "buyCollector", "buyRawEWaste", "inventory", "process", "batches"],
  RECYCLER: ["collectorShop", "buyCollector", "middlemanShop", "buyBulk"],
  ADMIN: []
};
export const can = (role: UserRole, capability: Capability) => capabilities[role].includes(capability);
export const roleHome: Record<UserRole, string> = { KABADIWALA: "/kabadiwala/home", MIDDLEMAN: "/middleman/dashboard", RECYCLER: "/recycler/dashboard", ADMIN: "/admin" };
export function mayPurchaseCollectorLot(role: UserRole, isRawEWaste: boolean) { return can(role, "buyCollector") && (!isRawEWaste || can(role, "buyRawEWaste")); }
