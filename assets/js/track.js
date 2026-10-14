// Résumé clicks, for the site's analytics (Plausible, served first-party at /js/script.js). This file
// sends nothing itself: every event goes through window.plausible, which only that script defines, so
// on a page without it these listeners do nothing. The events and their properties:
//   Résumé click     a link to the résumé: from (where it was), version (Designed or ATS-friendly)
//   Résumé download  one of the four files: file, from (the page it was on)
//   Résumé switch    Designed / ATS-friendly on /resume/: version (the one switched to)
//   Résumé print     the Print button: version (the one on screen)
// Names are escaped (é is é) so they match the Plausible goals whatever charset the file is served with.
(function () {
  var FILES = {
    'Mike_Purpura_Resume.pdf': 'Designed PDF',
    'Mike_Purpura_Resume.docx': 'Designed DOCX',
    'Mike_Purpura_Resume_Plain.pdf': 'ATS-friendly PDF',
    'Mike_Purpura_Resume_Plain.docx': 'ATS-friendly DOCX'
  };
  var PLACES = { hero: 'Hero', tldr: 'Short version', resume: 'Résumé section', contact: 'Contact' };

  function send(name, props) {
    if (typeof window.plausible === 'function') window.plausible('Résumé ' + name, { props: props });
  }
  function page() {
    var p = location.pathname;
    if (/\/resume\/plain\/(index\.html)?$/.test(p)) return 'ATS-friendly page';
    if (/\/resume\/(index\.html)?$/.test(p)) return 'Résumé page';
    return 'Home';
  }
  function place(a) {
    if (a.closest('#nav')) return 'Header';
    if (a.closest('#mobile-menu')) return 'Menu';
    if (a.closest('footer')) return 'Footer';
    var s = a.closest('section[id]');
    return s ? PLACES[s.id] || s.id : page();
  }
  function shown() {
    var plain = document.getElementById('view-plain');
    return plain && plain.checked ? 'ATS-friendly' : 'Designed';
  }

  function onClick(e) {
    if (e.type === 'auxclick' && e.button !== 1) return;  // middle-click opens a tab: count it too
    if (!e.target.closest) return;
    var a = e.target.closest('a[href]');
    if (!a) {
      if (e.type === 'click' && e.target.closest('#print-btn')) send('print', { version: shown() });
      return;
    }
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    var file = FILES[url.pathname.split('/').pop()];
    if (file) return send('download', { file: file, from: page() });
    var version = /^\/resume\/plain\/(index\.html)?$/.test(url.pathname) ? 'ATS-friendly'
      : /^\/resume\/(index\.html)?$/.test(url.pathname) ? (url.hash === '#plain' ? 'ATS-friendly' : 'Designed') : null;
    if (version && url.pathname !== location.pathname) send('click', { from: place(a), version: version });
  }
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);
  document.addEventListener('change', function (e) {
    if (e.target.name === 'view') send('switch', { version: e.target.id === 'view-plain' ? 'ATS-friendly' : 'Designed' });
  });
})();
