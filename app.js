/* ==========================================================
   Echome ACC – v27.1 Light
   UI épurée claire + boutons corrigés (clics/gestes)
   4 actions : Producteur / Consommateur / Géolocaliser / SDIS
   ACC = SEC (centre libre) • D 2/10/20 • Conformité = pire paire ≤ D
   ========================================================== */

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);
const setStatus = m => { const el=$('status'); if(el) el.textContent=m; };
const logErr = m => { const e=$('error-box'); if(!e) return; e.classList.remove('hidden'); e.textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; e.scrollTop=e.scrollHeight; };
const uid = () => (crypto?.randomUUID?.() || String(Date.now()));
const isNum = x => Number.isFinite(x);

/* ---------- Géodésie + SEC ---------- */
function hMeters(a,b){ const R=6371000, rad=d=>d*Math.PI/180, dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon), la1=rad(a.lat), la2=rad(b.lat); const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(h)); }
const dKm = (a,b)=>hMeters(a,b)/1000;
function c2(a,b){ return { c:{lat:(a.lat+b.lat)/2, lon:(a.lon+b.lon)/2}, rKm:dKm(a,b)/2 }; }
function c3(a,b,c){ const ax=a.lon,ay=a.lat,bx=b.lon,by=b.lat,cx=c.lon,cy=c.lat; const d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by)); if(Math.abs(d)<1e-12) return null; const ux=((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d; const uy=((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d; const o={lon:ux,lat:uy}; const r=Math.max(dKm(o,a),dKm(o,b),dKm(o,c)); return { c:o, rKm:r }; }
function inC(c,p){ return dKm(c.c,p)<=c.rKm+1e-6; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
function secWelzl(P,R=[]){ if(P.length===0||R.length===3){ if(R.length===0) return null; if(R.length===1) return {c:R[0],rKm:0}; if(R.length===2) return c2(R[0],R[1]); return c3(R[0],R[1],R[2]); } const p=P.pop(); const D=secWelzl(P,R); if(D&&inC(D,p)) return D; return secWelzl(P,R.concat([p])); }
function smallestCircle(pts){ if(!pts.length) return null; const cp=pts.map(p=>({lat:p.lat,lon:p.lon})); shuffle(cp); return secWelzl(cp,[]); }

/* ---------- App state ---------- */
const app = {
  map:null,
  mode:null,                 // 'prod' | 'cons' | null
  D:2,                       // Diamètre autorisé (km)
  producer:null,             // {lat, lon}
  parts:[],                  // participants [{id,nom,lat,lon,type}]
  layers:{ group:L.layerGroup(), prod:null, circle:null, worstLine:null, worstLabel:null, sdis:null, sdisOn:false, info:null }
};

/* ---------- Carte ---------- */
function setupMap(){
  app.map = L.map('map',{ zoomControl:true }).setView([45.19,5.68], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(app.map);
  L.control.scale({ position:'topleft', imperial:false, maxWidth:160 }).addTo(app.map);
  app.layers.group.addTo(app.map);

  // Info box
  app.layers.info = L.control({position:'topleft'});
  app.layers.info.onAdd = function(){
    const d=L.DomUtil.create('div','acc-info');
    d.innerHTML = infoHTML(null,null);
    // évite que la carte capte les clics
    L.DomEvent.disableClickPropagation(d);
    L.DomEvent.disableScrollPropagation(d);
    return d;
  };
  app.layers.info.addTo(app.map);

  // Tap carte selon mode
  app.map.on('click', (e)=>{
    if(app.mode==='prod'){
      setProducer(e.latlng.lat, e.latlng.lng);
      setStatus('Producteur défini / déplacé');
    }else if(app.mode==='cons'){
      addConsumer(e.latlng.lat, e.latlng.lng, `Consommateur ${app.parts.length+1}`);
      setStatus('Consommateur ajouté');
    }
  });

  // Long-press carte => ajouter consommateur
  enableLongPressToAdd();

  redrawAll();
}

function infoHTML(maxPair, ok){
  const r = (app.D/2);
  const badge = ok==null?'—':(ok?'✅ Conforme':'⚠️ Hors limite');
  const dMax = (maxPair==null)?'—':`${maxPair.toFixed(2)} km`;
  return `<b>ACC</b> • D <b>${app.D} km</b> (R ${r} km) • max paire <b>${dMax}</b> • ${badge}`;
}

/* ---------- Actions UI (boutons) ---------- */
function shieldUI(){
  const top = document.querySelector('.topbar');
  const dock = document.querySelector('.dock');
  [top, dock].forEach(el=>{
    if(!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
    el.addEventListener('click', e=>{ e.stopPropagation(); }, { passive:false });
    el.addEventListener('touchstart', e=>{ e.stopPropagation(); }, { passive:false });
  });
}

function wireDock(){
  const bProd=$('btnProd'), bCons=$('btnCons'), bGeo=$('btnGeo'), bSDIS=$('btnSDIS');
  const chips=$('chipDiameter');

  const setMode = (m)=>{
    app.mode = (app.mode===m? null : m);
    if(bProd) bProd.setAttribute('aria-pressed', app.mode==='prod'?'true':'false');
    if(bCons) bCons.setAttribute('aria-pressed', app.mode==='cons'?'true':'false');
    setStatus(app.mode===null?'Navigation':(app.mode==='prod'?'Mode Producteur':'Mode Consommateur'));
  };

  if(bProd){
    bProd.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); setMode('prod'); }, { passive:false });
    bProd.addEventListener('touchstart', (e)=>{ e.stopPropagation(); }, { passive:false });
  }
  if(bCons){
    bCons.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); setMode('cons'); }, { passive:false });
    bCons.addEventListener('touchstart', (e)=>{ e.stopPropagation(); }, { passive:false });
  }
  if(bGeo){
    bGeo.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); geolocate(); }, { passive:false });
    bGeo.addEventListener('touchstart', (e)=>{ e.stopPropagation(); }, { passive:false });
  }
  if(bSDIS){
    bSDIS.addEventListener('click', async (e)=>{
      e.preventDefault(); e.stopPropagation();
      const on = !app.layers.sdisOn;
      await toggleSDIS(on);
      bSDIS.setAttribute('aria-pressed', on?'true':'false');
    }, { passive:false });
    bSDIS.addEventListener('touchstart', (e)=>{ e.stopPropagation(); }, { passive:false });
  }

  // Chips diamètre
  if(chips){
    L.DomEvent.disableClickPropagation(chips);
    L.DomEvent.disableScrollPropagation(chips);
    chips.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      const btn = e.target.closest('.chip[data-d]');
      if(!btn) return;
      const D = Number(btn.getAttribute('data-d'))||2;
      app.D = D;
      chips.querySelectorAll('.chip').forEach(c=>{
        const on = Number(c.getAttribute('data-d'))===D;
        c.classList.toggle('active', on);
        c.setAttribute('aria-pressed', on?'true':'false');
      });
      recompute();
      setStatus(`Diamètre = ${D} km`);
    }, { passive:false });
  }

  // Mode par défaut : navigation
  app.mode = null;
}

