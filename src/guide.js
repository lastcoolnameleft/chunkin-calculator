const fs = require('node:fs/promises');
const path = require('node:path');
const markdown = require('markdown-it')({ html: false })
  .use(require('markdown-it-texmath'), {
    engine: require('katex'),
    delimiters: 'dollars',
    katexOptions: { throwOnError: false, trust: false }
  });

async function renderGuide() {
  const source = await fs.readFile(path.join(__dirname, '../docs/triangulation-guide.md'), 'utf8');
  const content = markdown.render(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How This Works - Impact Distance Tracker</title>
<link rel="stylesheet" href="/guide-assets/katex.min.css">
<style>
:root{--ink:#0f2436;--paper:#f2ede2;--card:#fbf8f0;--line:#c9bfa8;--accent:#2f6f7a}
@media(prefers-color-scheme:dark){:root{--ink:#e8e2d2;--paper:#101c24;--card:#152530;--line:#33475a;--accent:#7fc4cf}}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 60px;background:var(--paper);color:var(--ink);font-family:Georgia,serif;line-height:1.65}
main,nav{max-width:900px;margin:0 auto}
main{background:var(--card);padding:20px;border:1px solid var(--line);border-radius:3px}
h1,h2,h3,h4,nav{font-family:'Trebuchet MS',sans-serif;line-height:1.3}
h2{margin-top:2rem}a{color:var(--accent)}img{max-width:100%;height:auto}
nav{margin-bottom:18px}table{display:block;overflow-x:auto;border-collapse:collapse;font-size:.9rem}
th,td{padding:8px;border:1px solid var(--line)}
blockquote{border-left:3px solid var(--accent);padding-left:16px;margin-left:0}
eqn{display:block;overflow-x:auto;padding:8px 0}
code{overflow-wrap:anywhere}
.expand-image{display:block;background:none;border:none;padding:0;cursor:zoom-in;max-width:100%}
.expand-image:focus-visible,dialog button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
dialog{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:16px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}
dialog::backdrop{background:rgba(0,0,0,.75)}
dialog img{display:block;max-width:100%;max-height:calc(100dvh - 110px);width:auto;height:auto;object-fit:contain}
dialog button{display:block;margin:0 0 12px auto;background:var(--accent);color:var(--paper);border:0;padding:8px 14px;font-family:'Trebuchet MS',sans-serif;cursor:pointer}
</style>
</head>
<body>
<nav><a href="/">Impact Distance Tracker</a> &middot; How this works</nav>
<main><h1>How This Works</h1>${content}</main>
<dialog id="imageViewer" aria-label="Expanded guide image">
  <button type="button" onclick="document.getElementById('imageViewer').close()">Close image</button>
  <img id="expandedImage" alt="">
</dialog>
<script>
const viewer = document.getElementById('imageViewer');
const expanded = document.getElementById('expandedImage');
document.querySelectorAll('main img').forEach(image => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'expand-image';
  button.setAttribute('aria-label', 'Expand image: ' + image.alt);
  button.setAttribute('aria-haspopup', 'dialog');
  button.title = 'Click to expand image';
  image.replaceWith(button);
  button.append(image);
  button.addEventListener('click', () => {
    expanded.src = image.src;
    expanded.alt = image.alt;
    viewer.showModal();
  });
});
viewer.addEventListener('click', event => {
  const box = viewer.getBoundingClientRect();
  if (event.target === viewer && (event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom)) viewer.close();
});
</script>
</body>
</html>`;
}

module.exports = { renderGuide };
