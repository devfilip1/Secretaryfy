import { createClinicContext, type ClinicContext } from "../modules/clinic/context.js";
import { fixedTextsFor, type FixedTexts } from "../modules/antiban/texts.js";
import { createReplies, type Replies } from "../modules/scheduling/replies.js";
import { testCatalog } from "./catalog.js";

/** A clínica de referência dos testes (DentalSafe, em inglês): a identidade que os textos esperados citam. */
export const testClinic: ClinicContext = createClinicContext({ name: "DentalSafe", kind: "dental clinic", language: "en" });

/** Os textos do agendamento nessa clínica, como os testes esperam. */
export const testReplies: Replies = createReplies({ clinic: testClinic, catalog: testCatalog });

/** Os textos fixos em inglês (indisponibilidade, opt-out, opt-in). */
export const testTexts: FixedTexts = fixedTextsFor("en");
