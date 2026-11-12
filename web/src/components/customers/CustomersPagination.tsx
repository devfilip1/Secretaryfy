import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { PageSlice } from "./pagination";

/** Rodapé da lista: intervalo mostrado, página atual e botões anterior/próxima. */
export function CustomersPagination({
  slice,
  onPageChange,
}: {
  slice: Omit<PageSlice<unknown>, "items">;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation("customers");
  const first = slice.page === 1;
  const last = slice.page === slice.pageCount;
  return (
    <nav aria-label={t("pagination.nav")} className="flex flex-wrap items-center justify-between gap-3">
      <p className="tnum text-sm text-muted-foreground">{t("pagination.range", { from: slice.from, to: slice.to, total: slice.total })}</p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="min-h-11 md:min-h-9"
          onClick={() => onPageChange(slice.page - 1)}
          disabled={first}
          aria-label={t("pagination.previousLabel")}
        >
          <ChevronLeft aria-hidden="true" />
          {t("pagination.previous")}
        </Button>
        <span className="tnum min-w-16 text-center text-sm text-muted-foreground">
          {t("pagination.page", { page: slice.page, pageCount: slice.pageCount })}
        </span>
        <Button
          variant="outline"
          className="min-h-11 md:min-h-9"
          onClick={() => onPageChange(slice.page + 1)}
          disabled={last}
          aria-label={t("pagination.nextLabel")}
        >
          {t("pagination.next")}
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
