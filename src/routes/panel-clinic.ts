import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ClinicContext } from "../modules/clinic/context.js";
import type { ClinicSettingsRepository } from "../modules/clinic/settings-repository.js";
import type { KnowledgeRepository } from "../modules/knowledge/repository.js";
import { isBookable } from "../modules/knowledge/types.js";
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
export function panelClinicRoutes({
  clinic,
  repo,
  knowledge,
}: {
  clinic: ClinicContext;
  repo: Pick<ClinicSettingsRepository, "save">;
  knowledge: Pick<KnowledgeRepository, "list">;
}) {
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

  const hasBookableTreatment = async () => (await knowledge.list()).some(isBookable);

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
      // Desligar os dois fixos sem tratamento para marcar deixaria o assistente com lista vazia (409, como o conhecimento)
      const turnsBothOff = !identity.offerAssessment && !identity.offerFollowUp && (clinic.offerAssessment || clinic.offerFollowUp);
      if (turnsBothOff && !(await hasBookableTreatment())) return reply.code(409).send({ error: "no_bookable_service" });
      await repo.save(identity);
      clinic.update(identity);
      return view();
    });
  };
}
