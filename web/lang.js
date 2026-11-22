// Показать раздел на языке ?lang= или языка браузера (kk / ru / en).
(function () {
  var q = new URLSearchParams(location.search).get('lang');
  var nav = (navigator.language || 'ru').slice(0, 2);
  var lang = ['kk', 'ru', 'en'].indexOf(q) >= 0 ? q : ['kk', 'ru', 'en'].indexOf(nav) >= 0 ? nav : 'ru';
  document.documentElement.lang = lang;
  document.querySelectorAll('section[data-lang]').forEach(function (s) { s.hidden = s.getAttribute('data-lang') !== lang; });
  document.querySelectorAll('nav.lang a').forEach(function (a) { if (a.getAttribute('data-lang') === lang) a.className = 'on'; });
  var t = document.querySelector('section[data-lang="' + lang + '"]').getAttribute('data-title');
  if (t) document.title = t;
})();
