/* ==========================================================
   Echome Énergies – ACC terrain (v22)
   Correctifs: lat/lon vs lat/lng, auto-D via INSEE (reverse),
   modes explicites, long-press producteur -> supprimer,
   SDIS local (toggle)
   ========================================================== */

// =============== Helpers ===============
const $ = (id) => document.getElementById(id);
const setStatus = (m) => { const el = $('status'); if (el) el.textContent = m; };
const showError = (m) => {
  const box = $('error-box'); if(!box) return;
  box.classList.remove('hidden');
  box.textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`;
  box.scrollTop = box.scrollHeight;
  console.error(m);
};
const newId = () => (crypto?.randomUUID?.() || String(Date.now()));
const isFiniteNum = (x)=>Number.isFinite(x);

// Normalise n’importe quel objet {lat, lon|lng} en {lat, lon}
function toLatLon(obj){
  if(!obj) return null;
  const lat = Number(obj.lat);
  const lon = Number(obj.lon ?? obj.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
function latlngStringLL(ll){ return `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`; }

// =============== Géodésie ===============
function haversineMeters(a,b){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
  const lat1=toRad(a.lat), lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
const distKm = (a,b)=>haversineMeters(a,b)/1000;
function isValidLatLon(lat, lon){
  return isFiniteNum(lat)&&isFiniteNum(lon) && Math.abs(lat)<=90 && Math.abs(lon)<=180 && !(lat===0&&lon===0);
}

// =============== SEC (smallest enclosing circle) ===============
function circleFrom2(a,b){
  const cx=(a.lon+b.lon)/2, cy=(a.lat+b.lat)/2, r=distKm(a,b)/2;
  return { c:{lat:cy, lon:cx}, rKm:r };
}
function circleFrom3(a,b,c){
  const ax=a.lon, ay=a.lat, bx=b.lon, by=b.lat, cx=c.lon, cy=c.lat;
  const d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
  if(Math.abs(d)<1e-12) return null;
  const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d;
  const uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d;
  const center={lon:ux, lat:uy};
  const r=Math.max(distKm(center,a),distKm(center,b),distKm(center,c));
  return { c:center, rKm:r };
}
function isIn(circle,p){ return distKm(circle.c,p)<=circle.rKm+1e-6; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
function secWelzl(P,R=[]){
  if(P.length===0||R.length===3){
    if(R.length===0) return null;
    if(R.length===1) return { c:R[0], rKm:0 };
    if(R.length===2) return circleFrom2(R[0],R[1]);
    return circleFrom3(R[0],R[1],R[2]);
  }
  const p=P.pop(); const D=secWelzl(P,R);
  if(D && isIn(D,p)) return D;
  return secWelzl(P,R.concat([p]));
}
function smallestEnclosingCircle(points){
  if(points.length===0) return null;
  const copy=points.map(p=>({lat:p.lat, lon:p.lon}));
  shuffle(copy); return secWelzl(copy,[]);
}

// =============== App state ===============
const STORAGE_NS = 'echome-acc-autonome-v22';
const STORAGE_LAST = `${STORAGE_NS}:lastProjectId`;
const projectKey = (id) => `${STORAGE_NS}:project:${id}`;

const app = {
  __BUILD__: '2025-10-25',
  map:null,
  projectId:null,

  distMaxKm: 2,             // Diamètre 2 | 10 | 20 km (rayon D/2)
  producteur: null,         // {lat, lon}
  participants: [],         // [{id, nom, lat, lon, type}]

  mode: null,               // 'producer' | 'consumer' | null

  layers:{
    producer: null,
    parts: L.layerGroup(),
    worstLine: null, worstLabel: null,
    accCircle: null,
    infoCtrl: null,

    sdisLayer: null,
    sdisOn: false
  },

  secCenter: null,          // {lat, lon}
  secRadiusKm: 0,
  _didFitOnce:false
};

// =============== Données locales ===============
let INSEE_TYPO = {};          // { INSEE: "urbaine" | "périurbaine" | "rurale" }
let CP_INDEX = {};            // { "38000":[{code, nom, lat, lon}, ...], ... }
const PATH_TYPO = 'data/insee_typo_2025.json';
const PATH_CP   = 'data/cp_communes_index.json';
const PATH_SDIS = 'data/sdis_sis.geojson';

async function loadLocalJSON(url){
  try{
    const r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }catch(e){
    console.warn(`Chargement ${url} KO:`, e); return null;
  }
}

// =============== INSEE reverse by point (autonome + API publique) ===============
async function fetchCommuneByPoint(lat, lon){
  // API publique gratuite, renvoie la commune à partir du point
  const url = `https://geo.api.gouv.fr/communes?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&fields=nom,code,centre,codeDepartement&format=json`;
  try{
    const r = await fetch(url, { cache:'no-store' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const arr = await r.json();
    return Array.isArray(arr) && arr[0] ? arr[0] : null;
  }catch(e){
    console.warn('Reverse commune KO', e); return null;
  }
}
function diameterFromTypology(typologie){
  const t=(typologie||'').toLowerCase();
  if(t.includes('urbain')) return 2;
  if(t.includes('péri') || t.includes('peri')) return 10;
  if(t.includes('rural')) return 20;
  return null;
}
function setDiameterFromInsee(codeInsee, communeName){
  const ty = INSEE_TYPO[codeInsee] || null;
  const D = diameterFromTypology(ty);
  if(D){
    app.distMaxKm=D; updateCompliance(); saveProject();
    document.querySelectorAll('#chipDiameter .chip').forEach(b=>{
      const d=Number(b.getAttribute('data-d')); const active=d===app.distMaxKm;
      b.classList.toggle('active', active); b.setAttribute('aria-pressed', active?'true':'false');
    });
    setStatus(`Commune: ${communeName||codeInsee} • Typologie: ${ty} • Diamètre = ${D} km`);
  }else{
    setStatus(`Typologie inconnue pour ${communeName||codeInsee}. Choisis 2/10/20 km.`);
  }
}

// =============== Map setup ===============
function setupMap(){
  app.map = L.map('map', { zoomControl:true }).setView([45.191, 5.684], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap'
  }).addTo(app.map);
  L.control.scale({ position:'topleft', imperial:false, maxWidth:160 }).addTo(app.map);
  app.layers.parts.addTo(app.map);

  // Tap selon mode courant
  app.map.on('click', (e)=>{
    if(app.mode === 'producer' || (!app.producteur && app.mode===null)){
      setProducer({ lat:e.latlng.lat, lon:e.latlng.lng }, { autoCommune:true });
      setStatus('Producteur défini'); return;
    }
    if(app.mode === 'consumer'){
      addParticipant({ id:newId(), nom:`Consommateur ${app.participants.length+1}`, lat:e.latlng.lat, lon:e.latlng.lng, type:'consumer' });
      setStatus('Consommateur ajouté'); return;
    }
  });

  // Appui long = ajout rapide consommateur (terrain)
  enableLongPressAddOnMap();

  // Pavé info (D / pire paire / statut)
  app.layers.infoCtrl = L.control({ position:'topleft' });
  app.layers.infoCtrl.onAdd = function(){
    const div = L.DomUtil.create('div','acc-info-box');
    div.style.cssText = 'margin:6px 0 0 6px;background:#0f1426cc;color:#fff;border:1px solid #20263d;padding:6px 8px;border-radius:8px;font-size:12px;line-height:1.3;user-select:none;min-width:210px';
    div.innerHTML = infoBoxHTML({ worstKm:null, ok:null });
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  app.layers.infoCtrl.addTo(app.map);
}

function infoBoxHTML({ worstKm, ok }){
  const r=(app.distMaxKm/2);
  const status=(ok===null)?'—':(ok?'✅ Conforme':'⚠️ Hors limite');
  const worstTxt=(worstKm===null)?'—':`${worstKm.toFixed(2)} km`;
  return `
    <div><b>Zone ACC</b></div>
    <div>Diamètre autorisé : <b>${app.distMaxKm} km</b> (rayon ${r} km)</div>
    <div>Distance max observée : <b>${worstTxt}</b></div>
    <div>${status}</div>
  `;
}
function refreshInfoBox(worstKm=null, ok=null){
  const boxes=document.getElementsByClassName('acc-info-box');
  if(boxes && boxes[0]) boxes[0].innerHTML = infoBoxHTML({ worstKm, ok });
}

function enableLongPressAddOnMap(){
  let t=null, started=false, startPt=null;
  app.map.on('touchstart',(e)=>{
    started=true;
    const t0=e.touches?.[0]; if(!t0) return;
    startPt={x:t0.clientX,y:t0.clientY};
    t=setTimeout(()=>{
      if(!started) return;
      const pt=app.map.mouseEventToLatLng({clientX:startPt.x, clientY:startPt.y, target: app.map._container});
      const nom = prompt('Nom du consommateur :', `Consommateur ${app.participants.length+1}`) || `Consommateur ${app.participants.length+1}`;
      addParticipant({ id:newId(), nom, lat:pt.lat, lon:pt.lng, type:'consumer' });
      setStatus('Consommateur ajouté (pression longue)');
    },650);
  },{passive:true});
  app.map.on('touchmove',(e)=>{
    const t1 = e.touches?.[0]; if(!t1||!startPt) return;
    if(Math.hypot(t1.clientX-startPt.x, t1.clientY-startPt.y)>12){ started=false; if(t) clearTimeout(t); }
  },{passive:true});
  app.map.on('touchend',()=>{ started=false; if(t) clearTimeout(t); });
}

// =============== Producteur & participants ===============
function setProducer({lat, lon}, opts={}){
  if(!isValidLatLon(lat,lon)) return showError('Coordonnées producteur invalides');
  app.producteur = { lat, lon };

  if(!app.layers.producer){
    app.layers.producer = L.marker([lat,lon],{
      draggable:true,
      title:'Producteur',
      icon: L.divIcon({ className:'prod-icon', html:'<div class="pin" style="width:18px;height:18px;border-radius:50%;background:#f5b841;border:2px solid #b58900"></div>', iconSize:[20,20], iconAnchor:[10,20] })
    }).addTo(app.map);

    // Drag = repositionner
    app.layers.producer.on('dragend', ()=>{
      const { lat:la, lng:lo } = app.layers.producer.getLatLng();
      setProducer({ lat:la, lon:lo }, { autoCommune:true });
    });

    // Appui long = supprimer producteur
    let t=null, pressed=false;
    app.layers.producer.on('touchstart', ()=>{
      pressed=true;
      t=setTimeout(()=>{
        if(!pressed) return;
        if(confirm('Supprimer le producteur ?')){
          clearProducer();
          setStatus('Producteur supprimé');
        }
      }, 650);
    });
    app.layers.producer.on('touchend', ()=>{ pressed=false; if(t) clearTimeout(t); });
  }else{
    app.layers.producer.setLatLng([lat,lon]);
  }

  afterModelChange();

  // Auto commune -> auto diamètre (INSEE_TYPO)
  if(opts.autoCommune){
    (async ()=>{
      const c = await fetchCommuneByPoint(lat, lon);
      if(c?.code){ setDiameterFromInsee(c.code, c.nom); }
    })();
  }
}
function clearProducer(){
  app.producteur = null;
  if(app.layers.producer){ app.map.removeLayer(app.layers.producer); app.layers.producer = null; }
  afterModelChange();
}

function bindMarkerUI(marker, p){
  const secC = app.secCenter;
  const dToProd = app.producteur ? distKm(p, app.producteur) : null;
  const dToC    = secC ? distKm(p, secC) : null;
  const html = `<div style="min-width:190px">
    <b>${p.nom||'Participant'}</b><br>${p.type||'consumer'}<br>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}<br>
    ${dToProd!==null?`<span style="font-size:12px;color:#c6c9d1">→ Prod. ${dToProd.toFixed(2)} km</span><br>`:''}
    ${dToC!==null?`<span style="font-size:12px;color:#c6c9d1">→ Centre zone ${dToC.toFixed(2)} km</span><br>`:''}
    <div style="display:flex;gap:6px;margin-top:6px">
      <button id="center-${p.id}" class="btn" style="flex:1">Centrer</button>
      <button id="del-${p.id}" class="btn danger" style="flex:1">Supprimer</button>
    </div>
  </div>`;
  marker.bindPopup(html);
  marker.on('popupopen', ()=>{
    const bDel = document.getElementById(`del-${p.id}`);
    const bCtr = document.getElementById(`center-${p.id}`);
    if(bDel) bDel.onclick = ()=> { marker.closePopup(); removeParticipant(p.id); setStatus('Participant supprimé'); };
    if(bCtr) bCtr.onclick = ()=> { marker.closePopup(); app.map.setView([p.lat,p.lon], Math.max(14, app.map.getZoom())); };
  });
  let t=null, pressed=false;
  marker.on('touchstart', ()=>{ pressed=true; t=setTimeout(()=>{ if(!pressed) return;
    if(confirm(`Supprimer "${p.nom}" ?`)){ removeParticipant(p.id); setStatus('Participant supprimé'); }
  },650); });
  marker.on('touchend', ()=>{ pressed=false; if(t) clearTimeout(t); });
}

function addParticipant(p){
  if(!isValidLatLon(p.lat,p.lon)) return showError('Coordonnées participant invalides');
  app.participants.push(p);
  afterModelChange();
}
function removeParticipant(id){
  app.participants = app.participants.filter(x=>x.id!==id);
  afterModelChange();
}
function redrawParticipants(){
  app.layers.parts.clearLayers();
  app.participants.forEach(p=>{
    const color = p.type==='sdis' ? '#ff3b30' : (p.type==='producer' ? '#f5b841' : '#4ea2ff');
    const m = L.circleMarker([p.lat,p.lon],{ radius:6, color, weight:2, fillOpacity:.8 }).addTo(app.layers.parts);
    bindMarkerUI(m, p);
  });
}

// =============== Conformité & zone ACC ===============
function worstPair(points){
  let worst={d:0,a:null,b:null};
  for(let i=0;i<points.length;i++){
    for(let j=i+1;j<points.length;j++){
      const d=distKm(points[i], points[j]); if(d>worst.d) worst={d,a:points[i],b:points[j]};
    }
  }
  return worst;
}
function clearWorstOverlay(){
  if(app.layers.worstLine){ app.map.removeLayer(app.layers.worstLine); app.layers.worstLine=null; }
  if(app.layers.worstLabel){ app.map.removeLayer(app.layers.worstLabel); app.layers.worstLabel=null; }
}
function drawWorstOverlay(w, D){
  clearWorstOverlay();
  if(!w?.a || !w?.b) return;
  const ok = w.d <= D;
  app.layers.worstLine = L.polyline([[w.a.lat,w.a.lon],[w.b.lat,w.b.lon]],{ color: ok?'#2ecc71':'#e67e22', weight:4, opacity:.9 }).addTo(app.map);
  const mid={lat:(w.a.lat+w.b.lat)/2, lon:(w.a.lon+w.b.lon)/2};
  app.layers.worstLabel = L.marker([mid.lat, mid.lon],{ icon:L.divIcon({ className:'maxpair-label', html:`${w.d.toFixed(2)} km / ≤ ${D} km` }) }).addTo(app.map);
}
function drawAccCircle(centerLike, ok){
  const c = toLatLon(centerLike);
  if(!c){ console.warn('Centre invalide pour cercle ACC'); return; }
  const rMeters = (app.distMaxKm/2)*1000;
  const color = ok?'#2ecc71':'#e67e22';
  if(!app.layers.accCircle){
    app.layers.accCircle = L.circle([c.lat,c.lon],{
      radius:rMeters, color, weight:3, opacity:1, fillOpacity:.06, fillColor:color, dashArray:'8,6'
    }).addTo(app.map);
  }else{
    app.layers.accCircle.setLatLng([c.lat,c.lon]);
    app.layers.accCircle.setRadius(rMeters);
    app.layers.accCircle.setStyle({ color, fillColor:color });
  }
}
function getAllPoints(){
  const pts = [];
  if(app.producteur) pts.push({ ...app.producteur, type:'producer' });
  app.participants.forEach(p=>pts.push(p));
  return pts;
}
function updateCompliance(){
  const pts=getAllPoints();
  const sec=smallestEnclosingCircle(pts);
  app.secCenter=sec?.c || (app.producteur || null);
  app.secRadiusKm=sec?.rKm || 0;

  let worst=null, ok=null;
  if(pts.length>=2){ worst=worstPair(pts); ok = worst.d <= app.distMaxKm; drawWorstOverlay(worst, app.distMaxKm); }
  else { clearWorstOverlay(); }

  const fallbackCenter = toLatLon(app.producteur) || toLatLon(app.map.getCenter());
  const centerLike = app.secCenter || fallbackCenter;
  const okBySEC = (app.secRadiusKm*2) <= app.distMaxKm; // diamètre SEC ≤ D
  drawAccCircle(centerLike, okBySEC);

  refreshInfoBox(worst?.d ?? null, ok);

  const badge=$('badgeCompliance'); if(badge) badge.textContent=(ok===null)?'—':(ok?'✔︎':'✖︎');

  if(!app._didFitOnce && (pts.length>=1 || app.layers.accCircle)){ fitToProject(); app._didFitOnce=true; }

  setStatus(`Diamètre = ${app.distMaxKm} km • Max paire = ${worst?.d?.toFixed ? worst.d.toFixed(2) : '—'} km`);
}
function fitToProject(){
  const layers=[]; if(app.layers.accCircle) layers.push(app.layers.accCircle);
  if(app.layers.parts) layers.push(app.layers.parts);
  if(app.layers.producer) layers.push(app.layers.producer);
  if(layers.length===0) return;
  const group=L.featureGroup(layers); const b=group.getBounds();
  if(b.isValid()) app.map.fitBounds(b.pad(0.25),{ maxZoom:15 });
}

// =============== CP -> communes (jeu local) ===============
function wirePostalLookup(){
  const input=$('cpInput'), btn=$('btnSearchCP'), list=$('cpResults');
  if(!input||!btn||!list) return;
  btn.addEventListener('click', ()=>{
    const cp=(input.value||'').trim();
    if(!/^\d{5}$/.test(cp)) return showError('Code postal à 5 chiffres requis');
    const communes = CP_INDEX[cp] || [];
    if(communes.length===0){ list.innerHTML='<li style="opacity:.7">Aucune commune (jeu local)</li>'; return; }
    list.innerHTML='';
    communes.forEach(c=>{
      const li=document.createElement('li'); li.className='cp-item';
      li.style.cssText='padding:8px 10px;border:1px solid #20263d;border-radius:10px;margin-bottom:6px;cursor:pointer;background:#141a31';
      li.textContent=`${c.nom} — INSEE ${c.code}`;
      li.onclick=()=>{
        if(isFiniteNum(c.lat)&&isFiniteNum(c.lon)) app.map.setView([c.lat,c.lon], Math.max(12, app.map.getZoom()));
        setDiameterFromInsee(c.code, c.nom);
      };
      list.appendChild(li);
    });
  });
}

// =============== SDIS/SIS (couche locale) ===============
async function ensureSdisLayerLoaded(){
  if(app.layers.sdisLayer) return true;
  const gj = await loadLocalJSON(PATH_SDIS);
  if(!gj){ showError('SDIS/SIS indisponibles (data/sdis_sis.geojson manquant)'); return false; }
  app.layers.sdisLayer = L.geoJSON(gj, {
    pointToLayer: (feat, latlng)=> L.circleMarker(latlng,{ radius:5, color:'#ff3b30', weight:2, fillOpacity:.85 }),
    onEachFeature: (feat, layer)=>{
      const props=feat.properties||{};
      const name = props.nom || props.NOM || 'SDIS/SIS';
      const ll = toLatLon(layer.getLatLng());
      layer.bindPopup(`<b>${name}</b><br>${latlngStringLL(ll)}`);
      // Double-tap: ajouter comme participant SDIS + forcer D=20 km
      layer.on('dblclick', ()=>{
        addParticipant({ id:newId(), nom:name, lat:ll.lat, lon:ll.lon, type:'sdis' });
        app.distMaxKm = 20; updateCompliance(); saveProject();
        document.querySelectorAll('#chipDiameter .chip').forEach(b=>{
          const d=Number(b.getAttribute('data-d')); const active=d===20;
          b.classList.toggle('active', active); b.setAttribute('aria-pressed', active?'true':'false');
        });
        setStatus('SDIS ajouté (diamètre = 20 km)');
      });
    }
  });
  return true;
}
async function toggleSDIS(on){
  app.layers.sdisOn = on;
  if(on){
    const ok = await ensureSdisLayerLoaded();
    if(ok) app.layers.sdisLayer.addTo(app.map);
    setStatus('SDIS/SIS affichés');
  }else{
    if(app.layers.sdisLayer) app.map.removeLayer(app.layers.sdisLayer);
    setStatus('SDIS/SIS masqués');
  }
}

// =============== UI wiring ===============
function wireModeButtons(){
  const bProd=$('btnModeProducer'), bCons=$('btnModeConsumer'), bSdis=$('btnToggleSDIS');
  if(bProd){ bProd.onclick=()=>{ app.mode='producer'; setStatus('Mode Producteur (tap pour poser)'); }; }
  if(bCons){ bCons.onclick=()=>{ app.mode='consumer'; setStatus('Mode Consommateur (tap pour poser)'); }; }
  if(bSdis){ bSdis.onclick=async ()=>{
    const on = !app.layers.sdisOn; await toggleSDIS(on);
    bSdis.setAttribute('aria-pressed', on?'true':'false');
    bSdis.classList.toggle('active', on);
  }; }
}

function wireDiameterChips(){
  document.querySelectorAll('#chipDiameter .chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#chipDiameter .chip').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
      app.distMaxKm = Number(btn.getAttribute('data-d')) || 2;
      onProjectChanged();
      setStatus(`Diamètre manuel = ${app.distMaxKm} km`);
    });
  });
}

