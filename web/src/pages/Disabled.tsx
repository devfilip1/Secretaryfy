export function Disabled() {
  return (
    <main className="center-page">
      <div className="card">
        <h1>Painel desativado</h1>
        <p>
          Defina <code>OPERATOR_PASSWORD</code> (12 caracteres ou mais) no <code>.env</code> do servidor e reinicie.
        </p>
      </div>
    </main>
  );
}
