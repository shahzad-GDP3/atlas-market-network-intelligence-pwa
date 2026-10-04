(()=>{
'use strict';
try{
  const ER_VERSION='ER-2.2';
  const APP_VERSION_V020='0.20.0-PWA';
  const resolutionCache=new Map();

  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const rawName=s=>String((s&&s.sourceNameRaw)|| (s&&s.sourceName) ||'').trim();
  const rawCity=s=>String((s&&s.sourceCityRaw)|| (s&&s.sourceCity) ||'').trim();
  const rawMobile=s=>String((s&&s.sourceMobileRaw)|| (s&&s.sourceMobile) ||'').trim();
  const resolutionKey=s=>[
    String(s&&s.sourceType||'').toUpperCase(),
    norm(rawName(s)),
    norm(rawCity(s)),
    normalizeMobile(rawMobile(s)||'')
  ].join('|');

  function clearResolution(s){
    if(!s)return;
    delete s.sourceNameRaw; delete s.sourceCityRaw; delete s.sourceMobileRaw;
    s.sourceId=''; s.sourceEntityId=''; s.canonicalEntityId=''; s.sourceTelecode='';
    s.resolutionStatus=''; s.resolutionRule=''; s.identityKey='';
    delete s._resolution; delete s._resolutionKey;
  }

  function sourcePayload(s){
    return {
      sourceType:String(s.sourceType||'').trim(),
      sourceName:rawName(s),
      sourceCity:rawCity(s),
      sourceMobile:normalizeMobile(rawMobile(s)||''),
      sourceTelecode:String(s.sourceTelecode||'').trim()
    };
  }

  function candidateLabel(x){
    if(!x)return '';
    return [x.sourceName,x.sourceCity].filter(Boolean).join(' Â· ');
  }

  function noteText(s){
    const r=s&&s._resolution;
    if(!r)return 'Identity check runs against the live master before continuing.';
    if(r.status==='CHECKING')return 'Checking live supplier masterâ€¦';
    if(r.status==='MATCHED')return 'âœ“ Matched: '+candidateLabel(r.match)+(r.match&&r.match.verified?' Â· verified':' Â· mobile-backed');
    if(r.status==='NEW')return 'New supplier â€” original details will be preserved for review.';
    if(r.status==='POSSIBLE')return 'Possible existing supplier: '+candidateLabel(r.match)+'. Enter/confirm supplier mobile to identify it safely.';
    if(r.status==='AMBIGUOUS')return 'Similar suppliers found: '+(r.candidates||[]).map(candidateLabel).filter(Boolean).join(' / ')+'. Supplier mobile is required.';
    if(r.status==='CONFLICT')return 'Supplier mobile conflicts with the entered name/town. Verify the details.';
    if(r.status==='ERROR')return 'Could not verify supplier identity. Check internet and try again.';
    return 'Supplier identity requires verification.';
  }

  function applyResolution(s,r,key){
    const before={name:rawName(s),city:rawCity(s),mobile:normalizeMobile(rawMobile(s)||'')};
    s.sourceNameRaw=before.name;
    s.sourceCityRaw=before.city;
    s.sourceMobileRaw=before.mobile;
    s._resolution=r;
    s._resolutionKey=key;

    if(r.status==='MATCHED'&&r.match){
      const m=r.match;
      s.sourceName=m.sourceName||before.name;
      s.sourceCity=m.sourceCity||before.city;
      if(before.mobile)s.sourceMobile=before.mobile;
      s.sourceTelecode=m.sourceTelecode||s.sourceTelecode||'';
      s.sourceId=m.sourceId||'';
      s.sourceEntityId=m.sourceEntityId||'';
      s.canonicalEntityId=m.canonicalEntityId||'';
      s.resolutionStatus=m.verified?'CANONICAL_MATCH':'OBSERVED_MOBILE_MATCH';
      s.resolutionRule=r.rule||'';
    }else{
      s.sourceName=before.name;
      s.sourceCity=before.city;
      s.sourceMobile=before.mobile;
      s.sourceId=''; s.sourceEntityId=''; s.canonicalEntityId=''; s.sourceTelecode='';
      s.resolutionStatus=r.status==='NEW'?'UNRESOLVED':r.status;
      s.resolutionRule=r.rule||'';
    }
    s.identityKey=[s.sourceType,normalizeMobile(s.sourceMobile||'')||norm(s.sourceName),norm(s.sourceCity)].join('|');
  }

  const basePostPayload=postPayload;

  async function resolveRemote(s,{force=false}={}){
    if(!s||!String(s.sourceType||'').trim()||!rawName(s)||!rawCity(s)){
      return {status:'ERROR',rule:'INCOMPLETE',match:null,candidates:[]};
    }
    const supplied=rawMobile(s);
    if(supplied&& !/^03\d{9}$/.test(normalizeMobile(supplied))){
      return {status:'CONFLICT',rule:'INVALID_MOBILE',match:null,candidates:[]};
    }
    const key=resolutionKey(s);
    if(!force&&s._resolutionKey===key&&s._resolution&&s._resolution.status!=='CHECKING')return s._resolution;
    if(!force&&resolutionCache.has(key)){
      const cached=resolutionCache.get(key);
      applyResolution(s,cached,key);
      return cached;
    }
    s._resolution={status:'CHECKING'};
    try{
      const r=await basePostPayload({action:'resolveSource',requestId:uuid(),source:sourcePayload(s)});
      const clean={
        status:String(r.status||'ERROR').toUpperCase(),
        rule:String(r.rule||''),
        match:r.match||null,
        candidates:Array.isArray(r.candidates)?r.candidates:[]
      };
      resolutionCache.set(key,clean);
      applyResolution(s,clean,key);
      return clean;
    }catch(err){
      const fail={status:'ERROR',rule:'NETWORK',match:null,candidates:[],error:err&&err.message?err.message:String(err)};
      s._resolution=fail; s._resolutionKey=key;
      return fail;
    }
  }

  function findSource(brandKey,index){
    const b=state.brands.get(brandKey);
    return b&&b.sources?b.sources[Number(index)]:null;
  }

  function showSourceError(key,index,message){
    const e=document.querySelector('[data-err="'+key+'-'+index+'"]');
    const card=document.querySelector('[data-card="'+key+'-'+index+'"]');
    if(e)e.textContent=message;
    if(card)card.classList.add('invalid');
    reveal(card||e);
  }

  const baseSourceCard=sourceCard;
  sourceCard=function(key,s,i,total){
    const html=baseSourceCard(key,s,i,total);
    return html.replace('<p class="error" data-err="'+key+'-'+i+'"></p>',
      '<div class="identityHint" data-match-note="'+key+'-'+i+'">'+esc(noteText(s))+'</div><p class="error" data-err="'+key+'-'+i+'"></p>');
  };

  const baseRenderBrands=renderBrands;
  renderBrands=function(){
    baseRenderBrands();

    document.querySelectorAll('[data-stype]').forEach(el=>{
      const previous=el.onclick;
      el.onclick=()=>{
        const s=findSource(el.dataset.sbrand,el.dataset.idx);
        if(s&&s.sourceType!==el.dataset.stype)clearResolution(s);
        if(previous)previous();
      };
    });

    document.querySelectorAll('[data-sfield]').forEach(el=>{
      const previous=el.oninput;
      el.oninput=()=>{
        if(previous)previous();
        const s=findSource(el.dataset.sbrand,el.dataset.idx);
        if(!s)return;
        clearResolution(s);
        const note=document.querySelector('[data-match-note="'+el.dataset.sbrand+'-'+el.dataset.idx+'"]');
        if(note)note.textContent='Details changed â€” identity will be checked before continuing.';
      };
      el.onblur=async()=>{
        const s=findSource(el.dataset.sbrand,el.dataset.idx);
        if(!s||!s.sourceType||!String(s.sourceName||'').trim()||!String(s.sourceCity||'').trim())return;
        const note=document.querySelector('[data-match-note="'+el.dataset.sbrand+'-'+el.dataset.idx+'"]');
        if(note)note.textContent='Checking live supplier masterâ€¦';
        const r=await resolveRemote(s);
        if(r.status==='MATCHED'||r.status==='NEW')renderBrands();
        else if(note)note.textContent=noteText(s);
      };
    });
  };

  async function verifyStepThreeSources(){
    if(!validate(3))return false;
    if(isTradeCategory(state.category))return true;

    for(const [key,b] of state.brands){
      for(let i=0;i<(b.sources||[]).length;i++){
        const s=b.sources[i];
        const supplied=rawMobile(s);
        if(supplied&&!/^03\d{9}$/.test(normalizeMobile(supplied))){
          renderBrands();
          showSourceError(key,i,'Supplier mobile must be a valid Pakistan number, e.g. 03001234567.');
          return false;
        }
        const r=await resolveRemote(s,{force:false});
        if(r.status==='MATCHED'||r.status==='NEW')continue;
        renderBrands();
        if(r.status==='POSSIBLE')showSourceError(key,i,'A similar supplier already exists. Enter/confirm supplier mobile before continuing.');
        else if(r.status==='AMBIGUOUS')showSourceError(key,i,'Multiple similar suppliers exist. Supplier mobile is required to identify the correct business.');
        else if(r.status==='CONFLICT')showSourceError(key,i,r.rule==='INVALID_MOBILE'?'Enter a valid supplier mobile number.':'Supplier mobile conflicts with the entered business. Verify name, town and mobile.');
        else showSourceError(key,i,'Supplier identity could not be verified. Check internet and try again.');
        return false;
      }
    }
    return true;
  }

  const baseHandleNext=handleNext;
  handleNext=async function(){
    if(state.step!==3)return baseHandleNext();
    $('next').disabled=true;
    const oldText=$('next').textContent;
    $('next').textContent='Checking suppliersâ€¦';
    try{
      if(await verifyStepThreeSources()){
        renderBrands();
        go(4);
      }
    }finally{
      $('next').disabled=false;
      $('next').textContent=oldText||'Continue';
    }
  };

  function sourceResolutionReady(){
    if(isTradeCategory(state.category))return true;
    for(const b of state.brands.values()){
      for(const s of (b.sources||[])){
        const r=s._resolution;
        if(!r||s._resolutionKey!==resolutionKey(s)||!['MATCHED','NEW'].includes(r.status))return false;
      }
    }
    return true;
  }

  const baseSubmitSurvey=submitSurvey;
  submitSurvey=async function(){
    if(!sourceResolutionReady()){
      go(3);
      $('brandError').textContent='Supplier identity must be checked again before submit. Tap Continue.';
      reveal($('brandDetails'));
      return;
    }
    return baseSubmitSurvey();
  };

  postPayload=function(payload){
    if(payload&&payload.action==='submitSurvey'){
      payload.appVersion=APP_VERSION_V020;
      payload.entityResolutionVersion=ER_VERSION;
      const stateBrands=Array.from(state.brands.values());
      (payload.brands||[]).forEach((b,bi)=>{
        const stateBrand=stateBrands[bi];
        (b.sources||[]).forEach((s,si)=>{
          const ss=stateBrand&&stateBrand.sources&&stateBrand.sources[si];
          if(!ss)return;
          s.sourceNameRaw=ss.sourceNameRaw||ss.sourceName||'';
          s.sourceCityRaw=ss.sourceCityRaw||ss.sourceCity||'';
          s.sourceMobileRaw=ss.sourceMobileRaw||ss.sourceMobile||'';
          s.sourceName=ss.sourceName||s.sourceName||'';
          s.sourceCity=ss.sourceCity||s.sourceCity||'';
          s.sourceMobile=normalizeMobile(ss.sourceMobile||s.sourceMobile||'');
          s.sourceTelecode=ss.sourceTelecode||s.sourceTelecode||'';
          s.sourceId=ss.sourceId||s.sourceId||'';
          s.sourceEntityId=ss.sourceEntityId||'';
          s.canonicalEntityId=ss.canonicalEntityId||'';
          s.resolutionStatus=ss.resolutionStatus||'UNRESOLVED';
          s.resolutionRule=ss.resolutionRule||'';
          s.identityKey=ss.identityKey||[s.sourceType,s.sourceMobile||norm(s.sourceName),norm(s.sourceCity)].join('|');
        });
      });
    }
    return basePostPayload(payload);
  };

  document.querySelectorAll('.userMeta').forEach(el=>{
    if(el.textContent.includes('v0.18.0-PWA'))el.innerHTML=el.innerHTML.replace('v0.18.0-PWA','v0.20.0-PWA');
  });
  const style=document.createElement('style');
  style.textContent='.identityHint{margin-top:8px;padding:8px 10px;border-radius:9px;background:#eef4ff;color:#344054;border:1px solid #d6e4ff;font-size:12px;line-height:1.35}.sourceCard.invalid .identityHint{background:#fff7ed;border-color:#fed7aa}';
  document.head.appendChild(style);
  if(state.brands&&state.brands.size)renderBrands();
  console.info('[Atlas MNI] server entity resolution',ER_VERSION,'loaded');
}catch(err){
  console.error('[Atlas MNI] v0.20 entity resolution enhancement failed; base app remains available.',err);
}
})();
