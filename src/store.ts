import { randomUUID } from 'node:crypto';
import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import type { Collection, Schema } from './domain.js';
export type Filter<C extends Collection> = [
  keyof Schema[C] & string,
  '==' | '<=' | '>=' | '<' | '>',
  unknown,
];
export interface Reader {
  get<C extends Collection>(collection: C, id: string): Promise<Schema[C] | null>;
  query<C extends Collection>(
    collection: C,
    filters?: Filter<C>[],
    limit?: number,
  ): Promise<Schema[C][]>;
}
export interface Unit extends Reader {
  set<C extends Collection>(collection: C, id: string, data: Schema[C]): void;
  create<C extends Collection>(collection: C, id: string, data: Schema[C]): void;
  delete(collection: Collection, id: string): void;
}
export interface Store extends Reader {
  id(): string;
  run<T>(fn: (tx: Unit) => Promise<T>): Promise<T>;
}
export class FirestoreStore implements Store {
  constructor(private db: Firestore) {}
  id() {
    return randomUUID();
  }
  private reader(tx?: Transaction): Reader {
    return {
      get: async <C extends Collection>(c: C, id: string) => {
        const ref = this.db.collection(c).doc(id);
        const snap = tx ? await tx.get(ref) : await ref.get();
        return snap.exists ? ({ ...snap.data(), id: snap.id } as unknown as Schema[C]) : null;
      },
      query: async <C extends Collection>(c: C, filters: Filter<C>[] = [], limit?: number) => {
        let q: Query = this.db.collection(c);
        for (const [key, op, value] of filters) q = q.where(key, op, value);
        if (limit) q = q.limit(limit);
        const snap = tx ? await tx.get(q) : await q.get();
        return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as unknown as Schema[C]);
      },
    };
  }
  get<C extends Collection>(c: C, id: string) {
    return this.reader().get(c, id);
  }
  query<C extends Collection>(c: C, filters?: Filter<C>[], limit?: number) {
    return this.reader().query(c, filters, limit);
  }
  run<T>(fn: (tx: Unit) => Promise<T>) {
    return this.db.runTransaction((tx) =>
      fn({
        ...this.reader(tx),
        set: (c, id, data) => {
          tx.set(this.db.collection(c).doc(id), data);
        },
        create: (c, id, data) => {
          tx.create(this.db.collection(c).doc(id), data);
        },
        delete: (c, id) => {
          tx.delete(this.db.collection(c).doc(id));
        },
      }),
    );
  }
}