/* ---------- Producteur / Consommateurs ---------- */
function setProducer(lat, lon){
  app.producer = {lat, lon};
  if(!app.layers.prod){
    app.layers.prod = L.marker([lat,lon],{
      draggable:true,
      icon:L.divIcon({className:'picon', html:'<div style="width:18px;height:18px;border-radius:50%;background:#ffd24a;border:2px solid #c9a300"></div>', iconSize:[20,20], iconAnchor:[10,20]})
    }).addTo(app.map);

    // drag -> recalc
    app.layers.prod.on('dragend', ()=>{
      const { lat:la, lng:lo } = app.layers.prod.getLatLng();
      setProducer(la, lo);
      setStatus('Producteur déplacé');
    });

    // long-press / dbl / contextmenu -> supprimer
    let t=null,pressed=false;
    app.layers.prod.on('touchstart',()=>{ pressed=true; t=setTimeout(()=>{ if(!pressed) return; if(confirm('Supprimer le producteur ?')){ clearProducer(); } },650); });
    app.layers.prod.on('touchend', ()=>{ pressed=false; if(t) clearTimeout(t); });
    app.layers.prod.on('dblclick', ()=>{ if(confirm('Supprimer le producteur ?')) clearProducer(); });
    app.layers.prod.on('contextmenu', ()=>{ if(confirm('Supprimer le producteur ?')) clearProducer(); });
  }else{
    app.layers.prod.setLatLng([lat,lon]);
  }
  recompute();
}

function clearProducer(){
  app.producer=null;
  if(app.layers.prod){ app.map.removeLayer(app.layers.prod); app.layers.prod=null; }
  recompute();
  setStatus('Producteur supprimé');
}

