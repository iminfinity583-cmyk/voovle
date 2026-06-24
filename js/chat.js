var nickname = '';
var cryptoKey = null;
var peer = null;
var conn = null;
var inviteCode = '';
var roomName = '';
var connected = false;
var burnTimers = {};
var localMessages = [];
var savedInviteUrl = '';

function generateId() {
  var a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function deriveKey(pass, salt) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function(k) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}

function encryptText(key, text) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text)).then(function(ct) {
    var c = new Uint8Array(iv.length + ct.length);
    c.set(iv); c.set(ct, iv.length);
    return btoa(String.fromCharCode.apply(null, c));
  });
}

function decryptText(key, data) {
  try {
    var r = Uint8Array.from(atob(data), function(c) { return c.charCodeAt(0); });
    var iv = r.slice(0, 12), ct = r.slice(12);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct).then(function(pt) {
      return new TextDecoder().decode(pt);
    });
  } catch(e) { return Promise.resolve('[decryption error]'); }
}

function setStatus(t) {
  var el = document.getElementById('chatRoomInfo');
  if (el) el.textContent = t;
}

function escapeHtml(t) {
  var d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function formatChatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  var container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function showRoom(name, status) {
  roomName = name;
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('chatRoom').style.display = 'flex';
  document.getElementById('chatRoomName').textContent = name;
  document.getElementById('chatRoomInfo').textContent = status;
}

// ---- CREATE ----
function createRoom() {
  var invite = document.getElementById('createInviteInput').value.trim();
  var name = document.getElementById('roomNameInput').value.trim();
  var nick = document.getElementById('nickInput').value.trim();
  var pass = document.getElementById('roomPassInput').value;
  var msg = document.getElementById('lobbyMsg');

  if (!invite || !name || !nick || !pass) {
    msg.textContent = 'Please fill in all fields including invite code and password.';
    return;
  }
  if (pass.length < 4) {
    msg.textContent = 'Password must be at least 4 characters.';
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(invite)) {
    msg.textContent = 'Invite code: only letters, numbers, hyphens, underscores.';
    return;
  }

  inviteCode = invite;
  nickname = nick;

  var salt = crypto.getRandomValues(new Uint8Array(16));

  deriveKey(pass, salt).then(function(key) {
    cryptoKey = key;
    showRoom(name, 'Connecting to server...');
    document.getElementById('chatMessages').innerHTML = '<div class="system-msg">Connecting to PeerJS...</div>';

    peer = new Peer(inviteCode, { debug: 0 });

    peer.on('open', function() {
      var saltB64 = btoa(String.fromCharCode.apply(null, salt));
      var nameB64 = btoa(unescape(encodeURIComponent(name)));
      var url = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(inviteCode + ':' + saltB64 + ':' + nameB64);
      savedInviteUrl = url;
      setStatus('✅ Room ready! Share this URL:');
      showInviteUrl(url);
    });

    peer.on('connection', function(incomingConn) {
      conn = incomingConn;
      setupConnection(conn);
      if (incomingConn.open) {
        connected = true;
        showChatUI();
      } else {
        incomingConn.on('open', function() {
          connected = true;
          showChatUI();
        });
      }
    });

    peer.on('error', function(err) {
      if (err.type === 'unavailable-id') {
        msg.textContent = '❌ Invite code "' + invite + '" already in use. Try another.';
        leaveRoom();
      } else {
        setStatus('❌ ' + err.message);
      }
    });
  });
}

function showInviteUrl(url) {
  var container = document.getElementById('chatMessages');
  container.innerHTML =
    '<div class="system-msg">🔗 Send this URL to anyone you want to invite:</div>' +
    '<div class="invite-url-display" id="inviteUrlDisplay">' + escapeHtml(url) + '</div>' +
    '<button class="primary-btn" onclick="copyInviteUrl()" style="margin:12px auto;display:block">📋 Copy Invite URL</button>' +
    '<div class="system-msg">⚠️ Password ALAG se bhejo (URL mein nahi hai)</div>' +
    '<div class="system-msg">⏳ Waiting for someone to join...</div>';
}

function copyInviteUrl() {
  if (!savedInviteUrl) return;
  navigator.clipboard.writeText(savedInviteUrl).then(function() {
    setStatus('✅ URL copied!');
  }).catch(function() {
    setStatus('❌ Could not copy. Select and copy manually.');
  });
}

// ---- JOIN ----
function joinRoom() {
  var code = document.getElementById('inviteCodeInput').value.trim();
  var nick = document.getElementById('joinNickInput').value.trim();
  var pass = document.getElementById('joinPassInput').value;
  var msg = document.getElementById('lobbyMsg');

  if (!code || !nick || !pass) {
    msg.textContent = 'Please fill in all fields including the room password.';
    return;
  }

  var parts = code.split(':');
  if (parts.length < 2) {
    msg.textContent = 'Invalid invite URL. Paste the full URL or code you received.';
    return;
  }

  var roomInvite = parts[0];
  var saltB64 = parts[1];
  var nameB64 = parts.slice(2).join(':');

  var salt;
  try { salt = Uint8Array.from(atob(saltB64), function(c) { return c.charCodeAt(0); }); } catch(e) {}
  if (!salt || salt.length === 0) {
    msg.textContent = 'Invalid invite code.';
    return;
  }

  var displayName = roomInvite;
  if (nameB64) {
    try { displayName = decodeURIComponent(escape(atob(nameB64))); } catch(e) {}
  }

  msg.textContent = 'Connecting...';

  deriveKey(pass, salt).then(function(key) {
    cryptoKey = key;
    nickname = nick;
    inviteCode = roomInvite;
    var connectTimer;

    showRoom(displayName, 'Connecting to PeerJS...');
    document.getElementById('chatMessages').innerHTML = '<div class="system-msg">Connecting to signaling server...</div>';

    peer = new Peer(undefined, { debug: 0 });

    peer.on('open', function() {
      document.getElementById('chatMessages').innerHTML = '<div class="system-msg">Connecting to room...</div>';
      conn = peer.connect(roomInvite, { reliable: true });

      conn.on('open', function() {
        clearTimeout(connectTimer);
        setupConnection(conn);
        connected = true;
        showChatUI();
      });

      conn.on('error', function() {
        setStatus('❌ Connection failed.');
      });
    });

    peer.on('error', function() {
      clearTimeout(connectTimer);
      msg.textContent = '❌ Could not connect. Check the URL and try again.';
      leaveRoom();
    });

    connectTimer = setTimeout(function() {
      if (!connected) {
        if (document.getElementById('chatRoom').style.display !== 'none') {
          setStatus('❌ Timeout. Is the host online?');
        }
      }
    }, 15000);
  });
}

// ---- P2P Connection ----
function setupConnection(c) {
  conn = c;
  c.on('data', function(data) {
    try {
      var pkt = JSON.parse(data);
      if (pkt.type === 'msg' && cryptoKey) {
        decryptText(cryptoKey, pkt.ct).then(function(pt) {
          localMessages.push({ id: pkt.id, author: pkt.author, plaintext: pt, time: pkt.time, burn: pkt.burn });
          if (pkt.burn) scheduleBurn(pkt.id);
          renderMessages();
        });
      }
    } catch(e) {}
  });
  c.on('close', function() { setStatus('❌ Disconnected'); connected = false; });
}

function sendMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || !cryptoKey || !conn || !connected) return;

  var burnToggle = document.getElementById('burnToggle');
  var burn = burnToggle ? burnToggle.checked : false;

  encryptText(cryptoKey, text).then(function(ct) {
    var pkt = { type: 'msg', id: generateId(), author: nickname, ct: ct, time: Date.now(), burn: burn };
    try { conn.send(JSON.stringify(pkt)); } catch(e) {}

    decryptText(cryptoKey, ct).then(function(pt) {
      localMessages.push({ id: pkt.id, author: nickname, plaintext: pt, time: pkt.time, burn: burn });
      if (burn) scheduleBurn(pkt.id);
      renderMessages();
    });
    input.value = '';
  });
}

