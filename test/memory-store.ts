import { randomUUID } from 'node:crypto';
import type { Collection, Schema } from '../src/domain.js';
import type { Filter, Store, Unit } from '../src/store.js';
// Test-only serialized transactions with rollback and Firestore read-before-write enforcement.
export class MemoryStore implements Store {
  private data = new Map<string, unknown>();
  private tail: Promise<unknown> = Promise.resolve();
  id() {
    return randomUUID();
  }
  async get<C extends Collection>(c: C, id: string): Promise<Schema[C] | null> {
    return structuredClone((this.data.get(`${c}/${id}`) as Schema[C]) ?? null);
  }
  async query<C extends Collection>(
    c: C,
    filters: Filter<C>[] = [],
    limit?: number,
  ): Promise<Schema[C][]> {
    const result: Array<Schema[C]> = [];
    for (const [key, value] of this.data) {
      if (!key.startsWith(`${c}/`)) continue;
      const row = value as Schema[C];
      if (
        filters.every(([field, op, expected]) => {
          const actual = row[field] as string | number;
          switch (op) {
            case '==':
              return actual === expected;
            case '<=':
              return actual <= (expected as typeof actual);
            case '>=':
              return actual >= (expected as typeof actual);
            case '<':
              return actual < (expected as typeof actual);
            case '>':
              return actual > (expected as typeof actual);
          }
        })
      )
        result.push(structuredClone(row));
    }
    return limit ? result.slice(0, limit) : result;
  }
  run<T>(fn: (tx: Unit) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const backup = structuredClone(this.data);
      let written = false;
      const read = () => {
        if (written) throw new Error('Firestore reads must precede writes');
      };
      const tx: Unit = {
        get: async (c, id) => {
          read();
          return this.get(c, id);
        },
        query: async (c, f, l) => {
          read();
          return this.query(c, f, l);
        },
        set: (c, id, data) => {
          written = true;
          this.data.set(`${c}/${id}`, structuredClone(data));
        },
        create: (c, id, data) => {
          written = true;
          if (this.data.has(`${c}/${id}`)) throw new Error('Document already exists');
          this.data.set(`${c}/${id}`, structuredClone(data));
        },
        delete: (c, id) => {
          written = true;
          this.data.delete(`${c}/${id}`);
        },
      };
      try {
        return await fn(tx);
      } catch (e) {
        this.data = backup;
        throw e;
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }
}
