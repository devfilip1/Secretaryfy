import { db } from "../db/client.js";
import { bus } from "../modules/inbox/events.js";
import { createInboxRepository } from "../modules/inbox/repository.js";
import { createInboxService } from "../modules/inbox/service.js";

/** Instâncias do processo, compartilhadas pelo webhook e pela API do painel. */
export const inboxRepo = createInboxRepository(db);
export const inbox = createInboxService({ repo: inboxRepo, publish: bus.publish });
