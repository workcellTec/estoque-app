// ambilight.js — glow dinâmico que segue o tema do app

// ============================================================


// ✨ AMBILIGHT ENGINE — segue o tema e cor do app
// ============================================================
(function initAmbilight() {
    let sr = 239, sg = 83, sb = 80;
    function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
    function altProgress(e, d) { const c=e%(d*2); const r=c<d?c/d:2-c/d; return easeInOut(r); }
    function clamp(v,mn,mx){ return Math.min(mx,Math.max(mn,v)); }
    function getPrimaryRGB() {
        const s=getComputedStyle(document.body);
        const rgb=s.getPropertyValue('--primary-color-rgb').trim();
        if(rgb){const p=rgb.split(',').map(v=>parseInt(v.trim()));if(p.length===3&&!p.some(isNaN))return{r:p[0],g:p[1],b:p[2]};}
        const hex=s.getPropertyValue('--primary-color').trim().replace('#','');
        if(hex.length===6)return{r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)};
        return{r:239,g:83,b:80};
    }
    function isLight(){ return document.body.dataset.theme==='light'; }
    const t0=performance.now(); let lmu=0;
    function tick(now){
        const sec=(now-t0)/1000;
        const p1=altProgress(sec,12),p2=altProgress(sec,15);
        const i1=clamp(1-p1*.7,.1,1),i2=clamp(p2*.5,0,.6),tot=i1+i2||.001;
        const C=getPrimaryRGB(),C2={r:Math.round(C.r*.5),g:Math.round(C.g*.4),b:Math.min(255,Math.round(C.b*.9+80))};
        const tr=(C.r*i1+C2.r*i2)/tot,tg=(C.g*i1+C2.g*i2)/tot,tb=(C.b*i1+C2.b*i2)/tot;
        sr+=(tr-sr)*.05;sg+=(tg-sg)*.05;sb+=(tb-sb)*.05;
        const r=Math.round(sr),g=Math.round(sg),b=Math.round(sb);
        const light=isLight(),ga=light?.35:.8,gs=light?8:16;
        const bell=document.getElementById('notification-bell');
        const aw=document.querySelector('.avatar-button-wrapper');
        if(bell){bell.style.boxShadow=`0 0 ${gs}px rgba(${r},${g},${b},${ga})`;bell.style.borderColor=`rgba(${r},${g},${b},${(ga*.8).toFixed(2)})`;}
        if(aw){aw.style.filter=`drop-shadow(0 0 ${gs*.6}px rgba(${r},${g},${b},${ga}))`;}
        if(now-lmu>100){
            const m=document.getElementById('status-bar-color');
            if(m){const f=light?[Math.round(255-(255-r)*.15),Math.round(255-(255-g)*.15),Math.round(255-(255-b)*.15)]:[Math.round(r*.25),Math.round(g*.25),Math.round(b*.25)];m.setAttribute('content','#'+f.map(v=>v.toString(16).padStart(2,'0')).join(''));}
            lmu=now;
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
})();
