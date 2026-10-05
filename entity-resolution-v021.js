(()=>{
'use strict';
try{
  const FRONTEND_MODE='DB-MANAGED-1.1';
  const APP_VERSION='0.22.1-PWA';
  const basePostPayload=postPayload;
  const suggestionCache=new Map();
  const suggestionTimers=new Map();
  const suggestionResults=new Map();

  const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const findSource=(brandKey,index)=>{
    const b=state.brands.get(brandKey);
    return b&&b.sources?b.sources[Number(index)]:null;
  };
  const suggestionCardKey=(brandKey,index)=>String(brandKey)+'-'+String(index);
  const suggestionCacheKey=(src,query)=>[
    String(src&&src.sourceType||'').toUpperCase(),
    norm(src&&src.sourceCity||''),
    norm(query||'')
  ].join('|');

  async function fetchSuggestions(src,query=''){
    if(!src||!src.sourceType||!String(src.sourceCity||'').trim())return [];
    const cacheKey=suggestionCacheKey(src,query);
    if(suggestionCache.has(cacheKey))return suggestionCache.get(cacheKey);
    const r=await basePostPayload({
      action:'searchSources',
      requestId:uuid(),
      search:{
        sourceType:src.sourceType,
        city:src.sourceCity,
        query:String(query||'').trim(),
        limit:String(query||'').trim()?10:5
      }
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
    if(message){
      box.innerHTML='<div class="suggestEmpty">'+esc(message)+'</div>';
      return;
    }
    if(!items||!items.length){
      box.innerHTML='<div class="suggestEmpty">No verified suppliers found for this town/type. Manual entry is available below.</div>';
      return;
    }
    box.innerHTML=items.map((item,idx)=>
      '<button type="button" class="suggestItem" data-suggest-pick="'+cardKey+'" data-suggest-idx="'+idx+'">'+
        '<span class="suggestName">'+esc(item.sourceName||'')+'</span>'+
        '<span class="suggestMeta">'+esc(suggestionMeta(item))+'</span>'+
      '</button>'
    ).join('');

    box.querySelectorAll('[data-suggest-pick]').forEach(btn=>btn.onclick=()=>{
      const result=suggestionResults.get(cardKey)||[];
      const item=result[Number(btn.dataset.suggestIdx)];
      if(!item)return;
      const parts=cardKey.split('-');
      const index=Number(parts.pop());
      const brandKey=parts.join('-');
      const src=findSource(brandKey,index);
      if(!src)return;
      src.sourceName=item.sourceName||src.sourceName||'';
      src.sourceCity=item.sourceCity||src.sourceCity||'';
      src.sourceTelecode=item.sourceTelecode||'';
      src.sourceId=item.sourceId||'';
      src.sourceEntityId=item.sourceEntityId||'';
      src.canonicalEntityId=item.canonicalEntityId||'';
      renderBrands();
    });
  }

  async function loadSuggestions(brandKey,index,query=''){
    const src=findSource(brandKey,index);
    const cardKey=suggestionCardKey(brandKey,index);
    if(!src||!src.sourceType){
      renderSuggestionList(cardKey,[],'Select Distributor, Wholesaler or Retailer first.');
      return;
    }
    if(!String(src.sourceCity||'').trim()){
      renderSuggestionList(cardKey,[],'Enter town / city to see verified suppliers.');
      return;
    }
    renderSuggestionList(cardKey,[],'Loading verified suppliers...');
    try{
      const items=await fetchSuggestions(src,query);
      renderSuggestionList(cardKey,items,'');
    }catch(_){
      renderSuggestionList(cardKey,[],'Suggestions are unavailable right now. Manual entry still works.');
    }
  }

  function scheduleSuggestions(brandKey,index,query='',delay=180){
    const cardKey=suggestionCardKey(brandKey,index);
    clearTimeout(suggestionTimers.get(cardKey));
    suggestionTimers.set(cardKey,setTimeout(()=>loadSuggestions(brandKey,index,query),delay));
  }

  /*
   * Supplier identity is intentionally NOT resolved or blocked in the frontend.
   * Suggestions are convenience only. Field users can always enter observed data
   * and continue. The backend/database owns resolution, verification and segregation.
   */
  postPayload=function(payload){
    if(payload&&payload.action==='submitSurvey'){
      payload.appVersion=APP_VERSION;
      payload.entityResolutionVersion=FRONTEND_MODE;
      const stateBrands=Array.from(state.brands.values());
      (payload.brands||[]).forEach((brand,bi)=>{
        const stateBrand=stateBrands[bi];
        (brand.sources||[]).forEach((source,si)=>{
          const observed=stateBrand&&stateBrand.sources&&stateBrand.sources[si];
          if(!observed)return;

          const enteredName=String(observed.sourceName||'').trim();
          const enteredCity=String(observed.sourceCity||'').trim();
          const enteredMobile=String(observed.sourceMobile||'').trim();

          source.sourceNameRaw=enteredName;
          source.sourceCityRaw=enteredCity;
          source.sourceMobileRaw=enteredMobile;
          source.sourceName=enteredName;
          source.sourceCity=enteredCity;
          source.sourceMobile=normalizeMobile(enteredMobile);
          source.sourceTelecode=String(observed.sourceTelecode||source.sourceTelecode||'').trim();
          source.sourceId=String(observed.sourceId||source.sourceId||'').trim();
          source.sourceEntityId=String(observed.sourceEntityId||source.sourceEntityId||'').trim();
          source.canonicalEntityId=String(observed.canonicalEntityId||source.canonicalEntityId||'').trim();

          // Never let a frontend resolution decision gate or classify submitted data.
          delete source.resolutionStatus;
          delete source.resolutionRule;
          delete source.identityKey;
        });
      });
    }
    return basePostPayload(payload);
  };

  const baseSourceCard=sourceCard;
  sourceCard=function(key,src,i,total){
    const btn=t=>'<button type="button" class="sourceType '+(src.sourceType===t?'selected':'')+'" data-stype="'+t+'" data-sbrand="'+key+'" data-idx="'+i+'">'+(t==='DISTRIBUTOR'?'Distributor':t==='WHOLESALER'?'Wholesaler':'Retailer')+'</button>';
    const cardKey=suggestionCardKey(key,i);
    return '<div class="sourceCard" data-card="'+cardKey+'">'+
      '<div class="sourceTitle"><span>'+(total>1?'Supplier '+(i+1):'Source of this brand')+'</span>'+(total>1?'<button type="button" class="remove" data-remove="'+i+'" data-sbrand="'+key+'">Remove</button>':'')+'</div>'+
      '<div class="sourceTypes">'+btn('DISTRIBUTOR')+btn('WHOLESALER')+btn('RETAILER')+'</div>'+
      '<label>Town / city <span class="req">*</span><input data-sfield="sourceCity" data-sbrand="'+key+'" data-idx="'+i+'" value="'+esc(src.sourceCity||'')+'" placeholder="Kabirwala"></label>'+
      '<div class="suggestPanel">'+
        '<div class="suggestTitle"><span>Verified supplier suggestions</span><span class="verifiedPill">Optional</span></div>'+
        '<input class="suggestSearch" data-suggest-search="'+cardKey+'" placeholder="Search name, code or last 4 mobile digits">'+
        '<div class="suggestList" data-suggest-list="'+cardKey+'"><div class="suggestEmpty">'+(src.sourceType&&src.sourceCity?'Loading verified suppliers...':'Select type and enter town / city.')+'</div></div>'+
        '<button type="button" class="addNewSupplier" data-add-new="'+cardKey+'">+ Add New Supplier / Enter Manually</button>'+
      '</div>'+
      '<label>Supplier name <span class="req">*</span><input data-sfield="sourceName" data-sbrand="'+key+'" data-idx="'+i+'" value="'+esc(src.sourceName||'')+'" placeholder="Select above or enter supplier"></label>'+
      '<label>Supplier mobile <span class="optional">(optional)</span><input inputmode="tel" data-sfield="sourceMobile" data-sbrand="'+key+'" data-idx="'+i+'" value="'+esc(src.sourceMobile||'')+'"></label>'+
      '<div class="dbManagedHint">Saved as entered. Database verification runs after submission and does not block this form.</div><p class="error" data-err="'+cardKey+'"></p></div>';
  };

  const baseRenderBrands=renderBrands;
  renderBrands=function(){
    baseRenderBrands();

    document.querySelectorAll('[data-stype]').forEach(el=>{
      const previous=el.onclick;
      el.onclick=()=>{
        if(previous)previous();
        scheduleSuggestions(el.dataset.sbrand,el.dataset.idx,'',0);
      };
    });

    document.querySelectorAll('[data-sfield="sourceCity"]').forEach(el=>{
      const previous=el.oninput;
      el.oninput=()=>{
        if(previous)previous();
        const src=findSource(el.dataset.sbrand,el.dataset.idx);
        if(src){
          src.sourceId='';
          src.sourceEntityId='';
          src.canonicalEntityId='';
        }
        scheduleSuggestions(el.dataset.sbrand,el.dataset.idx,'',260);
      };
    });

    document.querySelectorAll('[data-sfield="sourceName"],[data-sfield="sourceMobile"]').forEach(el=>{
      const previous=el.oninput;
      el.oninput=()=>{
        if(previous)previous();
        const src=findSource(el.dataset.sbrand,el.dataset.idx);
        if(src){
          src.sourceId='';
          src.sourceEntityId='';
          src.canonicalEntityId='';
        }
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
        const city=src.sourceCity;
        const type=src.sourceType;
        src.sourceType=type;
        src.sourceCity=city;
        src.sourceName='';
        src.sourceMobile='';
        src.sourceTelecode='';
        src.sourceId='';
        src.sourceEntityId='';
        src.canonicalEntityId='';
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

  document.querySelectorAll('.userMeta').forEach(el=>{
    if(el.textContent.includes('v0.18.0-PWA'))el.innerHTML=el.innerHTML.replace('v0.18.0-PWA',APP_VERSION);
    else if(el.textContent.includes('v0.21.1-PWA'))el.innerHTML=el.innerHTML.replace('v0.21.1-PWA',APP_VERSION);
    else if(el.textContent.includes('v0.22.0-PWA'))el.innerHTML=el.innerHTML.replace('v0.22.0-PWA',APP_VERSION);
  });

  const style=document.createElement('style');
  style.textContent='.dbManagedHint{margin-top:8px;padding:8px 10px;border-radius:9px;background:#eef8f2;color:#315b43;border:1px solid #cfe9d8;font-size:11px;line-height:1.35}.suggestPanel{margin-top:11px;padding:10px;border:1px solid #d8deeb;border-radius:10px;background:#fff}.suggestTitle{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;font-weight:850;color:#25304a}.verifiedPill{font-size:9px;padding:4px 7px;border-radius:999px;background:#eef2ff;color:#3538cd;border:1px solid #c7d7fe}.suggestSearch{min-height:42px;margin-top:8px;font-size:13px;background:#fbfcfe}.suggestList{display:grid;gap:6px;margin-top:8px;max-height:250px;overflow:auto}.suggestItem{width:100%;text-align:left;border:1px solid #d9ddea;background:#f8f9fc;border-radius:9px;padding:9px 10px;color:#172033}.suggestItem:active{border-color:#24247a;background:#efeffb}.suggestName{display:block;font-size:12px;font-weight:900}.suggestMeta{display:block;margin-top:3px;font-size:10px;color:#667085}.suggestEmpty{font-size:10px;color:#7a8190;padding:7px 2px;line-height:1.35}.addNewSupplier{width:100%;margin-top:8px;min-height:38px;border:1px dashed #8f97aa;border-radius:8px;background:#fff;color:#24247a;font-size:11px;font-weight:850}';
  document.head.appendChild(style);

  if(state.brands&&state.brands.size)renderBrands();
  console.info('[Atlas MNI] frontend supplier blocking disabled; optional verified suggestions enabled;',FRONTEND_MODE,'loaded');
}catch(err){
  console.error('[Atlas MNI] DB-managed supplier mode failed; base app remains available.',err);
}
})();
