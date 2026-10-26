import type { SendRisk } from "../api";

const RISK_TEXT: Record<SendRisk, string> = {
  cold_contact: "The customer has not written in over 24 hours.",
  opted_out: "The customer asked not to receive messages.",
  protection_paused: "Automatic sending is paused by number protection.",
};

/** Confirmação antes de o operador enviar com risco de banimento (specs/004, US4). */
export function RiskDialog({ risks, onCancel, onConfirm }: { risks: SendRisk[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-labelledby="risk-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="risk-title">Send anyway?</h3>
        <ul>
          {risks.map((risk) => (
            <li key={risk}>{RISK_TEXT[risk] ?? risk}</li>
          ))}
        </ul>
        <p className="muted small">Sending anyway increases the risk of the number being banned.</p>
        <div className="dialog-actions">
          <button onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm}>
            Send anyway
          </button>
        </div>
      </div>
    </div>
  );
}
