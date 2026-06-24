var currentRoom = null;
var nickname = '';
var cryptoKey = null;
var peer = null;
var conn = null;
var isHost = false;
var burnTimers = {};
var localMessages = [];

function generateId() {
  var a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function deriveKey(password, salt) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']).then(function(key) {
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  });
}

function encryptText(key, text) {
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text)).then(function(ct) {
    var combined = new Uint8Array(iv.length + ct.length);
    combined.set(iv);
    combined.set(ct, iv.length);
    return btoa(String.fromCharCode.apply(null, combined));
  });
}

function decryptText(key, data) {
  try {
    var raw = Uint8Array.from(atob(data), function(c) { return c.charCodeAt(0); });
    var iv = raw.slice(0, 12);
    var ct = raw.slice(12);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct).then(function(pt) {
      return new TextDecoder().decode(pt);
    });
  } catch(e) { return Promise.resolve('[decryption error]'); }
}

function setStatus(text) {
  var el = document.getElementById('chatRoomInfo');
  if (el) el.textContent = text;
}

function createRoom() {
  var name = document.getElementById('roomNameInput').value.trim();
  var nick = document.getElementById('nickInput').value.trim();
  var pass = document.getElementById('roomPassInput').value;
  var msg = document.getElementById('lobbyMsg');

  if (!name || !nick || !pass) {
    msg.textContent = 'Please fill in all fields including a room password.';
    return;
  }
  if (pass.length < 4) {
    msg.textContent = 'Password must be at least 4 characters.';
    return;
  }

  var roomId = generateId();
  var salt = crypto.getRandomValues(new Uint8Array(16));

  deriveKey(pass, salt).then(function(key) {
    nickname = nick;
    currentRoom = roomId;
    cryptoKey = key;
    isHost = true;
    msg.textContent = '';

    showRoom(name, 'Connecting to signaling server...');
    showConnectingUI('Connecting to PeerJS signaling server...');

    peer = new Peer(roomId, { debug: 0 });

    peer.on('open', function(id) {
      var saltB64 = btoa(String.fromCharCode.apply(null, salt));
      var invite = roomId + ':' + saltB64;
      setStatus('✅ Share this invite code:');
      showInviteCode(invite);
    });

    peer.on('connection', function(incomingConn) {
      conn = incomingConn;
      setupConnection(conn);
      showChatUI(name);
    });

    peer.on('error', function(err) {
      if (err.type === 'unavailable-id') {
        setStatus('❌ This room ID already exists. Try again.');
        leaveRoom();
      } else if (err.type === 'disconnected') {
        setStatus('⚠️ Signaling server disconnected. Trying to reconnect...');
      } else {
        setStatus('❌ Error: ' + err.message);
      }
    });

    peer.on('disconnected', function() {
      peer.reconnect();
    });
  });
}

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
    msg.textContent = 'Invalid invite code format. Expected: roomId:salt';
    return;
  }

  var roomId = parts[0];
  var saltB64 = parts.slice(1).join(':');

  var salt;
  try {
    salt = Uint8Array.from(atob(saltB64), function(c) { return c.charCodeAt(0); });
  } catch(e) {
    msg.textContent = 'Invalid invite code: bad salt.';
    return;
  }

  if (salt.length === 0) {
    msg.textContent = 'Invalid invite code.';
    return;
  }

  msg.textContent = 'Connecting...';

  deriveKey(pass, salt).then(function(key) {
    cryptoKey = key;
    nickname = nick;
    currentRoom = roomId;
    isHost = false;

    showRoom('', 'Connecting to server...');
    showConnectingUI('Connecting to PeerJS signaling server...');

    peer = new Peer(undefined, { debug: 0 });

    peer.on('open', function() {
      showConnectingUI('Connecting to room host...');
      conn = peer.connect(roomId, { reliable: true });

      conn.on('open', function() {
        setupConnection(conn);
        showChatUI('');
      });

      conn.on('error', function(err) {
        setStatus('❌ Connection failed: ' + (err.message || 'unknown error'));
      });
    });

    peer.on('error', function(err) {
      setStatus('❌ Could not connect. Check the invite code and try again.');
      leaveRoom();
    });

    // Timeout after 15s
    setTimeout(function() {
      if (!conn || !conn.open) {
        if (document.getElementById('chatRoom').style.display !== 'none') {
          setStatus('❌ Connection timeout. Make sure the host is online.');
        }
      }
    }, 15000);
  });
}

function setupConnection(c) {
  conn = c;
  c.on('data', function(data) {
    try {
      var pkt = JSON.parse(data);
      if (pkt.type === 'msg' && cryptoKey) {
        decryptText(cryptoKey, pkt.ct).then(function(pt) {
          var msg = {
            id: pkt.id,
            author: pkt.author,
            plaintext: pt,
            time: pkt.time,
            burn: pkt.burn
          };
          localMessages.push(msg);
          if (pkt.burn) scheduleBurn(pkt.id);
          renderLocalMessages();
        });
      } else if (pkt.type === 'system') {
        localMessages.push({
          id: generateId(),
          author: '',
          plaintext: '🔒 ' + pkt.text,
          time: Date.now(),
          burn: false,
          system: true
        });
        renderLocalMessages();
      }
    } catch(e) {}
  });

  c.on('close', function() {
    setStatus('❌ Peer disconnected');
  });
}

function sendMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || !cryptoKey || !conn) return;

  var burn = document.getElementById('burnToggle') && document.getElementById('burnToggle').checked;

  encryptText(cryptoKey, text).then(function(ct) {
    var pkt = { type: 'msg', id: generateId(), author: nickname, ct: ct, time: Date.now(), burn: burn };

    if (conn && conn.open) {
      conn.send(JSON.stringify(pkt));
    }

    // Show locally
    decryptText(cryptoKey, ct).then(function(pt) {
      localMessages.push({
        id: pkt.id,
        author: nickname,
        plaintext: pt,
        time: pkt.time,
        burn: burn
      });
      if (burn) scheduleBurn(pkt.id);
      renderLocalMessages();
    });

    input.value = '';
  });
}

function leaveRoom() {
  if (conn) { try { conn.close(); } catch(e) {} conn = null; }
  if (peer) { try { peer.destroy(); } catch(e) {} peer = null; }

  for (var k in burnTimers) { clearTimeout(burnTimers[k]); delete burnTimers[k]; }

  currentRoom = null;
  nickname = '';
  cryptoKey = null;
  isHost = false;
  localMessages = [];

  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('chatRoom').style.display = 'none';
  document.getElementById('roomNameInput').value = '';
  document.getElementById('nickInput').value = '';
  document.getElementById('roomPassInput').value = '';
  document.getElementById('inviteCodeInput').value = '';
  document.getElementById('joinNickInput').value = '';
  document.getElementById('joinPassInput').value = '';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatInput').disabled = true;
}

function showRoom(roomName, status) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('chatRoom').style.display = 'flex';
  document.getElementById('chatRoomName').textContent = roomName;
  document.getElementById('chatRoomInfo').textContent = status;
}

function showConnectingUI(text) {
  var container = document.getElementById('chatMessages');
  container.innerHTML = '<div class="system-msg">' + escapeHtml(text) + '</div>';
}

function showInviteCode(code) {
  var container = document.getElementById('chatMessages');
  container.innerHTML =
    '<div class="system-msg">🔗 Share this invite code with your peer:</div>' +
    '<div class="system-msg">⚠️ Password ALAG se bhejo (invite code mein nahi hai)</div>' +
    '<div class="invite-code-display" id="inviteCodeDisplay">' + escapeHtml(code) + '</div>' +
    '<button class="primary-btn" onclick="copyFullInvite()" style="margin:12px auto;display:block">📋 Copy Invite Code</button>' +
    '<div class="system-msg">⏳ Waiting for someone to join...</div>';
}

function copyFullInvite() {
  var el = document.getElementById('inviteCodeDisplay');
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(function() {
    setStatus('✅ Invite code copied!');
  }).catch(function() {
    setStatus('❌ Could not copy. Select and copy manually.');
  });
}

function showChatUI(roomName) {
  var container = document.getElementById('chatMessages');
  container.innerHTML = '<div class="system-msg">🔒 End-to-end encrypted via PeerJS + AES-256-GCM</div>';
  setStatus('🔗 Connected');
  renderLocalMessages();

  var input = document.getElementById('chatInput');
  input.disabled = false;
  input.placeholder = 'Type a message...';
  input.onkeydown = function(e) {
    if (e.key === 'Enter') sendMessage();
  };
  input.focus();
}

function renderLocalMessages() {
  var container = document.getElementById('chatMessages');
  if (localMessages.length === 0) return;

  var html = '<div class="system-msg">🔒 End-to-end encrypted</div>';
  var lastAuthor = '';
  for (var i = 0; i < localMessages.length; i++) {
    var m = localMessages[i];

    if (m.system) {
      html += '<div class="system-msg">' + escapeHtml(m.plaintext) + '</div>';
      continue;
    }

    var isOwn = m.author === nickname;
    var showAuthor = m.author !== lastAuthor;

    html += '<div class="msg ' + (isOwn ? 'own' : 'other') + '" id="msg-' + m.id + '">';
    if (showAuthor) {
      html += '<div class="msg-author">' + escapeHtml(m.author) + '</div>';
    }
    html += escapeHtml(m.plaintext);
    if (m.burn) {
      html += ' <span class="burn-indicator">🔥</span>';
    }
    html += '<div class="msg-time">' + formatChatTime(m.time) + '</div>';
    html += '</div>';
    lastAuthor = m.author;
  }
  container.innerHTML = html;
  scrollToBottom();
}

function scheduleBurn(msgId) {
  if (burnTimers[msgId]) return;
  burnTimers[msgId] = setTimeout(function() {
    localMessages = localMessages.filter(function(m) { return m.id !== msgId; });
    renderLocalMessages();
    delete burnTimers[msgId];
  }, 10000);
}

function scrollToBottom() {
  var container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatChatTime(ts) {
  var d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function copyInvite() {
  var el = document.getElementById('inviteCodeDisplay');
  if (el) {
    navigator.clipboard.writeText(el.textContent).then(function() {
      setStatus('✅ Copied!');
    });
  }
}

window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendMessage = sendMessage;
window.leaveRoom = leaveRoom;
window.copyInvite = copyInvite;
window.copyFullInvite = copyFullInvite;

window.addEventListener('load', function() {
  document.getElementById('chatInput').disabled = true;
  var params = new URLSearchParams(window.location.search);
  var invite = params.get('invite');
  if (invite) {
    document.getElementById('inviteCodeInput').value = invite;
    document.getElementById('joinNickInput').focus();
  }
});
