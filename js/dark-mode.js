const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const btn = document.getElementById('btn-dark-mode');
const metaTheme = document.getElementById('theme-color-meta');

const sunIcon = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';

const moonIcon = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

function applyTheme(isDark) {
  document.body.classList.toggle('dark-mode', isDark);

  if (btn) {
    btn.innerHTML = isDark ? sunIcon : moonIcon;
    btn.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue(isDark ? '--text-main' : '--text-sec');

    btn.classList.remove('spin-anim');
    void btn.offsetWidth;
    btn.classList.add('spin-anim');
  }

  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#000000' : '#ffffff');
  }
}

window.toggleDarkMode = () => {
  const isDark = document.body.classList.contains('dark-mode');
  applyTheme(!isDark);
};

applyTheme(mediaQuery.matches);

if (mediaQuery.addEventListener) {
  mediaQuery.addEventListener('change', e => applyTheme(e.matches));
} else {
  mediaQuery.addListener(e => applyTheme(e.matches));
}

function updateSafariTheme() {
    const isDark = document.body.classList.contains('dark-mode');
    const metaTheme = document.getElementById('theme-color-meta');
    const appleBlack = '#000000'; 
    const appleWhite = '#ffffff'; 
    const appleGray  = '#f3f4f6';
    const colorTop = isDark ? appleBlack : appleWhite;
    const colorBottom = isDark ? appleBlack : appleGray;
    if (metaTheme) metaTheme.setAttribute('content', colorTop);
    document.documentElement.style.backgroundColor = colorBottom;
}

const observer = new MutationObserver(() => updateSafariTheme());
observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
updateSafariTheme();