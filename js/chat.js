var currentRoom = null;
var nickname = '';
var cryptoKey = null;
var peerConn = null;
var dataChannel = null;
var broadcastChannel = null;
var connected = false;
var pendingIceCandidates = [];
var burnTimers = {};
var localMessages = [];
var ROOM_KEY = '_vc_rooms';
var STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

function generateId() {
  var a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function getRooms() {
  try { return JSON.parse(localStorage.getItem(ROOM_KEY) || '{}'); } catch(e) { return {}; }
}

function saveRooms(r) {
  localStorage.setItem(ROOM_KEY, JSON.stringify(r));
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

function buf2base(buf) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
}

function base2buf(str) {
  return Uint8Array.from(atob(str), function(c) { return c.charCodeAt(0); }).buffer;
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

    msg.textContent = 'Creating room...';

    startAsHost(roomId, name);
  });
}

function startAsHost(roomId, roomName) {
  showRoom(roomName, 'Creating P2P connection...');

  // Get the salt we saved to localStorage
  var rooms = getRooms();
  var room = rooms[roomId];
  var saltB64 = room ? room.salt : '';

  peerConn = new RTCPeerConnection({ iceServers: STUN });
  dataChannel = peerConn.createDataChannel('voovle-chat');
  setupDataChannel();

  peerConn.createOffer().then(function(offer) {
    return peerConn.setLocalDescription(offer);
  }).then(function() {
    return new Promise(function(resolve) {
      if (peerConn.iceGatheringState === 'complete') {
        resolve();
      } else {
        peerConn.onicecandidate = function(e) {
          if (!e.candidate) resolve();
        };
      }
    });
  }).then(function() {
    var offerSdp = peerConn.localDescription.sdp;
    // Format: roomId:saltB64:sdpB64
    var invite = roomId + ':' + saltB64 + ':' + btoa(unescape(encodeURIComponent(offerSdp)));
    document.getElementById('chatRoomName').textContent = roomName;
    setStatus('Paste this invite code:');
    showInviteCode(invite);
    showAnswerInput(roomId, roomName);
  });
}

function showAnswerInput(roomId, roomName) {
  var container = document.getElementById('chatMessages');
  container.innerHTML =
    '<div class="system-msg">📋 Send the invite code to your peer</div>' +
    '<div class="system-msg">⏳ Paste their answer below once you receive it:</div>' +
    '<div class="answer-input-area">' +
    '<textarea id="answerSdpInput" placeholder="Paste the answer code from your peer here..." rows="3"></textarea>' +
    '<button class="primary-btn" onclick="submitAnswer(\'' + roomId + '\',\'' + escapeHtml(roomName) + '\')">Connect</button>' +
    '</div>';
}

