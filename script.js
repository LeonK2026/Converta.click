/* =========================================================
   GATE — conversion logic
   -----------------------------------------------------------
   Everything below runs entirely in the visitor's browser.
   No file is ever sent to a server.
   ========================================================= */

// ---------------------------------------------------------
// 1. THE ROUTE BOARD — every conversion this site offers.
//    Want to add a new pair later? Add a row here, then add
//    a matching case in the `run...` handler section below.
// ---------------------------------------------------------
const CONVERSIONS = [
  { from:'pdf',  to:'docx', cat:'documents', handler:'pdfToWord',   note:'Text content only, layout is simplified' },
  { from:'docx', to:'pdf',  cat:'documents', handler:'wordToPdf',   note:'Best for text-based documents' },
  { from:'jpg',  to:'pdf',  cat:'documents', handler:'imageToPdf'  },
  { from:'png',  to:'pdf',  cat:'documents', handler:'imageToPdf'  },
  { from:'pdf',  to:'xlsx', cat:'documents', handler:'pdfToExcel',  note:'Extracts text lines into rows' },
  { from:'pdf',  to:'pptx', cat:'documents', handler:'pdfToPptx',   note:'Each page becomes a slide image' },
  { from:'epub', to:'pdf',  cat:'documents', handler:'epubToPdf',   note:'Best-effort text reflow' },
  { from:'pdf',  to:'txt',  cat:'documents', handler:'pdfToTxt'    },

  { from:'png',  to:'jpg',  cat:'images', handler:'imageConvert' },
  { from:'jpg',  to:'png',  cat:'images', handler:'imageConvert' },
  { from:'heic', to:'jpg',  cat:'images', handler:'heicToJpg'   },
  { from:'pdf',  to:'jpg',  cat:'images', handler:'pdfToImage'  },
  { from:'pdf',  to:'png',  cat:'images', handler:'pdfToImage'  },
  { from:'webp', to:'jpg',  cat:'images', handler:'imageConvert' },
  { from:'webp', to:'png',  cat:'images', handler:'imageConvert' },
  { from:'jpg',  to:'webp', cat:'images', handler:'imageConvert' },
  { from:'png',  to:'webp', cat:'images', handler:'imageConvert' },

  { from:'mp4',  to:'mp3', cat:'media', handler:'mediaTranscode' },
  { from:'mov',  to:'mp4', cat:'media', handler:'mediaTranscode' },
  { from:'mkv',  to:'mp4', cat:'media', handler:'mediaTranscode' },
  { from:'wav',  to:'mp3', cat:'media', handler:'mediaTranscode' },
  { from:'flac', to:'mp3', cat:'media', handler:'mediaTranscode' },
  { from:'mp4',  to:'gif', cat:'media', handler:'mediaTranscode' },
  { from:'gif',  to:'mp4', cat:'media', handler:'mediaTranscode' },
];

// pdf.js needs its worker file pointed at explicitly
if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------------------------------------------------------
// 2. STATE
// ---------------------------------------------------------
let currentFile = null;
let currentExt = null;
let selectedRoute = null;   // e.g. {from:'pdf', to:'docx', ...}
let resultBlob = null;
let resultName = null;

