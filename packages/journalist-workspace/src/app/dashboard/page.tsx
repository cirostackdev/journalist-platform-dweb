export default function DashboardPage() {
  return (
    <main>
      <h1>Cases</h1>
      <button id="logout-btn">Logout</button>
      <div id="cases-list">Loading...</div>
      <script dangerouslySetInnerHTML={{ __html: `
        const token = sessionStorage.getItem('session');
        if (!token) { window.location.href = '/login'; }
        fetch('/api/cases', { headers: { 'x-session': token } })
          .then(r => r.json())
          .then(({ cases }) => {
            const list = document.getElementById('cases-list');
            if (!cases?.length) { list.textContent = 'No cases.'; return; }
            list.innerHTML = cases.map(c => '<div><a href="/cases/' + c.id + '">[' + c.status.toUpperCase() + '] ' + c.submission_ref + '</a></div>').join('');
          });
        document.getElementById('logout-btn').addEventListener('click', () => {
          fetch('/api/auth/logout', { method: 'POST', headers: { 'x-session': token } })
            .then(() => { sessionStorage.clear(); window.location.href = '/login'; });
        });
      `}} />
    </main>
  )
}
