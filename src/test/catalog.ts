import { createCatalog, type Service, type ServiceCatalog } from "../modules/scheduling/catalog.js";

/** Catálogo fixo para os testes: os tratamentos dados (nome e rótulo iguais); a avaliação geral entra no fim. */
export function createFixedCatalog(treatments: Service[]): ServiceCatalog {
  return createCatalog(treatments);
}

/** Os oito tratamentos dos testes, em inglês como o folheto de referência: com a avaliação geral, são os nove de sempre. */
const TREATMENTS = [
  "Dental Cleaning",
  "Teeth Whitening",
  "Dental Filling",
  "Root Canal Treatment",
  "Dental Implants",
  "Braces and Orthodontic Treatment",
  "Tooth Extraction",
  "Dental Veneers",
];

/** O catálogo dos testes. */
export const testCatalog: ServiceCatalog = createFixedCatalog(TREATMENTS.map((name) => ({ name, label: name })));

/** Os tratamentos da Sorriso Pleno (chave e título como no painel): para as avaliações com o modelo real em português. */
export const ptCatalog: ServiceCatalog = createFixedCatalog([
  { name: "limpeza-dental", label: "Limpeza Dental" },
  { name: "clareamento-dental", label: "Clareamento Dental" },
  { name: "restauracao-dental", label: "Restauração Dental" },
  { name: "tratamento-de-canal", label: "Tratamento de Canal" },
  { name: "implantes-dentarios", label: "Implantes Dentários" },
  { name: "aparelho-e-tratamento-ortodontico", label: "Aparelho e Tratamento Ortodôntico" },
  { name: "extracao-dentaria", label: "Extração Dentária" },
  { name: "lentes-de-contato-dental", label: "Lentes de Contato Dental" },
]);
