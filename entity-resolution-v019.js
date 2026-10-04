(()=>{
'use strict';
try{
  const ER_VERSION='ER-1.0';
  const APP_VERSION_V019='0.19.0-PWA';
  const CITY_ALIASES={
    'mumtan':'Multan','multan':'Multan','vehari':'Vehari','burewala':'Burewala',
    'mian channu':'Mian Channu','mian chanu':'Mian Channu','khanewal':'Khanewal',
    'makhdoompur':'Makhdoompur','makhdoom pur':'Makhdoompur',
    'chichawatni':'Chichawatni','chicha watni':'Chichawatni','chechawtni':'Chichawatni','chechawatni':'Chichawatni',
    'hasilpur':'Hasilpur','sahiwal':'Sahiwal','lahore':'Lahore','karachi':'Karachi'
  };

  const CATALOG=[
    {entityId:'ENT-ATL-103414',sourceId:'OUT-ebbbc4f1-d890-4882-9fde-91cf01d95932',sourceEntityId:'SRC-ATL-103414',type:'DISTRIBUTOR',name:'Auto Center',mobile:'03007879093',city:'Mian Channu',code:'103414',verified:true,aliases:['Auto center']},
    {entityId:'ENT-ATL-103540',sourceId:'OUT-26d21853-65ee-4745-a0e8-921ad86dcb90',sourceEntityId:'SRC-ATL-103540',type:'DISTRIBUTOR',name:'AR Lube Shop',mobile:'03007592599',city:'Burewala',code:'103540',verified:true,aliases:['Ar Lube shop','AR Lube shop']},
    {entityId:'ENT-ATL-103389',sourceId:'',sourceEntityId:'SRC-ATL-103389',type:'DISTRIBUTOR',name:'Hashir Oil Traders',mobile:'03007370473',city:'Multan',code:'103389',verified:true,aliases:['Hashir oil trader']},
    {entityId:'ENT-SRC-3008010238',sourceId:'',sourceEntityId:'SRC-OBS-3008010238',type:'WHOLESALER',name:'Al Majeed Lube Shop',mobile:'03008010238',city:'Burewala',verified:false,aliases:['Al mjeed Lube shop']},
    {entityId:'ENT-SRC-3005231544',sourceId:'',sourceEntityId:'SRC-OBS-3005231544',type:'DISTRIBUTOR',name:'Mughal Autos',mobile:'03005231544',city:'Khanewal',verified:false,aliases:[]},
    {entityId:'ENT-SRC-3007311449',sourceId:'',sourceEntityId:'SRC-OBS-3007311449',type:'DISTRIBUTOR',name:'Servo',mobile:'03007311449',city:'Multan',verified:false,aliases:[]},
    {entityId:'ENT-SRC-3040712389',sourceId:'',sourceEntityId:'SRC-OBS-3040712389',type:'DISTRIBUTOR',name:'Razaq Marketing',mobile:'03040712389',city:'Khanewal',verified:false,aliases:[]},
    {entityId:'ENT-SRC-3438664787',sourceId:'',sourceEntityId:'SRC-OBS-3438664787',type:'DISTRIBUTOR',name:'Al Raziq',mobile:'03438664787',city:'Khanewal',verified:false,aliases:[]},
    {entityId:'ENT-SRC-3002202741',sourceId:'',sourceEntityId:'SRC-OBS-3002202741',type:'DISTRIBUTOR',name:'Naeem Battery',mobile:'03002202741',city:'Hasilpur',verified:false,aliases:[]}
  ];

  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const mobile10=v=>{
    const m=normalizeMobile(v||'');
    return m && /^03\d{9}$/.test(m) ? m : '';
  };
  const canonCity=v=>CITY_ALIASES[norm(v)]||String(v||'').trim();
  const namesOf=e=>[e.name,...(e.aliases||[])].map(norm);
  const bigrams=s=>{s=norm(s);const a=[];for(let i=0;i<s.length-1;i++)a.push(s.slice(i,i+2));return a};
  const similarity=(a,b)=>{
    a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 1;
    const A=bigrams(a),B=bigrams(b);if(!A.length||!B.length)return 0;
    const used=new Array(B.length).fill(false);let hit=0;
    for(const x of A){const j=B.findIndex((y,i)=>!used[i]&&y===x);if(j>=0){used[j]=true;hit++}}
    return (2*hit)/(A.length+B.length);
  };

  function candidateList(s){
    const type=String(s.sourceType||'').toUpperCase();
    const city=canonCity(s.sourceCity||'');
    const mob=mobile10(s.sourceMobile||'');
    const name=String(s.sourceName||'').trim();
    let rows=CATALOG.filter(x=>!type||x.type===type);
    if(mob){
      const exact=rows.filter(x=>mobile10(x.mobile)===mob);
      if(exact.length)return exact.map(x=>({x,score:1,rule:'EXACT_MOBILE'}));
    }
    rows=rows.map(x=>{
      const cityOk=!city||norm(x.city)===norm(city);
      const nameScore=Math.max(...namesOf(x).map(n=>similarity(name,n)));
      return {x,score:(cityOk?0.25:0)+nameScore*.75,rule:cityOk?'NAME_CITY':'NAME'};
    }).filter(r=>r.score>=0.54).sort((a,b)=>b.score-a.score);
    return rows.slice(0,4);
  }

  function applyCanonical(s,e,rule){
    s.sourceName=e.name;
    s.sourceCity=e.city;
    if(e.mobile)s.sourceMobile=e.mobile;
    if(e.code)s.sourceTelecode=e.code;
    s.sourceId=e.sourceId||'';
    s.sourceEntityId=e.sourceEntityId||'';
    s.canonicalEntityId=e.entityId||'';
    s.resolutionRule=rule;
    s.resolutionStatus=e.verified?'CANONICAL_MATCH':'OBSERVED_MOBILE_MATCH';
  }

  function resolveSource(s,{auto=true}={}){
    s.sourceCity=canonCity(s.sourceCity||'');
    const c=candidateList(s);
    const exactMobile=c.length===1&&c[0].rule==='EXACT_MOBILE';
    const exactVerified=c.length===1&&c[0].x.verified&&c[0].score>=.99;
    if(auto&&(exactMobile||exactVerified))applyCanonical(s,c[0].x,c[0].rule);
    else if(!c.length){
      s.sourceId='';s.sourceEntityId='';s.canonicalEntityId='';s.resolutionRule='';s.resolutionStatus='UNRESOLVED';
    }
    return c;
  }

  function noteText(s){
    const c=candidateList(s);
    if(s.canonicalEntityId){
      const e=CATALOG.find(x=>x.entityId===s.canonicalEntityId);
      return e?'✓ Matched: '+e.name+' · '+e.city+(e.verified?' · verified':' · mobile-backed') : '✓ Canonical source matched';
    }
    if(!c.length)return 'New/unresolved source — original entry will be preserved for review.';
    if(c.length===1)return 'Possible existing source: '+c[0].x.name+' · '+c[0].x.city+'. Add/confirm mobile to match safely.';
    return 'Similar sources found: '+c.map(r=>r.x.name+' ('+r.x.city+')').join(' / ')+'. Mobile is required to distinguish them safely.';
  }

  const oldSourceCard=sourceCard;
  sourceCard=function(key,s,i,total){
    const html=oldSourceCard(key,s,i,total);
    return html.replace('<p class="error" data-err="'+key+'-'+i+'"></p>',
      '<div class="hint" data-match-note="'+key+'-'+i+'">'+esc(noteText(s))+'</div><p class="error" data-err="'+key+'-'+i+'"></p>');
  };

  const oldRenderBrands=renderBrands;
  renderBrands=function(){
    oldRenderBrands();
    document.querySelectorAll('[data-sfield]').forEach(el=>{
      const prev=el.oninput;
      el.oninput=()=>{
        if(prev)prev();
        const b=state.brands.get(el.dataset.sbrand),s=b&&b.sources[+el.dataset.idx];
        if(!s)return;
        if(el.dataset.sfield==='sourceCity')s.sourceCity=canonCity(el.value);
        if(el.dataset.sfield==='sourceMobile')s.sourceMobile=normalizeMobile(el.value);
        resolveSource(s,{auto:el.dataset.sfield==='sourceMobile'});
        const note=document.querySelector('[data-match-note="'+el.dataset.sbrand+'-'+el.dataset.idx+'"]');
        if(note)note.textContent=noteText(s);
      };
      el.onblur=()=>{
        const b=state.brands.get(el.dataset.sbrand),s=b&&b.sources[+el.dataset.idx];
        if(!s)return;
        if(el.dataset.sfield==='sourceCity')s.sourceCity=canonCity(el.value);
        if(el.dataset.sfield==='sourceMobile')s.sourceMobile=normalizeMobile(el.value);
        resolveSource(s,{auto:true});
        renderBrands();
      };
    });
  };

  const oldValidate=validate;
  validate=function(n){
    if(!oldValidate(n))return false;
    if(n!==3||isTradeCategory(state.category))return true;
    for(const [key,b] of state.brands){
      for(let i=0;i<(b.sources||[]).length;i++){
        const s=b.sources[i];
        s.sourceCity=canonCity(s.sourceCity||'');
        resolveSource(s,{auto:true});
        const candidates=candidateList(s);
        const m=mobile10(s.sourceMobile||'');
        if(String(s.sourceMobile||'').trim()&&!m){
          const e=document.querySelector('[data-err="'+key+'-'+i+'"]');
          const card=document.querySelector('[data-card="'+key+'-'+i+'"]');
          if(e)e.textContent='Supplier mobile must be a valid Pakistan number, e.g. 03001234567.';
          if(card)card.classList.add('invalid');reveal(card||e);return false;
        }
        if(candidates.length>1&&!m){
          const e=document.querySelector('[data-err="'+key+'-'+i+'"]');
          const card=document.querySelector('[data-card="'+key+'-'+i+'"]');
          if(e)e.textContent='Similar suppliers exist. Enter supplier mobile to identify the correct business.';
          if(card)card.classList.add('invalid');reveal(card||e);return false;
        }
      }
    }
    return true;
  };

  const oldPostPayload=postPayload;
  postPayload=function(payload){
    if(payload&&payload.action==='submitSurvey'){
      payload.appVersion=APP_VERSION_V019;
      payload.entityResolutionVersion=ER_VERSION;
      const bs=Array.from(state.brands.values());
      (payload.brands||[]).forEach((b,bi)=>{
        const stateBrand=bs[bi];
        (b.sources||[]).forEach((s,si)=>{
          const ss=stateBrand&&stateBrand.sources&&stateBrand.sources[si];
          if(!ss)return;
          resolveSource(ss,{auto:true});
          s.sourceName=String(ss.sourceName||s.sourceName||'').trim();
          s.sourceCity=canonCity(ss.sourceCity||s.sourceCity||'');
          s.sourceMobile=normalizeMobile(ss.sourceMobile||s.sourceMobile||'');
          s.sourceTelecode=ss.sourceTelecode||s.sourceTelecode||'';
          s.sourceId=ss.sourceId||s.sourceId||'';
          s.sourceEntityId=ss.sourceEntityId||'';
          s.canonicalEntityId=ss.canonicalEntityId||'';
          s.resolutionStatus=ss.resolutionStatus||'UNRESOLVED';
          s.resolutionRule=ss.resolutionRule||'';
          s.identityKey=[s.sourceType,mobile10(s.sourceMobile)||norm(s.sourceName),norm(s.sourceCity)].join('|');
        });
      });
    }
    return oldPostPayload(payload);
  };

  document.querySelectorAll('.userMeta').forEach(el=>{
    if(el.textContent.includes('v0.18.0-PWA'))el.innerHTML=el.innerHTML.replace('v0.18.0-PWA','v0.19.0-PWA');
  });
  const style=document.createElement('style');
  style.textContent='[data-match-note]{margin-top:8px;padding:7px 9px;border-radius:8px;background:#eef4ff;color:#344054;border:1px solid #d6e4ff}.sourceCard.invalid [data-match-note]{background:#fff7ed;border-color:#fed7aa}';
  document.head.appendChild(style);
  if(state.brands&&state.brands.size)renderBrands();
  console.info('[Atlas MNI] Entity Resolution',ER_VERSION,'loaded');
}catch(err){
  console.error('[Atlas MNI] Entity Resolution enhancement failed; base v0.18 remains active.',err);
}
})();
