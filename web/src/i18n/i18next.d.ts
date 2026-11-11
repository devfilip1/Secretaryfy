import "i18next";
import type common from "../locales/en/common.json";
import type login from "../locales/en/login.json";

// As chaves são tipadas pelo inglês: uma chave que falta no en é erro de compilação.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: { common: typeof common; login: typeof login };
  }
}
