import { createStaticCatalog, type ServiceCatalog } from "../modules/scheduling/catalog.js";

/** O catálogo dos testes: a lista do folheto, como a clínica de referência a usa. */
export const testCatalog: ServiceCatalog = createStaticCatalog();
