// Build the email link here so scrapers reading the HTML don't get the address.
(function () {
  var a = document.getElementById('em');
  var addr = ['mapurpura12', 'gmail.com'].join('@');
  a.href = 'mailto:' + addr + '?subject=' + encodeURIComponent('Hello from okay-cool.net');
  a.textContent = addr;
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });

  // Designed / Plain (resume/index.html). The radios switch the look with CSS alone; this keeps
  // #plain in the address so the plain view can be linked, and tints the browser bar to match.
  var plain = document.getElementById('view-plain');
  if (!plain) return;
  var designed = document.getElementById('view-designed');
  var tint = document.querySelector('meta[name="theme-color"]');
  var dark = window.matchMedia('(prefers-color-scheme: dark)');
  function paint() { if (tint) tint.content = plain.checked ? (dark.matches ? '#121212' : '#ffffff') : '#0b0716'; }
  function fromHash() { (location.hash === '#plain' ? plain : designed).checked = true; paint(); }
  fromHash();
  window.addEventListener('hashchange', fromHash);
  [designed, plain].forEach(function (r) {
    r.addEventListener('change', function () {
      history.replaceState(null, '', plain.checked ? '#plain' : location.pathname + location.search);
      paint();
    });
  });
})();
