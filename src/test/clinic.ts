import type { ClinicContext } from "../modules/clinic/context.js";
import { fixedTextsFor, type FixedTexts } from "../modules/antiban/texts.js";
import { createReplies, type Replies } from "../modules/scheduling/replies.js";
import { testCatalog } from "./catalog.js";

/** A clínica de referência dos testes (DentalSafe, em inglês): a identidade que os textos esperados citam. */
export const testClinic: ClinicContext = { name: "DentalSafe", language: "en", kind: "dental clinic" };

/** Os textos do agendamento nessa clínica, como os testes esperam. */
export const testReplies: Replies = createReplies({ language: "en", clinicName: "DentalSafe", catalog: testCatalog });

/** Os textos fixos em inglês (indisponibilidade, opt-out, opt-in). */
export const testTexts: FixedTexts = fixedTextsFor("en");
