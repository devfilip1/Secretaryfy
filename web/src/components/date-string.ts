/** Data local a partir de "YYYY-MM-DD". `new Date("YYYY-MM-DD")` leria em UTC e poderia cair no dia anterior no Brasil. */
export function toDate(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** "YYYY-MM-DD" da data local, com zeros à esquerda. */
export function toYmd(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