// ---------------------------------------------------------
// 3. SMALL HELPERS
// ---------------------------------------------------------
function extOf(filename){
  return filename.split('.').pop().toLowerCase();
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}
function goToErrorPage(reason){
  sessionStorage.setItem('gate_error_reason', reason || 'Something went wrong while converting your file.');
  window.location.href = 'error.html';
}
// Loads an external script only once, on demand
const _loaded = {};
function loadScript(src){
  if (_loaded[src]) return _loaded[src];
  _loaded[src] = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = ()=>reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  return _loaded[src];
}
function setProgress(pct, label){
  const wrap = document.getElementById('progressWrap');
  wrap.classList.add('show');
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = label || (pct + '%');
}
function download(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
function baseName(name){
  return name.replace(/\.[^/.]+$/, '');
}

// ---------------------------------------------------------
// 4. DROPZONE + FILE HANDLING
// ---------------------------------------------------------
const dropzone   = document.getElementById('dropzone');
const fileInput  = document.getElementById('fileInput');
const browseBtn  = document.getElementById('browseBtn');

browseBtn.addEventListener('click', ()=>fileInput.click());
dropzone.addEventListener('click', (e)=>{ if(e.target===dropzone) fileInput.click(); });

['dragenter','dragover'].forEach(evt=>{
  dropzone.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.add('drag'); });
});
['dragleave','drop'].forEach(evt=>{
  dropzone.addEventListener(evt, e=>{ e.preventDefault(); dropzone.classList.remove('drag'); });
});
dropzone.addEventListener('drop', e=>{
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e=>{
  if (e.target.files.length) handleFile(e.target.files[0]);
});

// Safety net: without this, dropping a file anywhere near (but not exactly on)
// the dropzone makes the browser open the file as its own page and navigate
// away, instead of handing it to the site. This stops that everywhere on the
// page, and still routes the file to the converter even if the drop lands a
// few pixels outside the dashed box.
['dragover','drop'].forEach(evt=>{
  window.addEventListener(evt, e => e.preventDefault());
});
window.addEventListener('drop', e=>{
  if (e.target.closest('#dropzone')) return; // already handled above
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file){
  currentFile = file;
  currentExt = extOf(file.name);

  const holder = document.getElementById('fileChipHolder');
  holder.innerHTML = '';
  const chip = document.createElement('div');
  chip.className = 'file-chip';
  chip.innerHTML = `<span>${file.name}</span>`;
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '✕';
  clearBtn.onclick = (ev)=>{ ev.stopPropagation(); resetFile(); };
  chip.appendChild(clearBtn);
  holder.appendChild(chip);

  const matches = CONVERSIONS.filter(c => c.from === currentExt);
  const picker = document.getElementById('ticketPicker');
  const grid = document.getElementById('ticketGrid');
  grid.innerHTML = '';

  if (!matches.length){
    picker.hidden = false;
    grid.innerHTML = `<p class="muted">GATE doesn't fly ".${currentExt}" yet — check the full departure board below for supported formats.</p>`;
    document.getElementById('formats').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }

  document.getElementById('srcExtLabel').textContent = '.' + currentExt + ' files';
  matches.forEach(route => grid.appendChild(renderTicket(route, selectRoute)));
  picker.hidden = false;
  picker.scrollIntoView({behavior:'smooth', block:'start'});
}

function resetFile(){
  currentFile = null; currentExt = null; selectedRoute = null;
  document.getElementById('fileChipHolder').innerHTML = '';
  document.getElementById('ticketPicker').hidden = true;
  document.getElementById('convertPanel').hidden = true;
  fileInput.value = '';
}

function selectRoute(route){
  selectedRoute = route;
  document.querySelectorAll('#ticketGrid .ticket').forEach(t=>t.classList.remove('selected'));
  document.querySelectorAll(`#ticketGrid .ticket[data-key="${route.from}-${route.to}"]`).forEach(t=>t.classList.add('selected'));

  document.getElementById('routeFrom').textContent = route.from.toUpperCase();
  document.getElementById('routeTo').textContent = route.to.toUpperCase();
  document.getElementById('panelFileName').textContent = currentFile.name;
  document.getElementById('progressWrap').classList.remove('show');
  document.getElementById('resultBox').classList.remove('show');
  document.getElementById('convertBtn').disabled = false;
  document.getElementById('convertBtn').textContent = 'Convert file';

  const panel = document.getElementById('convertPanel');
  panel.hidden = false;
  panel.scrollIntoView({behavior:'smooth', block:'start'});
}

function renderTicket(route, onClick){
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ticket';
  el.dataset.key = route.from + '-' + route.to;
  el.innerHTML = `
    <div class="route">${route.from.toUpperCase()} <span class="arrow">→</span> ${route.to.toUpperCase()}</div>
    <div class="note">${route.note || 'Runs fully in your browser'}</div>
  `;
  el.addEventListener('click', ()=>onClick(route));
  return el;
}

// ---------------------------------------------------------
// 5. FULL DEPARTURE BOARD (browsable even with no file yet)
// ---------------------------------------------------------
const boardGrid = document.getElementById('boardGrid');
function renderBoard(cat){
  boardGrid.innerHTML = '';
  CONVERSIONS
    .filter(c => cat === 'all' || c.cat === cat)
    .forEach(route=>{
      const el = renderTicket(route, ()=>{
        toast(`Drop a .${route.from} file above to use this route`);
        dropzone.scrollIntoView({behavior:'smooth', block:'center'});
      });
      boardGrid.appendChild(el);
    });
}
renderBoard('all');
document.querySelectorAll('#tabs .tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#tabs .tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderBoard(btn.dataset.cat);
  });
});