// =============== Persistence ===============
function getPayload(){
  return { __v:7, savedAt:new Date().toISOString(), state:{
    distMaxKm: app.distMaxKm,
    producteur: app.producteur,
    participants: app.participants
  }};
}
function saveProject(){
  try{
    if(!app.projectId) app.projectId=newId();
    localStorage.setItem(projectKey(app.projectId), JSON.stringify(getPayload()));
    localStorage.setItem(STORAGE_LAST, app.projectId);
    const url=new URL(location.href); url.searchParams.set('project', app.projectId); history.replaceState(null,'',url.toString());
  }catch(e){ showError(`Sauvegarde KO: ${e.message}`); }
}
function loadProjectById(id){
  try{ const raw=localStorage.getItem(projectKey(id)); return raw?JSON.parse(raw):null; }
  catch(e){ showError('Projet corrompu'); return null; }
}
function applyPayload(payload){
  const s=payload?.state||{};
  app.distMaxKm = s.distMaxKm ?? 2;
  app.producteur = s.producteur || null;
  app.participants = Array.isArray(s.participants)?s.participants:[];
  document.querySelectorAll('#chipDiameter .chip').forEach(b=>{
    const d=Number(b.getAttribute('data-d')); const active=d===app.distMaxKm;
    b.classList.toggle('active', active); b.setAttribute('aria-pressed', active?'true':'false');
  });
  afterModelChange();
}

