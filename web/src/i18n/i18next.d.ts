import "i18next";
import type appointments from "../locales/en/appointments.json";
import type calendar from "../locales/en/calendar.json";
import type common from "../locales/en/common.json";
import type connection from "../locales/en/connection.json";
import type customers from "../locales/en/customers.json";
import type inbox from "../locales/en/inbox.json";
import type knowledge from "../locales/en/knowledge.json";
import type login from "../locales/en/login.json";

// As chaves são tipadas pelo inglês: uma chave que falta no en é erro de compilação.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      login: typeof login;
      inbox: typeof inbox;
      appointments: typeof appointments;
      calendar: typeof calendar;
      customers: typeof customers;
      connection: typeof connection;
      knowledge: typeof knowledge;
    };
  }
}
