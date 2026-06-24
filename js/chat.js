var currentRoom = null;
var nickname = '';
var cryptoKey = null;
var pollInterval = null;
var burnTimers = {};

function generateId() {
  var a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function getRooms() {
  try {
    return JSON.parse(localStorage.getItem('_vc_rooms') || '{}');
  } catch(e) { return {}; }
}

function saveRooms(rooms) {
  localStorage.setItem('_vc_rooms', JSON.stringify(rooms));
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
    var rooms = getRooms();
    rooms[roomId] = {
      name: name,
      salt: btoa(String.fromCharCode.apply(null, salt)),
      created: Date.now(),
      messages: []
    };
    saveRooms(rooms);

    nickname = nick;
    currentRoom = roomId;
    cryptoKey = key;
    enterRoom(roomId, name, roomId);
    msg.textContent = '';
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

  var rooms = getRooms();
  var room = rooms[code];
  if (!room) {
    msg.textContent = 'Invalid invite code. Room not found.';
    return;
  }

  var salt = Uint8Array.from(atob(room.salt), function(c) { return c.charCodeAt(0); });
  deriveKey(pass, salt).then(function(key) {
    cryptoKey = key;
    nickname = nick;
    currentRoom = code;

    var testMsg = room.messages.length > 0 ? room.messages[room.messages.length - 1] : null;
    if (testMsg) {
      return decryptText(key, testMsg.ct).then(function(pt) {
        if (pt === '[decryption error]') {
          msg.textContent = 'Wrong password. Cannot decrypt room.';
          cryptoKey = null;
          currentRoom = null;
          return;
        }
        enterRoom(code, room.name, code);
        msg.textContent = '';
      });
    } else {
      enterRoom(code, room.name, code);
      msg.textContent = '';
    }
  });
}

function enterRoom(roomId, roomName, inviteCode) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('chatRoom').style.display = 'flex';
  document.getElementById('chatRoomName').textContent = roomName;
  document.getElementById('chatRoomInfo').textContent = 'Invite: ' + inviteCode;

  renderMessages().then(function() {
    scrollToBottom();
  });

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(function() {
    renderMessages();
  }, 2000);

  var input = document.getElementById('chatInput');
  input.onkeydown = function(e) {
    if (e.key === 'Enter') sendMessage();
  };

  setTimeout(function() { input.focus(); }, 300);
}

function leaveRoom() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }

  var rooms = getRooms();
  if (currentRoom && rooms[currentRoom]) {
    delete rooms[currentRoom];
    saveRooms(rooms);
  }

  for (var k in burnTimers) { clearTimeout(burnTimers[k]); delete burnTimers[k]; }

  currentRoom = null;
  nickname = '';
  cryptoKey = null;

  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('chatRoom').style.display = 'none';
  document.getElementById('roomNameInput').value = '';
  document.getElementById('nickInput').value = '';
  document.getElementById('roomPassInput').value = '';
  document.getElementById('inviteCodeInput').value = '';
  document.getElementById('joinNickInput').value = '';
  document.getElementById('joinPassInput').value = '';
  document.getElementById('chatInput').value = '';
}

function sendMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || !currentRoom || !cryptoKey) return;

  var rooms = getRooms();
  var room = rooms[currentRoom];
  if (!room) return;

  var burn = document.getElementById('burnToggle') && document.getElementById('burnToggle').checked;

  encryptText(cryptoKey, text).then(function(ct) {
    var msg = { id: generateId(), author: nickname, ct: ct, time: Date.now(), burn: burn };
    room.messages.push(msg);
    saveRooms(rooms);
    input.value = '';

    renderMessages().then(function() { scrollToBottom(); });
  });
}

function renderMessages() {
  if (!currentRoom || !cryptoKey) return Promise.resolve();

  var container = document.getElementById('chatMessages');
  var rooms = getRooms();
  var room = rooms[currentRoom];
  if (!room) {
    container.innerHTML = '<div class="system-msg">Room not found.</div>';
    return Promise.resolve();
  }

  var decrypts = room.messages.map(function(m) {
    return decryptText(cryptoKey, m.ct).then(function(pt) {
      return { msg: m, plaintext: pt };
    });
  });

  return Promise.all(decrypts).then(function(decrypted) {
    var html = '<div class="system-msg">🔒 End-to-end encrypted. No one can read these messages but you.</div>';
    var lastAuthor = '';
    for (var i = 0; i < decrypted.length; i++) {
      var d = decrypted[i];
      var m = d.msg;
      var pt = d.plaintext;
      var isOwn = m.author === nickname;
      var showAuthor = m.author !== lastAuthor;

      if (m.burn) {
        scheduleBurn(m.id);
      }

      html += '<div class="msg ' + (isOwn ? 'own' : 'other') + '" id="msg-' + m.id + '">';
      if (showAuthor) {
        html += '<div class="msg-author">' + escapeHtml(m.author) + '</div>';
      }
      html += escapeHtml(pt);
      if (m.burn) {
        html += ' <span class="burn-indicator">🔥</span>';
      }
      html += '<div class="msg-time">' + formatChatTime(m.time) + '</div>';
      html += '</div>';
      lastAuthor = m.author;
    }
    container.innerHTML = html;
  });
}

function scheduleBurn(msgId) {
  if (burnTimers[msgId]) return;
  burnTimers[msgId] = setTimeout(function() {
    var rooms = getRooms();
    var room = rooms[currentRoom];
    if (!room) return;
    var idx = room.messages.findIndex(function(m) { return m.id === msgId; });
    if (idx !== -1) {
      room.messages.splice(idx, 1);
      saveRooms(rooms);
      renderMessages();
    }
    delete burnTimers[msgId];
  }, 10000);
}

function scrollToBottom() {
  var container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function copyInvite() {
  var rooms = getRooms();
  var room = rooms[currentRoom];
  if (!room) return;

  var code = currentRoom;
  navigator.clipboard.writeText(code).then(function() {
    var btn = document.querySelector('.invite-btn');
    btn.textContent = 'Copied! Share the PASSWORD separately!';
    setTimeout(function() { btn.textContent = '\uD83D\uDCE9 Copy Invite Code'; }, 3000);
  });
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

window.addEventListener('load', function() {
  var params = new URLSearchParams(window.location.search);
  var invite = params.get('invite');
  if (invite) {
    document.getElementById('inviteCodeInput').value = invite;
    document.getElementById('joinNickInput').focus();
  }
});
