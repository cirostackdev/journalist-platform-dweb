export default function LoginPage() {
  return (
    <main>
      <h1>Journalist Workspace</h1>
      <form id="login-form">
        <div><label>Username: <input type="text" name="username" required autoComplete="off" /></label></div>
        <div><label>Password: <input type="password" name="password" required /></label></div>
        <div><label>TOTP Code: <input type="text" name="totpToken" required inputMode="numeric" maxLength={6} /></label></div>
        <button type="submit">Login</button>
      </form>
      <script dangerouslySetInnerHTML={{ __html: `
        document.getElementById('login-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target));
          const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
          const body = await res.json();
          if (body.token) { sessionStorage.setItem('session', body.token); window.location.href = '/dashboard'; }
          else { alert('Login failed: ' + (body.error ?? 'unknown error')); }
        });
      `}} />
    </main>
  )
}
