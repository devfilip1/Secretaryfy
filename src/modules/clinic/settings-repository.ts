import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { clinicSettings } from "../../db/schema.js";
import type { Language } from "../scheduling/dates.js";
import type { ClinicIdentity } from "./context.js";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Banco da identidade da clínica (clinic_settings). */
export function createClinicSettingsRepository(db: Db) {
  return {
    /** A identidade gravada, ou null antes da primeira gravação. */
    async get(): Promise<ClinicIdentity | null> {
      const [row] = await db.select().from(clinicSettings).where(eq(clinicSettings.id, 1));
      return row ? { name: row.name, assistantName: row.assistantName ?? undefined, kind: row.kind, language: (row.language ?? undefined) as Language | undefined } : null;
    },

    /** Grava a identidade inteira (o painel envia todos os campos sempre); a linha única é criada na primeira vez. */
    async save(identity: ClinicIdentity): Promise<void> {
      const fields = { name: identity.name, assistantName: identity.assistantName ?? null, kind: identity.kind, language: identity.language ?? null, updatedAt: new Date() };
      await db.insert(clinicSettings).values({ id: 1, ...fields }).onConflictDoUpdate({ target: clinicSettings.id, set: fields });
    },
  };
}

export type ClinicSettingsRepository = ReturnType<typeof createClinicSettingsRepository>;
