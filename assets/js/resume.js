// Build the email link here so scrapers reading the HTML don't get the address.
(function () {
  var a = document.getElementById('em');
  var addr = ['mapurpura12', 'gmail.com'].join('@');
  a.href = 'mailto:' + addr + '?subject=' + encodeURIComponent('Hello from okay-cool.net');
  a.textContent = addr;
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });

  // The Download menu (resume/index.html) is a <details>, so it opens and closes without this. This closes it
  // the way a menu should: after a pick (focus back on the button), on a tap elsewhere, on Escape, or when Tab
  // leaves it.
  var dl = document.querySelector('details.dl');
  if (dl) {
    var toggle = dl.querySelector('summary');
    var shut = function (refocus) {
      if (!dl.open) return;
      dl.open = false;
      if (refocus) toggle.focus();
    };
    dl.addEventListener('click', function (e) {
      if (e.target.closest('a[href]')) setTimeout(function () { shut(true); }, 0);  // after the download starts
    });
    document.addEventListener('pointerdown', function (e) { if (!dl.contains(e.target)) shut(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dl.open) shut(dl.contains(document.activeElement));
    });
    dl.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !dl.contains(e.relatedTarget)) shut(false);
    });
  }

  // Designed / ATS-friendly (resume/index.html). The radios restyle the sheet with CSS alone; this keeps
  // #plain in the address so the ATS-friendly view can be linked.
  var plain = document.getElementById('view-plain');
  if (!plain) return;
  var designed = document.getElementById('view-designed');
  function fromHash() { (location.hash === '#plain' ? plain : designed).checked = true; }
  fromHash();
  window.addEventListener('hashchange', fromHash);
  [designed, plain].forEach(function (r) {
    r.addEventListener('change', function () {
      history.replaceState(null, '', plain.checked ? '#plain' : location.pathname + location.search);
    });
  });
})();
