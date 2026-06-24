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
});