function addConsumer(lat, lon, nom){
  const p={ id:uid(), nom, lat, lon, type:'consumer' };
  const m=L.circleMarker([lat,lon],{ radius:6, color:'#2d6aff', weight:2, fillOpacity:.85 })
    .addTo(app.layers.group);

  // popup + suppression
  const html = `<b>${nom}</b><br>${lat.toFixed(5)}, ${lon.toFixed(5)}<br>
    <div style="margin-top:6px;display:flex;gap:6px">
      <button id="c-${p.id}" class="btn">Centrer</button>
      <button id="d-${p.id}" class="btn danger">Supprimer</button>
    </div>`;
  m.bindPopup(html);
  m.on('popupopen', ()=>{
    const bC=$(`c-${p.id}`), bD=$(`d-${p.id}`);
    if(bC) bC.onclick=()=>{ m.closePopup(); app.map.setView([lat,lon], Math.max(14, app.map.getZoom())); };
    if(bD) bD.onclick=()=>{ m.closePopup(); removeConsumer(p.id, m); };
  });

  // long-press direct pour supprim
  let t=null, pressed=false;
  m.on('touchstart', ()=>{ pressed=true; t=setTimeout(()=>{ if(!pressed) return; if(confirm(`Supprimer "${nom}" ?`)) removeConsumer(p.id, m); },650); });
  m.on('touchend', ()=>{ pressed=false; if(t) clearTimeout(t); });

  app.parts.push(p);
  recompute();
}

function removeConsumer(id, marker){
  app.parts = app.parts.filter(x=>x.id!==id);
  if(marker) app.layers.group.removeLayer(marker);
  recompute();
}

/* ---------- Gestes ---------- */
function enableLongPressToAdd(){
  let t=null, started=false, start=null;
  app.map.on('touchstart',(e)=>{
    started=true; const t0=e.touches?.[0]; if(!t0) return; start={x:t0.clientX,y:t0.clientY};
    t=setTimeout(()=>{
      if(!started) return;
      const p=app.map.mouseEventToLatLng({clientX:start.x, clientY:start.y, target:app.map._container});
      addConsumer(p.lat, p.lng, `Consommateur ${app.parts.length+1}`);
      setStatus('Ajout (pression longue)');
    },650);
  }, {passive:true});
  app.map.on('touchmove',(e)=>{
    const t1=e.touches?.[0]; if(!t1||!start) return;
    if(Math.hypot(t1.clientX-start.x, t1.clientY-start.y)>12){ started=false; if(t) clearTimeout(t); }
  }, {passive:true});
  app.map.on('touchend',()=>{ started=false; if(t) clearTimeout(t); });
}

/* ---------- Compliance + cercle ACC (centre libre) ---------- */
function recompute(){
  // Nettoie overlays participants
  app.layers.group.clearLayers();
  // Redessine participants
  app.parts.forEach(p=>{
    const m=L.circleMarker([p.lat,p.lon],{ radius:6, color:'#2d6aff', weight:2, fillOpacity:.85 }).addTo(app.layers.group);
    const html = `<b>${p.nom}</b><br>${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}<br>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button id="c-${p.id}" class="btn">Centrer</button>
        <button id="d-${p.id}" class="btn danger">Supprimer</button>
      </div>`;
    m.bindPopup(html);
    m.on('popupopen', ()=>{
      const bC=$(`c-${p.id}`), bD=$(`d-${p.id}`);
      if(bC) bC.onclick=()=>{ m.closePopup(); app.map.setView([p.lat,p.lon], Math.max(14, app.map.getZoom())); };
      if(bD) bD.onclick=()=>{ m.closePopup(); removeConsumer(p.id, m); };
    });
    let t=null, pressed=false;
    m.on('touchstart', ()=>{ pressed=true; t=setTimeout(()=>{ if(!pressed) return; if(confirm(`Supprimer "${p.nom}" ?`)) removeConsumer(p.id, m); },650); });
    m.on('touchend', ()=>{ pressed=false; if(t) clearTimeout(t); });
  });

  // Producteur
  if(app.producer){
    if(!app.layers.prod){
      app.layers.prod = L.marker([app.producer.lat,app.producer.lon],{
        draggable:true,
        icon:L.divIcon({className:'picon', html:'<div style="width:18px;height:18px;border-radius:50%;background:#ffd24a;border:2px solid #c9a300"></div>', iconSize:[20,20], iconAnchor:[10,20]})
      }).addTo(app.map);
    }else{
      app.layers.prod.setLatLng([app.producer.lat,app.producer.lon]);
    }
  }

  // Points pour calcul
  const pts=[]; if(app.producer) pts.push(app.producer); app.parts.forEach(p=>pts.push({lat:p.lat,lon:p.lon}));

  // Pire paire & SEC
  const worst = worstPair(pts);
  const ok = worst ? (worst.d <= app.D) : null;
  drawWorst(worst);
  drawCircle(pts, ok);

  $('badge').textContent = ok==null ? '—' : (ok ? '✔︎' : '✖︎');
  setInfo(worst?.d ?? null, ok);
}

