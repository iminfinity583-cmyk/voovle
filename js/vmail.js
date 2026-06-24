document.addEventListener('DOMContentLoaded', function() {
  loadEmails();
});

function getEmails() {
  return JSON.parse(localStorage.getItem('vmail_emails') || '[]');
}

function saveEmails(emails) {
  localStorage.setItem('vmail_emails', JSON.stringify(emails));
}

function sendEmail() {
  const to = document.getElementById('composeTo').value.trim();
  const subject = document.getElementById('composeSubject').value.trim();
  const body = document.getElementById('composeBody').value.trim();
  const msg = document.getElementById('composeMsg');

  if (!to || !subject || !body) {
    msg.style.color = '#d93025';
    msg.textContent = 'Please fill all fields.';
    return;
  }

  if (!to.includes('@')) {
    msg.style.color = '#d93025';
    msg.textContent = 'Invalid email address.';
    return;
  }

  const emails = getEmails();
  emails.unshift({
    id: Date.now(),
    from: 'me@voovle.com',
    to: to,
    subject: subject,
    body: body,
    time: new Date().toLocaleString(),
    read: false
  });
  saveEmails(emails);

  document.getElementById('composeTo').value = '';
  document.getElementById('composeSubject').value = '';
  document.getElementById('composeBody').value = '';
  document.getElementById('composeModal').style.display = 'none';
  msg.textContent = '';

  loadEmails();
}

function loadEmails() {
  const list = document.getElementById('emailList');
  const emails = getEmails();
  document.getElementById('emailCount').textContent = emails.length + ' emails';

  if (emails.length === 0) {
    list.innerHTML = '<div class="email-empty"><p>No emails yet. Compose one!</p></div>';
    return;
  }

  list.innerHTML = emails.map(function(email) {
    return '<div class="email-item" onclick="viewEmail(' + email.id + ')">' +
      '<input type="checkbox" onclick="event.stopPropagation()">' +
      '<span class="email-from">' + (email.read ? '' : '<b>') + email.from + (email.read ? '' : '</b>') + '</span>' +
      '<span class="email-subject">' + (email.read ? '' : '<b>') + email.subject + (email.read ? '' : '</b>') + '</span>' +
      '<span class="email-body-preview"> - ' + email.body.substring(0, 40) + '</span>' +
      '<span class="email-time">' + formatTime(email.time) + '</span>' +
      '</div>';
  }).join('');
}

function viewEmail(id) {
  const emails = getEmails();
  const email = emails.find(function(e) { return e.id === id; });
  if (!email) return;

  email.read = true;
  saveEmails(emails);
  loadEmails();

  const overlay = document.createElement('div');
  overlay.className = 'view-modal';
  overlay.style.display = 'flex';
  overlay.innerHTML = '<div class="view-content">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
    '<h3>' + email.subject + '</h3>' +
    '<span style="font-size:24px;cursor:pointer;color:#5f6368" onclick="this.closest(\\'.view-modal\\').remove()">&times;</span>' +
    '</div>' +
    '<div class="view-meta"><b>From:</b> ' + email.from + '<br><b>To:</b> ' + email.to + '<br><b>Time:</b> ' + email.time + '</div>' +
    '<div class="view-body">' + email.body + '</div>' +
    '</div>';
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function formatTime(timeStr) {
  const d = new Date(timeStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