function submitAnswer(roomId, roomName) {
  var answerSdp = document.getElementById('answerSdpInput').value.trim();
  if (!answerSdp) return;
  try {
    var sdp = decodeURIComponent(escape(atob(answerSdp)));
    var desc = new RTCSessionDescription({ type: 'answer', sdp: sdp });
    peerConn.setRemoteDescription(desc).then(function() {
      setStatus('🔗 Connected! End-to-end encrypted.');
      showChatUI(roomName);
    }).catch(function(e) {
      setStatus('Connection failed: ' + e.message);
    });
  } catch(e) {
    setStatus('Invalid answer code.');
  }
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

  // Try localStorage room first (backward compat / same-browser)
  var rooms = getRooms();
  var parts = code.split(':');
  var roomId = parts[0];
  var room = rooms[roomId];

  if (room) {
    // Same-browser room: join via localStorage
    var salt = Uint8Array.from(atob(room.salt), function(c) { return c.charCodeAt(0); });
    deriveKey(pass, salt).then(function(key) {
      cryptoKey = key;
      nickname = nick;
      currentRoom = roomId;

      var testMsg = room.messages.length > 0 ? room.messages[room.messages.length - 1] : null;
      if (testMsg) {
        return decryptText(key, testMsg.ct).then(function(pt) {
          if (pt === '[decryption error]') {
            msg.textContent = 'Wrong password. Cannot decrypt room.';
            cryptoKey = null;
            currentRoom = null;
            return;
          }
          enterLocalRoom(roomId, room.name, roomId);
          msg.textContent = '';
        });
      } else {
        enterLocalRoom(roomId, room.name, roomId);
        msg.textContent = '';
      }
    });
    return;
  }

  // P2P invite code: roomId:saltB64:sdpB64
  if (parts.length < 3) {
    msg.textContent = 'Invalid invite code format.';
    return;
  }

  roomId = parts[0];
  var saltB64 = parts[1];
  var sdpB64 = parts.slice(2).join(':');

  var salt = Uint8Array.from(atob(saltB64), function(c) { return c.charCodeAt(0); });
  if (salt.length === 0) {
    msg.textContent = 'Invalid invite code: bad salt.';
    return;
  }

  deriveKey(pass, salt).then(function(key) {
    cryptoKey = key;
    nickname = nick;
    currentRoom = roomId;

    msg.textContent = 'Connecting...';

    try {
      var sdp = decodeURIComponent(escape(atob(sdpB64)));
      startAsJoiner(roomId, sdp);
    } catch(e) {
      msg.textContent = 'Invalid invite code.';
    }
  });
}

function startAsJoiner(roomId, offerSdp) {
  peerConn = new RTCPeerConnection({ iceServers: STUN });

  peerConn.ondatachannel = function(e) {
    dataChannel = e.channel;
    setupDataChannel();
  };

  var desc = new RTCSessionDescription({ type: 'offer', sdp: offerSdp });
  peerConn.setRemoteDescription(desc).then(function() {
    return peerConn.createAnswer();
  }).then(function(answer) {
    return peerConn.setLocalDescription(answer);
  }).then(function() {
    return new Promise(function(resolve) {
      if (peerConn.iceGatheringState === 'complete') {
        resolve();
      } else {
        peerConn.onicecandidate = function(e) {
          if (!e.candidate) resolve();
        };
      }
    });
  }).then(function() {
    var answerSdp = peerConn.localDescription.sdp;
    var answerCode = btoa(unescape(encodeURIComponent(answerSdp)));

    navigator.clipboard.writeText(answerCode).then(function() {
      var roomName = 'P2P Chat';
      showRoom(roomName, '📋 Answer code copied to clipboard! Send it back to the room creator.');
      var container = document.getElementById('chatMessages');
      container.innerHTML =
        '<div class="system-msg">✅ Answer copied! Paste it back to the room creator.</div>' +
        '<div class="system-msg">⏳ Waiting for them to submit it...</div>';

      // Poll for connection
      var checkInterval = setInterval(function() {
        if (connected) {
          clearInterval(checkInterval);
          showChatUI(roomName);
        }
      }, 500);
    }).catch(function() {
      setStatus('❌ Could not copy answer. Select and copy manually:');
      var container = document.getElementById('chatMessages');
      container.innerHTML =
        '<div class="system-msg">📋 Copy this answer code and send it to the room creator:</div>' +
        '<textarea readonly rows="3" style="width:100%;font-size:12px;padding:8px;border:1px solid #dadce0;border-radius:8px;background:#f8f9fa;color:#202124;resize:none;word-break:break-all">' + answerCode + '</textarea>' +
        '<div class="system-msg">⏳ Waiting for peer to connect...</div>';

      var ci = setInterval(function() {
        if (connected) {
          clearInterval(ci);
          showChatUI(roomName);
        }
      }, 500);
    });
  });
}

