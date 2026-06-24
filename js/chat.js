var currentRoom = null;
var nickname = '';
var pollInterval = null;

function generateId() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function getRooms() {
  return JSON.parse(localStorage.getItem('voovle_chat_rooms') || '{}');
}

function saveRooms(rooms) {
  localStorage.setItem('voovle_chat_rooms', JSON.stringify(rooms));
}

function createRoom() {
  var name = document.getElementById('roomNameInput').value.trim();
  var nick = document.getElementById('nickInput').value.trim();
  var msg = document.getElementById('lobbyMsg');

  if (!name || !nick) {
    msg.textContent = 'Please fill in all fields.';
    return;
  }

  var roomId = generateId();
  var inviteCode = roomId;

  var rooms = getRooms();
  rooms[roomId] = {
    name: name,
    created: Date.now(),
    messages: []
  };
  saveRooms(rooms);

  nickname = nick;
  currentRoom = roomId;
  enterRoom(roomId, name, inviteCode);
  msg.textContent = '';
}

function joinRoom() {
  var code = document.getElementById('inviteCodeInput').value.trim();
  var nick = document.getElementById('joinNickInput').value.trim();
  var msg = document.getElementById('lobbyMsg');

  if (!code || !nick) {
    msg.textContent = 'Please fill in all fields.';
    return;
  }

  var rooms = getRooms();
  if (!rooms[code]) {
    msg.textContent = 'Invalid invite code. Room not found.';
    return;
  }

  nickname = nick;
  currentRoom = code;
  enterRoom(code, rooms[code].name, code);
  msg.textContent = '';
}

function enterRoom(roomId, roomName, inviteCode) {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('chatRoom').style.display = 'flex';
  document.getElementById('chatRoomName').textContent = roomName;
  document.getElementById('chatRoomInfo').textContent = 'Invite code: ' + inviteCode;

  renderMessages();

  pollInterval = setInterval(function() {
    renderMessages();
  }, 2000);

  document.getElementById('chatInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
  });

  setTimeout(function() {
    document.getElementById('chatInput').focus();
  }, 300);
}

function leaveRoom() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  currentRoom = null;
  nickname = '';
  document.getElementById('lobby').style.display = 'flex';
  document.getElementById('chatRoom').style.display = 'none';
  document.getElementById('roomNameInput').value = '';
  document.getElementById('nickInput').value = '';
  document.getElementById('inviteCodeInput').value = '';
  document.getElementById('joinNickInput').value = '';
}

function sendMessage() {
  var input = document.getElementById('chatInput');
  var text = input.value.trim();
  if (!text || !currentRoom) return;

  var rooms = getRooms();
  var room = rooms[currentRoom];
  if (!room) return;

  room.messages.push({
    id: generateId(),
    author: nickname,
    text: text,
    time: Date.now()
  });
  saveRooms(rooms);
  input.value = '';

  renderMessages();
  scrollToBottom();
}

function renderMessages() {
  var container = document.getElementById('chatMessages');
  var rooms = getRooms();
  var room = rooms[currentRoom];
  if (!room) {
    container.innerHTML = '<div class="system-msg">Room not found.</div>';
    return;
  }

  var html = '';
  var lastAuthor = '';
  for (var i = 0; i < room.messages.length; i++) {
    var m = room.messages[i];
    var isOwn = m.author === nickname;
    var showAuthor = m.author !== lastAuthor;
    html += '<div class="msg ' + (isOwn ? 'own' : 'other') + '">';
    if (showAuthor) {
      html += '<div class="msg-author">' + escapeHtml(m.author) + '</div>';
    }
    html += escapeHtml(m.text);
    html += '<div class="msg-time">' + formatChatTime(m.time) + '</div>';
    html += '</div>';
    lastAuthor = m.author;
  }
  container.innerHTML = html;
}

function scrollToBottom() {
  var container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function copyInvite() {
  var rooms = getRooms();
  var room = rooms[currentRoom];
  if (!room) return;

  var inviteLink = window.location.origin + window.location.pathname + '?invite=' + currentRoom;
  navigator.clipboard.writeText(currentRoom).then(function() {
    var btn = document.querySelector('.invite-btn');
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = '\uD83D\uDCE9 Copy Invite'; }, 2000);
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
    var rooms = getRooms();
    if (rooms[invite]) {
      document.getElementById('inviteCodeInput').value = invite;
    }
  }
});
