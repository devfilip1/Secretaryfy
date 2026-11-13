import type { Appointment } from "../../api";
import type { useFormats } from "../../i18n/formats";
import { AgendaRow, type ReminderTag } from "./AgendaRow";
import { agendaStatusOf } from "./day-agenda";

interface DayTimelineProps {
  items: Appointment[];
  formats: ReturnType<typeof useFormats>;
  tagOf: (a: Appointment) => ReminderTag | null;
  confirmingId: string | null;
  onConfirm: (a: Appointment) => void;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
}

/** Linha do tempo de um dia: uma linha por consulta, na ordem do horário (ver dayItems). */
export function DayTimeline({ items, formats, tagOf, confirmingId, onConfirm, onEdit, onCancel }: DayTimelineProps) {
  return (
    <ul>
      {items.map((a) => (
        <AgendaRow
          key={a.id}
          appointment={a}
          status={agendaStatusOf(a)}
          tag={tagOf(a)}
          formats={formats}
          busy={confirmingId === a.id}
          onConfirm={() => onConfirm(a)}
          onEdit={() => onEdit(a)}
          onCancel={() => onCancel(a)}
        />
      ))}
    </ul>
  );
}
