import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ClinicContext } from "../modules/clinic/context.js";
import type { ClinicSettingsRepository } from "../modules/clinic/settings-repository.js";
import { appointmentMinutes } from "../modules/scheduling/rules.js";
import { invalidBody } from "./invalid-body.js";

const clinicBody = z.object({
  name: z.string().trim().min(1).max(120),
  assistantName: z.string().trim().max(60),
  kind: z.string().trim().min(1).max(80),
  language: z.enum(["en", "pt"]),
  // Opcionais: quem não envia (clientes antigos) mantém o valor gravado
  offerAssessment: z.boolean().optional(),
  offerFollowUp: z.boolean().optional(),
  assessmentMinutes: appointmentMinutes.nullable().optional(),
  followUpMinutes: appointmentMinutes.nullable().optional(),
});

/** Campo ausente mantém o atual; null é valor válido (a duração padrão do calendário), então não usa ?? */
const keep = <T>(sent: T | undefined, current: T): T => (sent !== undefined ? sent : current);

/**
 * Identidade da clínica no painel: nome, nome da atendente, tipo e língua mudam sem reiniciar (ADR 0016, fase 1).
 * A língua é obrigatória no PUT; o env CLINIC_LANGUAGE só semeia o banco.
 */
export function panelClinicRoutes({ clinic, repo }: { clinic: ClinicContext; repo: Pick<ClinicSettingsRepository, "save"> }) {
  const view = () => ({
    name: clinic.name,
    assistantName: clinic.assistantName ?? null,
    kind: clinic.kind,
    language: clinic.language,
    offerAssessment: clinic.offerAssessment,
    offerFollowUp: clinic.offerFollowUp,
    assessmentMinutes: clinic.assessmentMinutes,
    followUpMinutes: clinic.followUpMinutes,
    restartRequired: false,
  });

  return async function (app: FastifyInstance) {
    app.get("/api/clinic-settings", async () => view());

    app.put("/api/clinic-settings", async (req, reply) => {
      const body = clinicBody.safeParse(req.body);
      if (!body.success) return invalidBody(reply, body.error);
      const { data } = body;
      const identity = {
        name: data.name,
        assistantName: data.assistantName || undefined,
        kind: data.kind,
        language: data.language,
        offerAssessment: keep(data.offerAssessment, clinic.offerAssessment),
        offerFollowUp: keep(data.offerFollowUp, clinic.offerFollowUp),
        assessmentMinutes: keep(data.assessmentMinutes, clinic.assessmentMinutes),
        followUpMinutes: keep(data.followUpMinutes, clinic.followUpMinutes),
      };
      await repo.save(identity);
      clinic.update(identity);
      return view();
    });
  };
}
