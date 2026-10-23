import type { SendRisk } from "../api";

const RISK_TEXT: Record<SendRisk, string> = {
  cold_contact: "O cliente não escreve há mais de 24 horas.",
  opted_out: "O cliente pediu para não receber mensagens.",
  protection_paused: "Envios automáticos pausados pela proteção do número.",
};

/** Confirmação antes de o operador enviar com risco de banimento (specs/004, US4). */
export function RiskDialog({ risks, onCancel, onConfirm }: { risks: SendRisk[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-labelledby="risk-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="risk-title">Enviar mesmo assim?</h3>
        <ul>
          {risks.map((risk) => (
            <li key={risk}>{RISK_TEXT[risk] ?? risk}</li>
          ))}
        </ul>
        <p className="muted small">Enviar mesmo assim aumenta o risco de banimento do número.</p>
        <div className="dialog-actions">
          <button onClick={onCancel} autoFocus>
            Cancelar
          </button>
          <button className="danger" onClick={onConfirm}>
            Enviar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}
