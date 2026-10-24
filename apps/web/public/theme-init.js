// Aplica o tema antes do React montar, para não piscar claro → escuro.
// Fica em arquivo separado (e não inline) por causa da Content-Security-Policy.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('martelo-theme');
  } catch (e) {}
  var dark = stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