function renderMessages() {
  var container = document.getElementById('chatMessages');
  if (localMessages.length === 0) {
    container.innerHTML = '<div class="system-msg">🔒 End-to-end encrypted via PeerJS + AES-256-GCM</div>';
    return;
  }
  var html = '<div class="system-msg">🔒 End-to-end encrypted</div>';
  var lastAuthor = '';
  for (var i = 0; i < localMessages.length; i++) {
    var m = localMessages[i];
    var isOwn = m.author === nickname;
    html += '<div class="msg ' + (isOwn ? 'own' : 'other') + '" id="msg-' + m.id + '">';
    if (m.author !== lastAuthor) html += '<div class="msg-author">' + escapeHtml(m.author) + '</div>';
    html += escapeHtml(m.plaintext);
    if (m.burn) html += ' <span class="burn-indicator">🔥</span>';
    html += '<div class="msg-time">' + formatChatTime(m.time) + '</div></div>';
    lastAuthor = m.author;
  }
  container.innerHTML = html;
  scrollToBottom();
}

function scheduleBurn(msgId) {
  if (burnTimers[msgId]) return;
  burnTimers[msgId] = setTimeout(function() {
    localMessages = localMessages.filter(function(m) { return m.id !== msgId; });
    renderMessages();
    delete burnTimers[msgId];
  }, 10000);
}

function leaveRoom() {
  connected = false;
  if (conn) { try { conn.close(); } catch(e) {} conn = null; }
  if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }
  for (var k in burnTimers) { clearTimeout(burnTimers[k]); delete burnTimers[k]; }
  inviteCode = ''; nickname = ''; cryptoKey = null; roomName = ''; localMessages = []; savedInviteUrl = '';
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('chatRoom').style.display = 'none';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').disabled = true;
  document.getElementById('createInviteInput').value = '';
  document.getElementById('roomNameInput').value = '';
  document.getElementById('nickInput').value = '';
  document.getElementById('roomPassInput').value = '';
  document.getElementById('inviteCodeInput').value = '';
  document.getElementById('joinNickInput').value = '';
  document.getElementById('joinPassInput').value = '';
}

function showChatUI() {
  setStatus('🔗 Connected');
  renderMessages();
  var input = document.getElementById('chatInput');
  input.disabled = false;
  input.placeholder = 'Type a message...';
  input.onkeydown = function(e) { if (e.key === 'Enter') sendMessage(); };
  input.focus();
}

function copyInvite() {
  if (savedInviteUrl) {
    navigator.clipboard.writeText(savedInviteUrl).then(function() {
      setStatus('✅ Copied!');
    });
  }
}

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendMessage = sendMessage;
window.leaveRoom = leaveRoom;
window.copyInvite = copyInvite;
window.copyInviteUrl = copyInviteUrl;

window.addEventListener('load', function() {
  document.getElementById('chatInput').disabled = true;
  var params = new URLSearchParams(window.location.search);
  var invite = params.get('invite');
  if (invite) {
    document.getElementById('inviteCodeInput').value = invite;
    document.getElementById('joinNickInput').focus();
  }
});