function setupDataChannel() {
  dataChannel.onopen = function() {
    connected = true;
    if (currentRoom) {
      var rooms = getRooms();
      var room = rooms[currentRoom];
      if (room) showChatUI(room.name);
    }
  };

  dataChannel.onclose = function() {
    connected = false;
    setStatus('❌ Disconnected');
  };

  dataChannel.onmessage = function(e) {
    try {
      var pkt = JSON.parse(e.data);
      if (pkt.type === 'msg' && cryptoKey) {
        decryptText(cryptoKey, pkt.ct).then(function(pt) {
          localMessages.push({
            id: pkt.id,
            author: pkt.author,
            plaintext: pt,
            time: pkt.time,
            burn: pkt.burn
          });
          if (pkt.burn) scheduleBurn(pkt.id);
          renderLocalMessages();

          // Broadcast to same-browser tabs
          if (broadcastChannel) {
            broadcastChannel.postMessage({ type: 'msg', data: pkt });
          }
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
  };
}

function showRoom(roomName, status) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('chatRoom').style.display = 'flex';
  document.getElementById('chatRoomName').textContent = roomName;
  document.getElementById('chatRoomInfo').textContent = status;
}

function showInviteCode(code) {
  var container = document.getElementById('chatMessages');
  container.innerHTML =
    '<div class="system-msg">🔗 Share this invite code with your peer:</div>' +
    '<div class="invite-code-display" id="inviteCodeDisplay">' + escapeHtml(code) + '</div>' +
    '<button class="primary-btn" onclick="copyFullInvite()" style="margin:8px auto;display:block">📋 Copy Invite Code</button>' +
    '<div class="system-msg">⚠️ Share the PASSWORD separately (not in this code!)</div>';
}

function copyFullInvite() {
  var el = document.getElementById('inviteCodeDisplay');
  if (!el) return;
  var code = el.textContent;
  navigator.clipboard.writeText(code).then(function() {
    var btn = document.querySelector('.invite-btn-custom');
    setStatus('✅ Invite code copied!');
  }).catch(function() {
    setStatus('❌ Could not copy. Select and copy manually.');
  });
}

function showChatUI(roomName) {
  var container = document.getElementById('chatMessages');
  container.innerHTML = '<div class="system-msg">🔒 End-to-end encrypted P2P connection active</div>';
  connected = true;
  setStatus('🔗 Connected — ' + roomName);
  renderLocalMessages();

  var input = document.getElementById('chatInput');
  input.disabled = false;
  input.placeholder = 'Type a message...';
  input.onkeydown = function(e) {
    if (e.key === 'Enter') sendMessage();
  };
  input.focus();

  // Setup BroadcastChannel for local multi-tab
  setupBroadcastChannel(currentRoom);
}

function setupBroadcastChannel(roomId) {
  try {
    broadcastChannel = new BroadcastChannel('vc-' + roomId);
    broadcastChannel.onmessage = function(e) {
      if (e.data.type === 'msg') {
        var pkt = e.data.data;
        if (pkt.author !== nickname && cryptoKey) {
          decryptText(cryptoKey, pkt.ct).then(function(pt) {
            localMessages.push({
              id: pkt.id,
              author: pkt.author,
              plaintext: pt,
              time: pkt.time,
              burn: pkt.burn
            });
            if (pkt.burn) scheduleBurn(pkt.id);
            renderLocalMessages();
          });
        }
      }
    };
  } catch(e) {}
}

function sendMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || !cryptoKey) return;

  var burn = document.getElementById('burnToggle') && document.getElementById('burnToggle').checked;

  encryptText(cryptoKey, text).then(function(ct) {
    var pkt = { type: 'msg', id: generateId(), author: nickname, ct: ct, time: Date.now(), burn: burn };

    if (connected && dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(pkt));
    }

    // Also decrypt and show locally
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

    // Broadcast to local tabs
    if (broadcastChannel) {
      broadcastChannel.postMessage(pkt);
    }

    input.value = '';
  });
}

