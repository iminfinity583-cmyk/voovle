document.addEventListener('DOMContentLoaded', function() {
  const searchForm = document.querySelector('.search-form');
  const searchInput = document.querySelector('.search-input');
  const luckyBtn = document.querySelector('.lucky-btn');

  searchForm.addEventListener('submit', function(e) {
    const query = searchInput.value.trim();
    if (!query) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  luckyBtn.addEventListener('click', function() {
    const query = searchInput.value.trim();
    if (query) {
      window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query) + '&btnI=1';
    }
  });

  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !searchInput.value.trim()) {
      e.preventDefault();
    }
  });

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value.trim();
      const msg = document.getElementById('loginMessage');
      if (!email || !password) {
        msg.textContent = 'Please enter email and password.';
      } else {
        msg.style.color = '#188038';
        msg.textContent = 'Signed in successfully! Redirecting...';
        setTimeout(function() {
          window.location.href = 'index.html';
        }, 1500);
      }
    });
  }
});
