import { asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { appointments, customers, type CustomerRow } from "../../db/schema.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface CustomerAppointment {
  startsAt: Date;
  service: string | null;
  status: "booked" | "cancelled";
}

export type CustomerWithAppointments = CustomerRow & { appointments: CustomerAppointment[] };

/** Cadastro de clientes: um registro por telefone, gravado só quando um horário é confirmado (specs/005). */
export function createCustomerRepository(db: Db) {
  return {
    async findByPhone(phone: string): Promise<CustomerRow | null> {
      const [row] = await db.select().from(customers).where(eq(customers.phone, phone));
      return row ?? null;
    },

    async findById(id: string): Promise<CustomerRow | null> {
      const [row] = await db.select().from(customers).where(eq(customers.id, id));
      return row ?? null;
    },

    /** Inclui o cliente, ou só atualiza o nome se o telefone já estiver no cadastro (FR-015 a FR-017). */
    async upsert({ phone, name, at }: { phone: string; name: string; at: Date }): Promise<CustomerRow> {
      const [row] = await db
        .insert(customers)
        .values({ phone, name, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({ target: customers.phone, set: { name, updatedAt: at } })
        .returning();
      return row;
    },

    /** Cadastro para o painel, por nome, com os agendamentos de cada cliente (mais recentes primeiro). */
    async list(): Promise<CustomerWithAppointments[]> {
      const rows = await db.select().from(customers).orderBy(asc(customers.name), asc(customers.createdAt));
      if (rows.length === 0) return [];
      const linked = await db
        .select({
          customerId: appointments.customerId,
          startsAt: appointments.startsAt,
          service: appointments.service,
          status: appointments.status,
        })
        .from(appointments)
        .where(inArray(appointments.customerId, rows.map((r) => r.id)))
        .orderBy(desc(appointments.startsAt));
      return rows.map((row) => ({
        ...row,
        appointments: linked
          .filter((a) => a.customerId === row.id)
          .map(({ startsAt, service, status }) => ({ startsAt, service, status })),
      }));
    },

    /** Edição pelo painel (specs/006 US2): só os campos enviados mudam; `notes: null` apaga a anotação. */
    async update(id: string, patch: { name?: string; notes?: string | null }, at: Date): Promise<CustomerRow | null> {
      const [row] = await db
        .update(customers)
        .set({ ...patch, updatedAt: at })
        .where(eq(customers.id, id))
        .returning();
      return row ?? null;
    },

    /** Exclui o cadastro. Os agendamentos ficam, sem o vínculo (customer_id vira null). */
    async remove(id: string): Promise<CustomerRow | null> {
      const [row] = await db.delete(customers).where(eq(customers.id, id)).returning();
      return row ?? null;
    },
  };
}

export type CustomerRepository = ReturnType<typeof createCustomerRepository>;
