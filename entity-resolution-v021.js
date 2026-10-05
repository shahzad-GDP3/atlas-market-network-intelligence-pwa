(()=>{
'use strict';
try{
  const ER_VERSION='ER-2.4';
  const APP_VERSION_V021='0.21.0-PWA';
  const resolutionCache=new Map();

  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const rawName=s=>String((s&&s.sourceNameRaw)|| (s&&s.sourceName) ||'').trim();
  const rawCity=s=>String((s&&s.sourceCityRaw)|| (s&&s.sourceCity) ||'').trim();
  const rawMobile=s=>String((s&&s.sourceMobileRaw)|| (s&&s.sourceMobile) ||'').trim();
  const resolutionKey=s=>[
    String(s&&s.sourceType||'').toUpperCase(),
    norm(rawName(s)),
    norm(rawCity(s)),
    String(s&&s.canonicalEntityId||''),
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
      sourceTelecode:String(s.sourceTelecode||'').trim(),
      sourceId:String(s.sourceId||'').trim(),
      sourceEntityId:String(s.sourceEntityId||'').trim(),
      canonicalEntityId:String(s.canonicalEntityId||'').trim()
    };
  }

  function candidateLabel(x){
    if(!x)return '';
    return [x.sourceName,x.sourceCity].filter(Boolean).join(' | ');
  }

  function noteText(s){
    const r=s&&s._resolution;
    if(!r)return 'Identity check runs against the live master before continuing.';
    if(r.status==='CHECKING')return 'Checking live supplier master...';
    if(r.status==='MATCHED')return 'Matched: '+candidateLabel(r.match)+(r.match&&r.match.verified?' | verified':' | mobile-backed');
    if(r.status==='NEW')return 'New supplier - saved for manual verification and kept off the network map until approved.';
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
  const suggestionCache=new Map();
  const suggestionTimers=new Map();
  const suggestionResults=new Map();

  const suggestionCardKey=(brandKey,index)=>String(brandKey)+'-'+String(index);
  const suggestionCacheKey=(src,query)=>[String(src&&src.sourceType||'').toUpperCase(),norm(rawCity(src)),norm(query||'')].join('|');

  async function fetchSuggestions(src,query=''){
    if(!src||!src.sourceType||!String(src.sourceCity||'').trim())return [];
    const cacheKey=suggestionCacheKey(src,query);
    if(suggestionCache.has(cacheKey))return suggestionCache.get(cacheKey);
    const r=await basePostPayload({
      action:'searchSources',requestId:uuid(),
      search:{sourceType:src.sourceType,city:src.sourceCity,query:String(query||'').trim(),limit:String(query||'').trim()?10:5}
    });
    const items=Array.isArray(r.items)?r.items.filter(x=>x&&x.verified):[];
    suggestionCache.set(cacheKey,items);
    return items;
  }

  function suggestionMeta(item){
    const bits=[item.sourceCity||''];
    if(item.mobileLast4)bits.push('****'+item.mobileLast4);
    bits.push('Verified');
    return bits.filter(Boolean).join(' | ');
  }

  function renderSuggestionList(cardKey,items,message){
    const box=document.querySelector('[data-suggest-list="'+cardKey+'"]');
    if(!box)return;
    suggestionResults.set(cardKey,items||[]);
    if(message){box.innerHTML='<div class="suggestEmpty">'+esc(message)+'</div>';return;}
    if(!items||!items.length){box.innerHTML='<div class="suggestEmpty">No verified suppliers found for this town/type. Use Add New Supplier.</div>';return;}
    box.innerHTML=items.map((item,idx)=>
      '<button type="button" class="suggestItem" data-suggest-pick="'+cardKey+'" data-suggest-idx="'+idx+'">'+
        '<span class="suggestName">'+esc(item.sourceName||'')+'</span>'+
        '<span class="suggestMeta">'+esc(suggestionMeta(item))+'</span>'+
      '</button>'
    ).join('');
    box.querySelectorAll('[data-suggest-pick]').forEach(btn=>btn.onclick=async()=>{
      const result=suggestionResults.get(cardKey)||[];
      const item=result[Number(btn.dataset.suggestIdx)];
      if(!item)return;
      const parts=cardKey.split('-');
      const index=Number(parts.pop());
      const brandKey=parts.join('-');
      const src=findSource(brandKey,index);
      if(!src)return;
      const keptType=src.sourceType;
      clearResolution(src);
      src.sourceType=item.sourceType||keptType;
      src.sourceName=item.sourceName||'';
      src.sourceCity=item.sourceCity||src.sourceCity||'';
      src.sourceMobile='';
      src.sourceTelecode=item.sourceTelecode||'';
      src.sourceId=item.sourceId||'';
      src.sourceEntityId=item.sourceEntityId||'';
      src.canonicalEntityId=item.canonicalEntityId||'';
      const resolved=await resolveRemote(src,{force:true});
      renderBrands();
      if(resolved.status!=='MATCHED')showSourceError(brandKey,index,'Verified supplier selection could not be confirmed. Please search again.');
    });
  }

  async function loadSuggestions(brandKey,index,query=''){
    const src=findSource(brandKey,index);
    const cardKey=suggestionCardKey(brandKey,index);
    if(!src||!src.sourceType){renderSuggestionList(cardKey,[],'Select Distributor, Wholesaler or Retailer first.');return;}
    if(!String(src.sourceCity||'').trim()){renderSuggestionList(cardKey,[],'Enter town / city to see verified suppliers.');return;}
    renderSuggestionList(cardKey,[],'Loading verified suppliers...');
    try{
      const items=await fetchSuggestions(src,query);
      renderSuggestionList(cardKey,items,'');
    }catch(err){
      renderSuggestionList(cardKey,[],'Could not load suggestions. Manual entry is still available.');
    }
  }

  function scheduleSuggestions(brandKey,index,query='',delay=180){
    const cardKey=suggestionCardKey(brandKey,index);
    clearTimeout(suggestionTimers.get(cardKey));
    suggestionTimers.set(cardKey,setTimeout(()=>loadSuggestions(brandKey,index,query),delay));
  }

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
  sourceCard=function(key,src,i,total){
    const btn=t=>'<button type="button" class="sourceType '+(src.sourceType===t?'selected':'')+'" data-stype="'+t+'" data-sbrand="'+key+'" data-idx="'+i+'">'+(t==='DISTRIBUTOR'?'Distributor':t==='WHOLESALER'?'Wholesaler':'Retailer')+'</button>';
    const cardKey=suggestionCardKey(key,i);
    return '<div class="sourceCard" data-card="'+cardKey+'">'+
      '<div class="sourceTitle"><span>'+(total>1?'Supplier '+(i+1):'Source of this brand')+'</span>'+(total>1?'<button type="button" class="remove" data-remove="'+i+'" data-sbrand="'+key+'">Remove</button>':'')+'</div>'+
      '<div class="sourceTypes">'+btn('DISTRIBUTOR')+btn('WHOLESALER')+btn('RETAILER')+'</div>'+
      '<label>Town / city <span class="req">*</span><input data-sfield="sourceCity" data-sbrand="'+key+'" data-idx="'+i+'" value="'+esc(src.sourceCity||'')+'" placeholder="Kabirwala"></label>'+
      '<div class="suggestPanel">'+
        '<div class="suggestTitle"><span>Verified '+esc((src.sourceType||'supplier').toLowerCase())+' suggestions</span><span class="verifiedPill">Verified only</span></div>'+
        '<input class="suggestSearch" data-suggest-search="'+cardKey+'" placeholder="Search name, code or last 4 mobile digits">'+
        '<div class="suggestList" data-suggest-list="'+cardKey+'"><div class="suggestEmpty">'+(src.sourceType&&src.sourceCity?'Loading verified suppliers...':'Select type and enter town / city.')+'</div></div>'+
        '<button type="button" class="addNewSupplier" data-add-new="'+cardKey+'">+ Add New Supplier</button>'+
      '</div>'+
      '<label>Supplier name <span class="req">*</span><input data-sfield="sourceName" data-sbrand="'+key+'" data-idx="'+i+'" value="'+esc(src.sourceName||'')+'" placeholder="Select above or enter new supplier"></label>'+
      '<label>Supplier mobile <span class="optional">(optional for verified selection)</span><input inputmode="tel" data-sfield="sourceMobile" data-sbrand="'+key+'" data-idx="'+i+'" value="'+esc(src.sourceMobile||'')+'"></label>'+
      '<div class="identityHint" data-match-note="'+cardKey+'">'+esc(noteText(src))+'</div><p class="error" data-err="'+cardKey+'"></p></div>';
  };

  const baseRenderBrands=renderBrands;
  renderBrands=function(){
    baseRenderBrands();

    document.querySelectorAll('[data-stype]').forEach(el=>{
      const previous=el.onclick;
      el.onclick=()=>{
        const src=findSource(el.dataset.sbrand,el.dataset.idx);
        if(src&&src.sourceType!==el.dataset.stype)clearResolution(src);
        if(previous)previous();
      };
    });

    document.querySelectorAll('[data-sfield]').forEach(el=>{
      const previous=el.oninput;
      el.oninput=()=>{
        if(previous)previous();
        const src=findSource(el.dataset.sbrand,el.dataset.idx);
        if(!src)return;
        clearResolution(src);
        const note=document.querySelector('[data-match-note="'+el.dataset.sbrand+'-'+el.dataset.idx+'"]');
        if(note)note.textContent='Details changed - identity will be checked before continuing.';
        if(el.dataset.sfield==='sourceCity')scheduleSuggestions(el.dataset.sbrand,el.dataset.idx,'',260);
      };
      el.onblur=async()=>{
        const src=findSource(el.dataset.sbrand,el.dataset.idx);
        if(!src||!src.sourceType||!String(src.sourceName||'').trim()||!String(src.sourceCity||'').trim())return;
        const note=document.querySelector('[data-match-note="'+el.dataset.sbrand+'-'+el.dataset.idx+'"]');
        if(note)note.textContent='Checking live supplier master...';
        const r=await resolveRemote(src);
        if(r.status==='MATCHED'||r.status==='NEW')renderBrands();
        else if(note)note.textContent=noteText(src);
      };
    });

    document.querySelectorAll('[data-suggest-search]').forEach(el=>{
      el.oninput=()=>{
        const parts=el.dataset.suggestSearch.split('-');
        const index=Number(parts.pop());
        const brandKey=parts.join('-');
        scheduleSuggestions(brandKey,index,el.value,220);
      };
    });

    document.querySelectorAll('[data-add-new]').forEach(btn=>{
      btn.onclick=()=>{
        const parts=btn.dataset.addNew.split('-');
        const index=Number(parts.pop());
        const brandKey=parts.join('-');
        const src=findSource(brandKey,index);
        if(!src)return;
        const city=src.sourceCity, type=src.sourceType;
        clearResolution(src);
        src.sourceType=type; src.sourceCity=city; src.sourceName=''; src.sourceMobile='';
        renderBrands();
        const input=document.querySelector('[data-sfield="sourceName"][data-sbrand="'+brandKey+'"][data-idx="'+index+'"]');
        if(input)input.focus();
      };
    });

    document.querySelectorAll('[data-card]').forEach(card=>{
      const parts=card.dataset.card.split('-');
      const index=Number(parts.pop());
      const brandKey=parts.join('-');
      const src=findSource(brandKey,index);
      if(src&&src.sourceType&&String(src.sourceCity||'').trim())scheduleSuggestions(brandKey,index,'',0);
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
        const r=await resolveRemote(s,{force:true});
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
    $('next').textContent='Checking suppliers...';
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
      payload.appVersion=APP_VERSION_V021;
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
    if(el.textContent.includes('v0.18.0-PWA'))el.innerHTML=el.innerHTML.replace('v0.18.0-PWA','v0.21.0-PWA');
  });
  const style=document.createElement('style');
  style.textContent='.identityHint{margin-top:8px;padding:8px 10px;border-radius:9px;background:#eef4ff;color:#344054;border:1px solid #d6e4ff;font-size:12px;line-height:1.35}.sourceCard.invalid .identityHint{background:#fff7ed;border-color:#fed7aa}.suggestPanel{margin-top:11px;padding:10px;border:1px solid #d8deeb;border-radius:10px;background:#fff}.suggestTitle{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;font-weight:850;color:#25304a}.verifiedPill{font-size:9px;padding:4px 7px;border-radius:999px;background:#ecfdf3;color:#027a48;border:1px solid #abefc6}.suggestSearch{min-height:42px;margin-top:8px;font-size:13px;background:#fbfcfe}.suggestList{display:grid;gap:6px;margin-top:8px;max-height:250px;overflow:auto}.suggestItem{width:100%;text-align:left;border:1px solid #d9ddea;background:#f8f9fc;border-radius:9px;padding:9px 10px;color:#172033}.suggestItem:active{border-color:#24247a;background:#efeffb}.suggestName{display:block;font-size:12px;font-weight:900}.suggestMeta{display:block;margin-top:3px;font-size:10px;color:#667085}.suggestEmpty{font-size:10px;color:#7a8190;padding:7px 2px;line-height:1.35}.addNewSupplier{width:100%;margin-top:8px;min-height:38px;border:1px dashed #8f97aa;border-radius:8px;background:#fff;color:#24247a;font-size:11px;font-weight:850}';
  document.head.appendChild(style);
  if(state.brands&&state.brands.size)renderBrands();
  console.info('[Atlas MNI] server entity resolution',ER_VERSION,'loaded');
}catch(err){
  console.error('[Atlas MNI] v0.21 entity resolution enhancement failed; base app remains available.',err);
}
})();