// ---------------------------------------------------------
// 6. CONVERT BUTTON
// ---------------------------------------------------------
document.getElementById('convertBtn').addEventListener('click', async ()=>{
  if (!currentFile || !selectedRoute) return;
  const btn = document.getElementById('convertBtn');
  btn.disabled = true; btn.textContent = 'Converting…';
  document.getElementById('resultBox').classList.remove('show');
  setProgress(8, 'Preparing…');

  try {
    const handlerFn = HANDLERS[selectedRoute.handler];
    if (!handlerFn) throw new Error('No handler registered for this route');
    const { blob, filename } = await handlerFn(currentFile, selectedRoute, setProgress);
    resultBlob = blob; resultName = filename;

    setProgress(100, 'Done');
    document.getElementById('resultFileName').textContent = filename;
    document.getElementById('resultBox').classList.add('show');
    btn.textContent = 'Convert another';
    btn.disabled = false;
  } catch(err){
    console.error(err);
    goToErrorPage(err.message || 'The conversion could not be completed.');
  }
});

document.getElementById('downloadBtn').addEventListener('click', ()=>{
  if (resultBlob && resultName) download(resultBlob, resultName);
});

document.getElementById('year').textContent = new Date().getFullYear();

// ---------------------------------------------------------
// 7. CONVERSION HANDLERS
//    Each handler receives (file, route, setProgress) and
//    must resolve to { blob, filename }.
// ---------------------------------------------------------
const HANDLERS = {};

