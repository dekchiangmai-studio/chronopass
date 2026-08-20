document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
  const target = document.querySelector(link.getAttribute('href'));
  if (target) { event.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
}));

document.querySelectorAll('details').forEach((item) => item.addEventListener('toggle', () => {
  if (item.open) document.querySelectorAll('details').forEach((other) => { if (other !== item) other.open = false; });
}));
