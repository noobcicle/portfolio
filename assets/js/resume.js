// Build the email link here so scrapers reading the HTML don't get the address.
(function () {
  var a = document.getElementById('em');
  var addr = ['mapurpura12', 'gmail.com'].join('@');
  a.href = 'mailto:' + addr + '?subject=' + encodeURIComponent('Hello from okay-cool.net');
  a.textContent = addr;
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });

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