// ---- Images: canvas-based format swap ----
HANDLERS.imageConvert = (file, route, setProgress) => new Promise((resolve, reject)=>{
  setProgress(20, 'Reading image…');
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = ()=>{
    setProgress(55, 'Redrawing…');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (route.to === 'jpg'){ ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
    ctx.drawImage(img, 0, 0);
    const mime = route.to === 'jpg' ? 'image/jpeg' : `image/${route.to}`;
    canvas.toBlob(blob=>{
      if(!blob) return reject(new Error('This browser could not encode that image format.'));
      URL.revokeObjectURL(url);
      setProgress(90, 'Finishing…');
      resolve({ blob, filename: baseName(file.name) + '.' + route.to });
    }, mime, 0.92);
  };
  img.onerror = ()=>reject(new Error('That image file could not be read.'));
  img.src = url;
});

// ---- HEIC -> JPG ----
HANDLERS.heicToJpg = async (file, route, setProgress) => {
  setProgress(15, 'Loading HEIC engine…');
  await loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
  setProgress(45, 'Converting…');
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  setProgress(90, 'Finishing…');
  return { blob, filename: baseName(file.name) + '.jpg' };
};

// ---- JPG/PNG -> PDF ----
HANDLERS.imageToPdf = async (file, route, setProgress) => {
  setProgress(15, 'Loading PDF engine…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  setProgress(45, 'Placing image…');
  const dataUrl = await fileToDataUrl(file);
  const dims = await imageDims(dataUrl);
  const orientation = dims.w > dims.h ? 'l' : 'p';
  const pdf = new jsPDF({ orientation, unit:'pt', format:[dims.w, dims.h] });
  pdf.addImage(dataUrl, currentExt === 'png' ? 'PNG' : 'JPEG', 0, 0, dims.w, dims.h);
  setProgress(90, 'Finishing…');
  const blob = pdf.output('blob');
  return { blob, filename: baseName(file.name) + '.pdf' };
};

// ---- PDF -> JPG/PNG (first page; multi-page = zip of images) ----
HANDLERS.pdfToImage = async (file, route, setProgress) => {
  setProgress(10, 'Opening PDF…');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const mime = route.to === 'jpg' ? 'image/jpeg' : 'image/png';

  if (pdf.numPages === 1){
    const blob = await renderPdfPageToBlob(pdf, 1, mime);
    setProgress(90,'Finishing…');
    return { blob, filename: baseName(file.name) + '.' + route.to };
  }

  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const zip = new JSZip();
  for (let i=1;i<=pdf.numPages;i++){
    setProgress(10 + Math.round(80*i/pdf.numPages), `Rendering page ${i}/${pdf.numPages}…`);
    const blob = await renderPdfPageToBlob(pdf, i, mime);
    zip.file(`page-${String(i).padStart(2,'0')}.${route.to}`, blob);
  }
  const blob = await zip.generateAsync({type:'blob'});
  return { blob, filename: baseName(file.name) + '-pages.zip' };
};

async function renderPdfPageToBlob(pdf, pageNum, mime){
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise(res=>canvas.toBlob(res, mime, 0.92));
}

// ---- PDF -> TXT ----
HANDLERS.pdfToTxt = async (file, route, setProgress) => {
  setProgress(10, 'Opening PDF…');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i=1;i<=pdf.numPages;i++){
    setProgress(10 + Math.round(80*i/pdf.numPages), `Reading page ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it=>it.str).join(' ') + '\n\n';
  }
  const blob = new Blob([text], {type:'text/plain'});
  return { blob, filename: baseName(file.name) + '.txt' };
};

// ---- PDF -> Word (basic: text only, wrapped as a real .docx) ----
HANDLERS.pdfToWord = async (file, route, setProgress) => {
  setProgress(10, 'Opening PDF…');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const paragraphs = [];
  for (let i=1;i<=pdf.numPages;i++){
    setProgress(10 + Math.round(70*i/pdf.numPages), `Reading page ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    paragraphs.push(content.items.map(it=>it.str).join(' '));
  }
  setProgress(85, 'Building document…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  const blob = await buildSimpleDocx(paragraphs);
  return { blob, filename: baseName(file.name) + '.docx' };
};

// Builds a minimal, valid .docx from an array of paragraph strings
async function buildSimpleDocx(paragraphs){
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const body = paragraphs.map(p=>`<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  const documentXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr/></w:body></w:document>`;

  const contentTypes =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rootRels);
  zip.folder('word').file('document.xml', documentXml);
  return zip.generateAsync({ type:'blob', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---- Word -> PDF ----
HANDLERS.wordToPdf = async (file, route, setProgress) => {
  setProgress(10, 'Loading Word engine…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
  setProgress(35, 'Reading document…');
  const buf = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px;padding:20px;font-family:Georgia,serif;';
  holder.innerHTML = html;
  document.body.appendChild(holder);

  setProgress(65, 'Laying out pages…');
  const blob = await window.html2pdf().from(holder).set({
    margin: 20, filename: 'doc.pdf', jsPDF:{ unit:'pt', format:'a4' }
  }).outputPdf('blob');
  document.body.removeChild(holder);
  setProgress(90, 'Finishing…');
  return { blob, filename: baseName(file.name) + '.pdf' };
};

// ---- PDF -> Excel (text lines -> rows, best-effort) ----
HANDLERS.pdfToExcel = async (file, route, setProgress) => {
  setProgress(10, 'Loading spreadsheet engine…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const rows = [];
  for (let i=1;i<=pdf.numPages;i++){
    setProgress(10 + Math.round(70*i/pdf.numPages), `Reading page ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let line = [], lastY = null;
    content.items.forEach(it=>{
      const y = Math.round(it.transform[5]);
      if (lastY !== null && y !== lastY){ rows.push([line.join(' ')]); line = []; }
      line.push(it.str);
      lastY = y;
    });
    if (line.length) rows.push([line.join(' ')]);
  }
  setProgress(85, 'Building spreadsheet…');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { bookType:'xlsx', type:'array' });
  const blob = new Blob([out], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob, filename: baseName(file.name) + '.xlsx' };
};

// ---- PDF -> PowerPoint (each page becomes a full-slide image) ----
HANDLERS.pdfToPptx = async (file, route, setProgress) => {
  setProgress(10, 'Loading slide engine…');
  await loadScript('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pptx = new window.PptxGenJS();
  pptx.defineLayout({ name:'PDFPAGE', width:10, height:7.5 });
  pptx.layout = 'PDFPAGE';

  for (let i=1;i<=pdf.numPages;i++){
    setProgress(10 + Math.round(75*i/pdf.numPages), `Rendering page ${i}/${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x:0, y:0, w:10, h:7.5 });
  }
  setProgress(88, 'Packaging…');
  const blob = await pptx.write('blob');
  return { blob, filename: baseName(file.name) + '.pptx' };
};

// ---- EPUB -> PDF (best-effort text reflow) ----
HANDLERS.epubToPdf = async (file, route, setProgress) => {
  setProgress(10, 'Loading engines…');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
  setProgress(25, 'Unpacking EPUB…');
  const zip = await JSZip.loadAsync(file);

  const containerXml = await zip.file('META-INF/container.xml').async('string');
  const opfPath = new DOMParser().parseFromString(containerXml,'application/xml')
    .querySelector('rootfile').getAttribute('full-path');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')+1) : '';
  const opfXml = await zip.file(opfPath).async('string');
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const manifest = {};
  opfDoc.querySelectorAll('manifest > item').forEach(item=>{
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });
  const spineIds = [...opfDoc.querySelectorAll('spine > itemref')].map(el=>el.getAttribute('idref'));

  setProgress(45, 'Extracting chapters…');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:700px;padding:20px;font-family:Georgia,serif;';
  for (const id of spineIds){
    const href = manifest[id];
    if (!href) continue;
    const f = zip.file(opfDir + href);
    if (!f) continue;
    const html = await f.async('string');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style').forEach(n=>n.remove());
    const section = document.createElement('div');
    section.innerHTML = doc.body ? doc.body.innerHTML : '';
    holder.appendChild(section);
  }
  document.body.appendChild(holder);

  setProgress(70, 'Laying out pages…');
  const blob = await window.html2pdf().from(holder).set({
    margin: 24, filename:'book.pdf', jsPDF:{ unit:'pt', format:'a4' }
  }).outputPdf('blob');
  document.body.removeChild(holder);
  setProgress(92, 'Finishing…');
  return { blob, filename: baseName(file.name) + '.pdf' };
};

// ---- Audio/video transcoding via ffmpeg.wasm ----
let ffmpegInstance = null;
async function getFfmpeg(setProgress){
  if (ffmpegInstance) return ffmpegInstance;
  setProgress(12, 'Loading media engine (first time only, ~25MB)…');
  await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
  const { createFFmpeg } = FFmpeg;
  ffmpegInstance = createFFmpeg({ log:false });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

HANDLERS.mediaTranscode = async (file, route, setProgress) => {
  const ffmpeg = await getFfmpeg(setProgress);
  const { fetchFile } = FFmpeg;
  const inName = 'in.' + route.from;
  const outName = 'out.' + route.to;

  setProgress(35, 'Loading file into engine…');
  ffmpeg.FS('writeFile', inName, await fetchFile(file));

  ffmpeg.setProgress(({ ratio }) => {
    if (ratio >= 0 && ratio <= 1) setProgress(35 + Math.round(ratio*55), `Converting… ${Math.round(ratio*100)}%`);
  });

  setProgress(40, 'Converting…');
  let args = ['-i', inName];
  if (route.to === 'mp3') args.push('-vn','-b:a','192k');
  if (route.to === 'gif') args.push('-vf','fps=10,scale=480:-1:flags=lanczos');
  if (route.to === 'mp4' && route.from === 'gif') args.push('-movflags','faststart','-pix_fmt','yuv420p');
  args.push(outName);

  await ffmpeg.run(...args);
  setProgress(92, 'Packaging…');
  const data = ffmpeg.FS('readFile', outName);
  const mimeMap = { mp3:'audio/mpeg', mp4:'video/mp4', gif:'image/gif' };
  const blob = new Blob([data.buffer], { type: mimeMap[route.to] || 'application/octet-stream' });

  ffmpeg.FS('unlink', inName); ffmpeg.FS('unlink', outName);
  return { blob, filename: baseName(file.name) + '.' + route.to };
};

// ---------------------------------------------------------
// 8. TINY UTILITIES
// ---------------------------------------------------------
function fileToDataUrl(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = ()=>res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function imageDims(dataUrl){
  return new Promise(res=>{
    const img = new Image();
    img.onload = ()=>res({ w:img.naturalWidth, h:img.naturalHeight });
    img.src = dataUrl;
  });
}

// Catch anything unexpected and route it to the error page
window.addEventListener('error', (e)=>{
  // Ignore noisy cross-origin script errors from CDNs, only act on real runtime errors after a conversion started
});