// =============== Reactions ===============
function afterModelChange(){
  redrawParticipants();
  updateCompliance();
  saveProject();
}
function onProjectChanged(){
  updateCompliance();
  saveProject();
}

// =============== Bootstrap ===============
(async function init(){
  try{
    setStatus('Initialisation…');
    setupMap();

    const [typo, cpIndex] = await Promise.all([ loadLocalJSON(PATH_TYPO), loadLocalJSON(PATH_CP) ]);
    if(typo) INSEE_TYPO = typo; else console.warn('INSEE_TYPO manquant (data/insee_typo_2025.json)');
    if(cpIndex) CP_INDEX = cpIndex; else console.warn('CP_INDEX manquant (data/cp_communes_index.json)');

    // Cercle initial (D/2) même sans points (centre = centre carte normalisé)
    updateCompliance();

    wireModeButtons();
    wireDiameterChips();
    wirePostalLookup();

    const fromUrl = new URLSearchParams(location.search).get('project') || localStorage.getItem(STORAGE_LAST);
    if(fromUrl){
      const payload = loadProjectById(fromUrl);
      if(payload){ app.projectId=fromUrl; applyPayload(payload); setStatus('Projet chargé'); return; }
    }
    app.projectId=newId(); saveProject();
    setStatus('Prêt');
  }catch(e){
    showError(`Init KO: ${e.message}`); setStatus('Erreur (voir détails)');
  }
})();