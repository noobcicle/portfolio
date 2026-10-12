// Build the email link here so scrapers reading the HTML don't get the address.
(function () {
  var a = document.getElementById('em');
  var addr = ['mapurpura12', 'gmail.com'].join('@');
  a.href = 'mailto:' + addr + '?subject=' + encodeURIComponent('Hello from okay-cool.net');
  a.textContent = addr;
  document.getElementById('print-btn').addEventListener('click', function () { window.print(); });
})();