function worstPair(pts){
  if(pts.length<2) return null;
  let w={d:0,a:null,b:null};
  for(let i=0;i<pts.length;i++){
    for(let j=i+1;j<pts.length;j++){
      const d=dKm(pts[i],pts[j]); if(d>w.d) w={d, a:pts[i], b:pts[j]};
    }
  }
  return w;
}
function drawWorst(w){
  if(app.layers.worstLine){ app.map.removeLayer(app.layers.worstLine); app.layers.worstLine=null; }
  if(app.layers.worstLabel){ app.map.removeLayer(app.layers.worstLabel); app.layers.worstLabel=null; }
  if(!w) return;
  const ok = w.d <= app.D;
  app.layers.worstLine = L.polyline([[w.a.lat,w.a.lon],[w.b.lat,w.b.lon]], { color: ok?'#1aa255':'#d9822b', weight:4, opacity:.9 }).addTo(app.map);
  const mid={lat:(w.a.lat+w.b.lat)/2, lon:(w.a.lon+w.b.lon)/2};
  app.layers.worstLabel = L.marker([mid.lat, mid.lon], { icon: L.divIcon({ className:'maxpair-label', html:`${w.d.toFixed(2)} km / ≤ ${app.D} km` }) }).addTo(app.map);
}
function drawCircle(pts, ok){
  const sec = smallestCircle(pts);
  const center = sec?.c || (app.producer || app.map.getCenter());
  const rMeters = (app.D/2)*1000;
  const color = ok ? '#1aa255' : '#d9822b';
  if(!app.layers.circle){
    app.layers.circle = L.circle([center.lat,center.lon],{
      radius:rMeters, color, weight:3, opacity:1, fillOpacity:.06, fillColor:color, dashArray:'8,6'
    }).addTo(app.map);
  }else{
    app.layers.circle.setLatLng([center.lat,center.lon]);
    app.layers.circle.setRadius(rMeters);
    app.layers.circle.setStyle({ color, fillColor:color });
  }
}
function setInfo(maxPair, ok){
  const c=document.querySelector('.acc-info');
  if(c) c.innerHTML = infoHTML(maxPair, ok);
}

/* ---------- Géolocalisation ---------- */
function geolocate(){
  if(!navigator.geolocation){ setStatus("Géolocalisation indisponible"); return; }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const { latitude, longitude } = pos.coords;
      app.map.setView([latitude, longitude], 15);
      setStatus('Position localisée');
    },
    (err)=>{ logErr(`Géoloc KO: ${err.message}`); setStatus('Géoloc KO'); },
    { enableHighAccuracy:true, timeout:8000, maximumAge:0 }
  );
}

/* ---------- SDIS / SIS ---------- */
async function toggleSDIS(on){
  app.layers.sdisOn = on;
  if(on){
    if(!app.layers.sdis){
      try{
        const r = await fetch('data/sdis_sis.geojson', { cache:'no-store' });
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const gj = await r.json();
        app.layers.sdis = L.geoJSON(gj, {
          pointToLayer:(feat,latlng)=>L.circleMarker(latlng,{radius:5,color:'#d93025',weight:2,fillOpacity:.9}),
          onEachFeature:(feat,layer)=>{
            const name = (feat.properties && (feat.properties.nom||feat.properties.NOM)) || 'SDIS/SIS';
            let ll=null;
            if(typeof layer.getLatLng==='function'){ const raw=layer.getLatLng(); ll={lat:Number(raw.lat),lon:Number(raw.lng)}; }
            if(!ll && feat.geometry && feat.geometry.type==='Point'){ const [x,y]=feat.geometry.coordinates; ll={lat:y,lon:x}; }
            layer.bindPopup(ll? `<b>${name}</b><br>${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}` : `<b>${name}</b>`);
            layer.on('dblclick', ()=>{
              if(!ll) return;
              addConsumer(ll.lat, ll.lon, name);
              app.D=20; document.querySelectorAll('#chipDiameter .chip').forEach(c=>{
                const on = Number(c.getAttribute('data-d'))===20; c.classList.toggle('active',on); c.setAttribute('aria-pressed',on?'true':'false');
              });
              recompute();
              setStatus('SDIS ajouté (D=20 km)');
            });
          }
        });
      }catch(e){ logErr(`SDIS chargement KO: ${e.message}`); return; }
    }
    app.layers.sdis.addTo(app.map);
    setStatus('SDIS affichés');
  }else{
    if(app.layers.sdis) app.map.removeLayer(app.layers.sdis);
    setStatus('SDIS masqués');
  }
}

/* ---------- Init ---------- */
(function init(){
  setupMap();
  shieldUI();
  wireDock();

  // Sync chips init
  document.querySelectorAll('#chipDiameter .chip').forEach(c=>{
    const on = Number(c.getAttribute('data-d'))===app.D;
    c.classList.toggle('active', on); c.setAttribute('aria-pressed', on?'true':'false');
  });

  // Cercle initial (même sans points)
  recompute();
  setStatus('Prêt');
})();