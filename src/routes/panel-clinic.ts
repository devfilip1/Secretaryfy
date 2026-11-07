import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ClinicContext } from "../modules/clinic/context.js";
import type { ClinicSettingsRepository } from "../modules/clinic/settings-repository.js";
import { invalidBody } from "./invalid-body.js";

const clinicBody = z.object({
  name: z.string().trim().min(1).max(120),
  assistantName: z.string().trim().max(60),
  kind: z.string().trim().min(1).max(80),
});

/**
 * Identidade da clínica no painel: nome, nome da atendente e tipo mudam sem reiniciar; a língua vem do env e exige
 * reiniciar (ADR 0012, passo 2).
 */
export function panelClinicRoutes({ clinic, repo }: { clinic: ClinicContext; repo: Pick<ClinicSettingsRepository, "save"> }) {
  const view = () => ({
    name: clinic.name,
    assistantName: clinic.assistantName ?? null,
    kind: clinic.kind,
    language: clinic.language,
    restartRequired: false,
  });

  return async function (app: FastifyInstance) {
    app.get("/api/clinic-settings", async () => view());

    app.put("/api/clinic-settings", async (req, reply) => {
      const body = clinicBody.safeParse(req.body);
      if (!body.success) return invalidBody(reply, body.error);
      const identity = { name: body.data.name, assistantName: body.data.assistantName || undefined, kind: body.data.kind };
      await repo.save(identity);
      clinic.update(identity);
      return view();
    });
  };
}
