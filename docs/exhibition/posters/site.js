// Written by build.mjs from .work/site-url.txt (the live site's address). Fills every [data-site-url] element.
window.COSMOS_SITE_URL = 'https://cosmos-astronexus.vercel.app';
for (const el of document.querySelectorAll('[data-site-url]')) el.textContent = window.COSMOS_SITE_URL.replace(/^https?:\/\//, '');
if (/[?&]guides=1/.test(location.search)) document.documentElement.classList.add('guides'); // trim (magenta) and safe-area (cyan) guides
