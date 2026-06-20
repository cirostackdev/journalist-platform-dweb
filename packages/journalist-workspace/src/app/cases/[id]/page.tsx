export default function CasePage({ params }: { params: { id: string } }) {
  const { id } = params
  return (
    <main>
      <a href="/dashboard">← Back</a>
      <h1>Case <code>{id}</code></h1>
      <h2>Notes</h2><div id="notes-list">Loading...</div>
      <textarea id="note-text" rows={3} style={{ width: "100%" }} /><button id="add-note-btn">Add Note</button>
      <h2>Reply to Source</h2>
      <textarea id="reply-text" rows={3} style={{ width: "100%" }} /><button id="reply-btn">Send Reply</button>
      <h2>Status</h2>
      <select id="status-select"><option value="new">New</option><option value="active">Active</option><option value="closed">Closed</option></select>
      <button id="update-status-btn">Update Status</button>
      <script dangerouslySetInnerHTML={{ __html: `
        const token = sessionStorage.getItem('session');
        const caseId = '${id}';
        if (!token) { window.location.href = '/login'; }
        function loadCase() {
          fetch('/api/cases/' + caseId, { headers: { 'x-session': token } })
            .then(r => r.json()).then(({ notes }) => {
              document.getElementById('notes-list').textContent = notes?.length ? JSON.stringify(notes) : 'No notes yet.';
            });
        }
        loadCase();
        document.getElementById('add-note-btn').addEventListener('click', () => {
          const text = document.getElementById('note-text').value;
          fetch('/api/cases/' + caseId + '/notes', { method: 'POST', headers: {'Content-Type':'application/json','x-session':token}, body: JSON.stringify({ text }) })
            .then(() => { document.getElementById('note-text').value = ''; loadCase(); });
        });
        document.getElementById('reply-btn').addEventListener('click', () => {
          const text = document.getElementById('reply-text').value;
          fetch('/api/cases/' + caseId + '/reply', { method: 'POST', headers: {'Content-Type':'application/json','x-session':token}, body: JSON.stringify({ text }) })
            .then(() => { document.getElementById('reply-text').value = ''; alert('Reply sent.'); });
        });
        document.getElementById('update-status-btn').addEventListener('click', () => {
          const status = document.getElementById('status-select').value;
          fetch('/api/cases/' + caseId + '/status', { method: 'PATCH', headers: {'Content-Type':'application/json','x-session':token}, body: JSON.stringify({ status }) })
            .then(() => alert('Status updated.'));
        });
      `}} />
    </main>
  )
}
