// Applied before first paint so the page never flashes the wrong theme.
try {
  var t = localStorage.getItem('rpc.theme') || 'dark';
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
