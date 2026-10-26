export function Disabled() {
  return (
    <main className="center-page">
      <div className="card">
        <h1>Panel disabled</h1>
        <p>
          Set <code>OPERATOR_PASSWORD</code> (12 characters or more) in the server <code>.env</code> and restart it.
        </p>
      </div>
    </main>
  );
}