function renderLocalMessages() {
  var container = document.getElementById('chatMessages');
  if (!connected && localMessages.length === 0) return;

  if (localMessages.length === 0) {
    container.innerHTML = '<div class="system-msg">🔒 End-to-end encrypted P2P connection active</div>';
    return;
  }

  var html = '<div class="system-msg">🔒 End-to-end encrypted</div>';
  var lastAuthor = '';
  for (var i = 0; i < localMessages.length; i++) {
    var m = localMessages[i];
    var isOwn = m.author === nickname;
    var showAuthor = m.author !== lastAuthor && !m.system;

    if (m.system) {
      html += '<div class="system-msg">' + escapeHtml(m.plaintext) + '</div>';
      continue;
    }

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

function leaveRoom() {
  if (dataChannel) { try { dataChannel.close(); } catch(e) {} dataChannel = null; }
  if (peerConn) { try { peerConn.close(); } catch(e) {} peerConn = null; }
  if (broadcastChannel) { try { broadcastChannel.close(); } catch(e) {} broadcastChannel = null; }
  if (pendingIceCandidates) pendingIceCandidates = [];

  for (var k in burnTimers) { clearTimeout(burnTimers[k]); delete burnTimers[k]; }

  // Delete messages from localStorage only for P2P rooms (we don't store messages anyway)
  var rooms = getRooms();
  if (currentRoom && rooms[currentRoom]) {
    delete rooms[currentRoom];
    saveRooms(rooms);
  }

  currentRoom = null;
  nickname = '';
  cryptoKey = null;
  connected = false;
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

// Legacy: localStorage-based room (same-browser fallback)
function enterLocalRoom(roomId, roomName, inviteCode) {
  showRoom(roomName, 'Same-browser mode (P2P not available)');

  connected = true;
  localMessages = [];
  setupBroadcastChannel(roomId);

  // Load existing messages
  var rooms = getRooms();
  var room = rooms[roomId];
  if (room && room.messages) {
    var decrypts = room.messages.map(function(m) {
      return decryptText(cryptoKey, m.ct).then(function(pt) {
        return { id: m.id, author: m.author, plaintext: pt, time: m.time, burn: m.burn };
      });
    });
    Promise.all(decrypts).then(function(msgs) {
      localMessages = msgs;
      renderLocalMessages();
    });
  }

  document.getElementById('chatInput').disabled = false;
  document.getElementById('chatInput').placeholder = 'Type a message...';
  document.getElementById('chatInput').onkeydown = function(e) {
    if (e.key === 'Enter') sendLocalMessage();
  };
  setTimeout(function() { document.getElementById('chatInput').focus(); }, 300);
}

function sendLocalMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || !currentRoom || !cryptoKey) return;

  var burn = document.getElementById('burnToggle') && document.getElementById('burnToggle').checked;

  encryptText(cryptoKey, text).then(function(ct) {
    var rooms = getRooms();
    var room = rooms[currentRoom];
    if (!room) return;

    var msg = { id: generateId(), author: nickname, ct: ct, time: Date.now(), burn: burn };
    room.messages.push(msg);
    saveRooms(rooms);

    decryptText(cryptoKey, ct).then(function(pt) {
      localMessages.push({
        id: msg.id,
        author: nickname,
        plaintext: pt,
        time: msg.time,
        burn: burn
      });
      if (burn) scheduleBurn(msg.id);
      renderLocalMessages();
    });

    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'msg', data: msg });
    }

    input.value = '';
  });
}

// Override createRoom and joinRoom for backward compatibility with HTML
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendMessage = sendMessage;
window.leaveRoom = leaveRoom;
window.copyInvite = function() {
  // For P2P rooms, just copy the invite from the display
  var el = document.getElementById('inviteCodeDisplay');
  if (el) {
    navigator.clipboard.writeText(el.textContent).then(function() {
      setStatus('✅ Copied!');
    });
  }
};
window.submitAnswer = submitAnswer;
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
