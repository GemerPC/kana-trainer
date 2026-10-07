(() => {
  "use strict";
  const STORAGE_KEY = "kanaTrainerGrammarV1";
  const MINUTE = 60000, DAY = 86400000;
  const INTERVALS = [10*MINUTE,60*MINUTE,DAY,3*DAY,7*DAY,14*DAY,30*DAY,90*DAY,180*DAY,365*DAY];
  const lessons = window.KANA_GRAMMAR_LESSONS || [];
  const knownIds = new Set(lessons.map(lesson => lesson.id));
  const GROUPS = {all:"Все темы",basics:"Основы",particles:"Частицы",verbs:"Глаголы",expressions:"Выражения"};
  const INSTRUCTIONS = {
    desu:"Завершите вежливое утверждение связкой в настоящем времени.",
    wa:"Вставьте частицу темы, а не частицу выделения подлежащего.",mo:"Добавьте значение «тоже».",
    no:"Свяжите существительные частицей принадлежности или уточнения.",ka:"Завершите вежливый вопрос вопросительной частицей.",
    demonstratives:"Выберите указательное слово по расположению предмета в переводе.",wo:"Обозначьте прямой объект действия.",
    "de-place":"Обозначьте нейтральное место совершения действия.",ni:"Обозначьте точное время или место нахождения без противопоставления.",
    "to-and":"Соедините существительные как полный список: «A и B».",masu:"Впишите только вежливое окончание глагола, основа уже дана.",
    arimasu:"Впишите целый вежливый глагол наличия предмета в нейтральном описании.",
    imasu:"Впишите целый вежливый глагол нахождения человека или животного.",
    tai:"Впишите суффикс своего желания сделать действие; вежливая связка уже дана.",
    "te-kudasai":"Завершите вежливую просьбу; форма глагола перед ней уже дана.",
    mashou:"Впишите вежливое окончание совместного предложения: «давайте» без вопроса."
  };
  const ROMAJI = {
    kya:"きゃ",kyu:"きゅ",kyo:"きょ",sha:"しゃ",shu:"しゅ",sho:"しょ",cha:"ちゃ",chu:"ちゅ",cho:"ちょ",
    nya:"にゃ",nyu:"にゅ",nyo:"にょ",hya:"ひゃ",hyu:"ひゅ",hyo:"ひょ",mya:"みゃ",myu:"みゅ",myo:"みょ",
    rya:"りゃ",ryu:"りゅ",ryo:"りょ",gya:"ぎゃ",gyu:"ぎゅ",gyo:"ぎょ",bya:"びゃ",byu:"びゅ",byo:"びょ",
    pya:"ぴゃ",pyu:"ぴゅ",pyo:"ぴょ",ja:"じゃ",ju:"じゅ",jo:"じょ",shi:"し",chi:"ち",tsu:"つ",
    ka:"か",ki:"き",ku:"く",ke:"け",ko:"こ",sa:"さ",si:"し",su:"す",se:"せ",so:"そ",
    ta:"た",ti:"ち",tu:"つ",te:"て",to:"と",na:"な",ni:"に",nu:"ぬ",ne:"ね",no:"の",
    ha:"は",hi:"ひ",fu:"ふ",hu:"ふ",he:"へ",ho:"ほ",ma:"ま",mi:"み",mu:"む",me:"め",mo:"も",
    ya:"や",yu:"ゆ",yo:"よ",ra:"ら",ri:"り",ru:"る",re:"れ",ro:"ろ",wa:"わ",wo:"を",
    ga:"が",gi:"ぎ",gu:"ぐ",ge:"げ",go:"ご",za:"ざ",ji:"じ",zi:"じ",zu:"ず",ze:"ぜ",zo:"ぞ",
    da:"だ",di:"ぢ",du:"づ",de:"で",do:"ど",ba:"ば",bi:"び",bu:"ぶ",be:"べ",bo:"ぼ",
    pa:"ぱ",pi:"ぴ",pu:"ぷ",pe:"ぺ",po:"ぽ",a:"あ",i:"い",u:"う",e:"え",o:"お"
  };
  const ROMAJI_KEYS = Object.keys(ROMAJI).sort((a,b) => b.length-a.length);
  let host = null, ui = null, selectedId = lessons[0]?.id || null, group = "all", query = "", active = false;
  let progress = {}, wakeTimer = 0, audioToken = 0, session = null, currentScreen = "map", mapFilter = "all";

  function getExercises(lesson){
    return [
      ...lesson.meaningQuestions.map((question,index)=>({...question,type:"meaning",index,key:`meaning:${index}`})),
      ...lesson.questions.map((question,index)=>({...question,type:"fill",index,key:`fill:${index}`})),
      ...lesson.choiceQuestions.map((question,index)=>({...question,type:"choice",index,key:`choice:${index}`}))
    ];
  }

  function escape(value){return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}
  function normalizeAnswer(value){
    return String(value).normalize("NFKC").toLowerCase().replace(/[\s。．.!！?？、,]/g,"")
      .replace(/[ァ-ヶ]/g,char=>String.fromCharCode(char.charCodeAt(0)-0x60));
  }
  function romajiToKana(value){
    let result = "",rest = value;
    while(rest){
      if(/^([bcdfghjkmprstyz])\1/.test(rest)){result += "っ";rest = rest.slice(1);continue}
      if(rest[0] === "n" && (rest.length === 1 || rest[1] === "'" || !/[aiueoy]/.test(rest[1]))){
        result += "ん";rest = rest.slice(rest[1] === "'" ? 2 : 1);continue;
      }
      const match = ROMAJI_KEYS.find(key => rest.startsWith(key));
      if(!match) return null;
      result += ROMAJI[match];rest = rest.slice(match.length);
    }
    return result;
  }
  function isAnswerCorrect(value,answers){
    const input = normalizeAnswer(value);
    if(!input) return false;
    const converted = /^[a-z']+$/.test(input) ? romajiToKana(input) : input;
    return answers.some(answer => {
      const expected = normalizeAnswer(answer);
      return input === expected || converted === expected
        || (expected === "は" && input === "wa") || (expected === "を" && input === "o")
        || (expected === "へ" && input === "e");
    });
  }
  function emptyProgress(now = Date.now()){
    return {startedAt:now,lastReviewedAt:0,nextReviewAt:now,intervalMs:0,streak:0,seen:0,correct:0,lapses:0,questionCursor:0,lastResult:null};
  }
  function getNextProgress(previous,isCorrect,now,hintUsed = false){
    const next = {...emptyProgress(now),...previous};
    next.seen++;next.lastReviewedAt = now;
    if(isCorrect){
      if(!hintUsed){next.correct++;next.streak++}else next.streak = 0;
      next.lastResult = "correct";
      next.intervalMs = INTERVALS[Math.min(INTERVALS.length-1,Math.max(0,next.streak-1))];
      next.questionCursor++;
    } else {
      next.lapses++;next.streak = 0;next.lastResult = "wrong";next.intervalMs = MINUTE;
    }
    next.nextReviewAt = now + next.intervalMs;
    return next;
  }
  function getDueLessonIds(data,now = Date.now()){
    return lessons.filter(lesson => data[lesson.id]?.startedAt > 0 && data[lesson.id].nextReviewAt <= now)
      .sort((a,b) => Number(data[b.id].lastResult === "wrong") - Number(data[a.id].lastResult === "wrong")
        || data[a.id].nextReviewAt-data[b.id].nextReviewAt).map(lesson => lesson.id);
  }
  function validateProgress(data){
    if(!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Повреждён прогресс грамматики.");
    const clean = {};
    const number = (value,max,integer = false) => {
      if(!Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) throw new Error("Некорректные числа в прогрессе грамматики.");
      return value;
    };
    Object.entries(data).forEach(([id,value]) => {
      if(!knownIds.has(id)) return;
      if(!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждены данные грамматической темы.");
      const item = {
        startedAt:number(value.startedAt,Date.UTC(2200,0,1)),
        lastReviewedAt:number(value.lastReviewedAt ?? 0,Date.UTC(2200,0,1)),
        nextReviewAt:number(value.nextReviewAt,Date.UTC(2200,0,1)),
        intervalMs:number(value.intervalMs ?? 0,365*DAY),
        streak:number(value.streak ?? 0,1e9,true),seen:number(value.seen ?? 0,1e9,true),
        correct:number(value.correct ?? 0,1e9,true),lapses:number(value.lapses ?? 0,1e9,true),
        questionCursor:number(value.questionCursor ?? 0,1e9,true),
        lastResult:value.lastResult === "correct" || value.lastResult === "wrong" ? value.lastResult : null,
        practiceSeen:number(value.practiceSeen ?? 0,1e9,true),practiceCorrect:number(value.practiceCorrect ?? 0,1e9,true),
        lastPracticeAt:number(value.lastPracticeAt ?? 0,Date.UTC(2200,0,1)),drillSolved:[]
      };
      if(item.correct + item.lapses > item.seen || item.streak > item.correct) throw new Error("Счётчики ответов грамматики не совпадают.");
      const exerciseKeys = new Set(getExercises(lessons.find(lesson=>lesson.id === id)).map(exercise=>exercise.key));
      if(value.drillSolved != null && (!Array.isArray(value.drillSolved) || value.drillSolved.some(key=>!exerciseKeys.has(key)))) throw new Error("Повреждён прогресс закрепления.");
      item.drillSolved = [...new Set(value.drillSolved || [])];
      if(item.practiceCorrect > item.practiceSeen || item.drillSolved.length > item.practiceCorrect) throw new Error("Счётчики закрепления не совпадают.");
      clean[id] = item;
    });
    if(Object.keys(data).length && !Object.keys(clean).length) throw new Error("Не найдены знакомые грамматические темы.");
    return clean;
  }
  function load(){
    try{progress = validateProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"))}catch(_error){progress = {}}
  }
  function save(next){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));progress = next;return true}
    catch(_error){message("Не удалось сохранить грамматику. Освободите место в браузере; ответ не был записан.",true);return false}
  }
  function message(text,error = false){
    if(!ui) return;
    ui.message.textContent = text;ui.message.classList.toggle("is-error",error);
  }
  function duration(ms){
    if(ms <= 0) return "сейчас";
    if(ms < 60*MINUTE) return `${Math.max(1,Math.ceil(ms/MINUTE))} мин`;
    if(ms < DAY) return `${Math.ceil(ms/(60*MINUTE))} ч`;
    return `${Math.ceil(ms/DAY)} дн`;
  }
  function category(p){
    if(!p?.startedAt) return "new";
    if(p.nextReviewAt <= Date.now()) return "due";
    return p.intervalMs >= 7*DAY ? "mastered" : "learning";
  }
  function renderMetrics(){
    const entries = Object.values(progress).filter(p=>p.startedAt>0),seen = entries.reduce((sum,p)=>sum+p.seen,0),correct = entries.reduce((sum,p)=>sum+p.correct,0);
    const values = [[entries.length,"Тем изучается"],[getDueLessonIds(progress).length,"К повторению"],
      [entries.filter(p=>category(p) === "mastered").length,"Закреплено"],[seen ? `${Math.round(correct/seen*100)}%` : "—","Без подсказок"]];
    ui.metrics.innerHTML = values.map(([value,label])=>`<div class="grammar-metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
    ui.review.textContent = `Повторить · ${getDueLessonIds(progress).length}`;
  }
  function renderMap(){
    const names = {new:"Новые",due:"К повторению",learning:"Изучаются",mastered:"Закреплены"};
    ui.mapFilters.innerHTML = "";
    [["all","Все темы"],...Object.entries(names)].forEach(([filter,title])=>{
      const button = document.createElement("button");button.type="button";button.className="grammar-group";
      const count = lessons.filter(lesson=>filter === "all" || category(progress[lesson.id]) === filter).length;
      button.textContent=`${title} · ${count}`;button.setAttribute("aria-pressed",String(filter === mapFilter));
      button.addEventListener("click",()=>{mapFilter=filter;renderMap()});ui.mapFilters.appendChild(button);
    });
    ui.mapLanes.innerHTML = "";
    Object.entries(GROUPS).filter(([key])=>key!=="all").forEach(([key,label],index)=>{
      const cards = lessons.filter(lesson=>lesson.group===key && (mapFilter==="all" || category(progress[lesson.id])===mapFilter));
      if(!cards.length) return;
      const lane=document.createElement("section");lane.className="grammar-map-lane";
      lane.innerHTML=`<h4><span>${index+1}</span>${label}<small>${cards.length} тем</small></h4>`;
      cards.forEach(lesson=>{
        const p=progress[lesson.id],status=category(p),total=getExercises(lesson).length,solved=p?.drillSolved?.length || 0;
        const label={new:"Новая тема",due:"Пора повторить",learning:"Изучается",mastered:"Закреплена"}[status];
        const button=document.createElement("button");button.type="button";button.className=`grammar-map-node ${status}`;button.dataset.lessonId=lesson.id;
        button.innerHTML=`<span class="grammar-map-node-top"><strong lang="ja">${escape(lesson.title)}</strong><i class="grammar-status-dot ${status}" aria-hidden="true"></i></span><span class="grammar-map-node-meaning">${escape(lesson.meaning)}</span><span class="grammar-map-node-status">${label}${p?.startedAt && status!=="due" ? ` · ${duration(p.nextReviewAt-Date.now())}` : ""}</span><span class="grammar-map-progress" role="progressbar" aria-label="Закрепление темы" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${solved}"><i style="width:${solved/total*100}%"></i></span><small>Закрепление ${solved}/${total} · ${lesson.examples.length} примеров</small>`;
        button.addEventListener("click",()=>{selectedId=lesson.id;setScreen("library")});lane.appendChild(button);
      });
      ui.mapLanes.appendChild(lane);
    });
    if(!ui.mapLanes.children.length) ui.mapLanes.innerHTML='<p class="grammar-note">В этой группе пока нет тем. Выберите другой фильтр.</p>';
  }
  function setScreen(screen,updateURL = true){
    clearTimeout(wakeTimer);stopAudio();session=null;currentScreen=screen;
    ui.map.hidden=screen!=="map";ui.layout.hidden=screen!=="library";ui.practice.hidden=true;
    ui.mapTab.setAttribute("aria-pressed",String(screen==="map"));ui.lessonsTab.setAttribute("aria-pressed",String(screen==="library"));
    renderMetrics();renderMap();renderLibrary();renderLesson();
    if(updateURL){
      const hash=screen==="map" ? "#grammar-map" : `#grammar/lesson/${encodeURIComponent(selectedId)}`;
      if(window.location.hash!==hash) window.history.pushState(null,"",hash);
    }
  }
  function applyRoute(){
    const match=window.location.hash.match(/^#grammar\/lesson\/([a-z0-9-]+)$/);
    if(match && knownIds.has(match[1])){selectedId=match[1];setScreen("library",false)}
    else setScreen(window.location.hash==="#grammar-lessons" ? "library" : "map",false);
  }
  function renderLibrary(){
    renderMetrics();ui.lessons.innerHTML = "";
    const matches = lessons.filter(lesson => (group === "all" || lesson.group === group)
      && (!query || `${lesson.title} ${lesson.meaning} ${lesson.explanation}`.toLowerCase().includes(query)));
    matches.forEach(lesson => {
      const status = category(progress[lesson.id]);
      const label = {new:"Новая тема",due:"К повторению",learning:"Изучается",mastered:"Закреплена"}[status];
      const button = document.createElement("button");
      button.type = "button";button.className = "grammar-lesson-button";button.dataset.lessonId = lesson.id;
      button.setAttribute("aria-pressed",String(selectedId === lesson.id));
      button.innerHTML = `<span class="grammar-lesson-number">${String(lessons.indexOf(lesson)+1).padStart(2,"0")}</span><span class="grammar-lesson-label"><strong>${escape(lesson.title)}</strong><small>${escape(lesson.meaning)} · ${label}</small></span><span class="grammar-status-dot ${status}" aria-hidden="true"></span>`;
      button.addEventListener("click",()=>{selectedId = lesson.id;setScreen("library")});
      ui.lessons.appendChild(button);
    });
    if(!matches.length) ui.lessons.innerHTML = '<p class="grammar-note">Темы не найдены. Попробуйте другое слово.</p>';
  }
  function renderLesson(){
    const lesson = lessons.find(item=>item.id === selectedId);
    if(!lesson){ui.detail.innerHTML = '<p class="grammar-note">Уроки не загрузились. Обновите страницу.</p>';return}
    const p = progress[lesson.id],started=!!p?.startedAt,due = started && getDueLessonIds(progress).includes(lesson.id);
    ui.detail.innerHTML = `<div class="grammar-detail-header"><div><h3>${escape(lesson.title)}</h3><p class="grammar-meaning">${escape(lesson.meaning)}</p></div><span class="grammar-level">${escape(lesson.level)}</span></div><p class="grammar-explanation">${escape(lesson.explanation)}</p><div class="grammar-form">${escape(lesson.form)}</div><div class="grammar-lesson-actions"><button class="grammar-secondary" id="grammarPracticeLesson" type="button">Закрепить · ${getExercises(lesson).length} заданий</button><button class="btn" id="grammarLearnLesson" type="button" ${started && !due ? "disabled" : ""}>${!started ? "Добавить к повторениям" : due ? "Повторить тему" : "Повтор пока не нужен"}</button></div><p class="grammar-note grammar-practice-note">Закрепление: выбор значения, выбор формы и ввод пропуска. Можно заниматься в любое время — расписание повторений не меняется.</p><h4 class="grammar-examples-title">Примеры в разных ситуациях · ${lesson.examples.length}</h4><div class="grammar-examples">${lesson.examples.map((example,index)=>`<div class="grammar-example"><div><strong lang="ja">${escape(example.jp)}</strong><small>${escape(example.ru)}</small></div><button class="grammar-speak" type="button" data-example="${index}" aria-label="Произнести пример ${index+1}">♪</button></div>`).join("")}</div><p class="grammar-schedule">${!started ? "Тема ещё не в расписании. Изучите примеры и добавьте её к повторениям, когда будете готовы." : `Ответов в повторениях: ${p.seen} · Без подсказок: ${p.correct} · Ошибок: ${p.lapses}<br>${due ? "Пора повторить" : `Следующий повтор через ${duration(p.nextReviewAt-Date.now())}`}`}<br>Закреплено заданий: ${p?.drillSolved?.length || 0}/${getExercises(lesson).length}. <a class="grammar-source" href="${escape(lesson.sourceUrl)}" target="_blank" rel="noopener noreferrer">Подробнее на Bunpro ↗</a></p>`;
    ui.detail.querySelectorAll("[data-example]").forEach(button=>button.addEventListener("click",()=>host?.speak(lesson.examples[Number(button.dataset.example)].jp,true)));
    ui.detail.querySelector("#grammarLearnLesson").addEventListener("click",()=>{
      if(!started && !save({...progress,[lesson.id]:{...p,...emptyProgress()}})) return;
      startReview(lesson.id);
    });
    ui.detail.querySelector("#grammarPracticeLesson").addEventListener("click",()=>startPractice(lesson.id));
  }
  function stopAudio(){audioToken++;host?.cancelSpeech()}
  function showLibrary(){
    setScreen("library");
  }
  function startReview(lessonId){
    stopAudio();clearTimeout(wakeTimer);
    const ids = getDueLessonIds(progress),selected = lessonId ? ids.filter(id=>id === lessonId) : ids;
    const queue=selected.map(id=>({lessonId:id,type:"fill",index:progress[id].questionCursor % lessons.find(lesson=>lesson.id===id).questions.length}));
    beginSession(queue,"review");
  }
  function startPractice(lessonId){
    selectedId=lessonId;
    const lesson=lessons.find(item=>item.id===lessonId),exercises=getExercises(lesson);
    const order=[0,1,7,2,3,8,4,5,6];
    const queue=order.map(index=>({lessonId,type:exercises[index].type,index:exercises[index].index}));
    beginSession(queue,"practice");
  }
  function beginSession(queue,kind){
    stopAudio();clearTimeout(wakeTimer);currentScreen="practice";
    session = {kind,queue,current:null,locked:false,completed:0,correct:0,hintUsed:false,composing:false};
    ui.map.hidden=true;ui.layout.hidden = true;ui.practice.hidden = false;nextQuestion();
  }
  function nextQuestion(){
    stopAudio();if(!session) return;
    session.current = session.queue.shift() || null;session.locked = false;session.hintUsed = false;session.composing = false;
    if(!session.current){renderFinish();return}
    const lesson = lessons.find(item=>item.id === session.current.lessonId);
    const question=getExercises(lesson).find(item=>item.type===session.current.type && item.index===session.current.index);
    const meaning=question.type==="meaning",fill=question.type==="fill";
    const options=(question.options || []).map((text,index)=>({text,index}));
    for(let index=options.length-1;index>0;index--){const other=Math.floor(Math.random()*(index+1));[options[index],options[other]]=[options[other],options[index]]}
    const prompt=meaning ? question.prompt : INSTRUCTIONS[lesson.id] || "Заполните пропуск по переводу.";
    const answerZone=fill ? '<form class="grammar-answer-form"><input id="grammarAnswer" type="text" placeholder="Ответ…" aria-label="Ответ на задание по грамматике" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn" type="submit">Проверить</button></form><p class="grammar-input-note">Можно вводить японскую запись или ромадзи. Для частицы темы допустимы ha и wa; для частицы объекта — wo и o.</p>'
      : `<div class="grammar-choice-list" role="group" aria-label="Варианты ответа">${options.map(option=>`<button type="button" class="grammar-choice" data-option-index="${option.index}">${escape(option.text)}</button>`).join("")}</div>`;
    ui.practice.innerHTML = `<div class="grammar-practice-head"><div><p class="grammar-eyebrow">${meaning ? "Значение правила" : fill ? "Введите пропуск" : "Выберите форму"}</p><h3>${session.kind==="practice" ? "Закрепление" : "Проверка памяти"} · N5</h3></div><span class="grammar-counter">Осталось ${session.queue.length+1}</span></div><p class="grammar-note">${escape(prompt)}</p><p class="grammar-sentence" lang="ja">${meaning ? escape(lesson.title) : `${escape(question.before)}<span class="grammar-blank">…</span>${escape(question.after)}`}</p>${meaning ? "" : `<p class="grammar-translation">${escape(question.translation)}</p>`}${answerZone}<details class="grammar-hint"><summary>Подсказка и правило</summary><p>${escape(question.hint || lesson.meaning)}</p><p><strong>${escape(lesson.title)}</strong> · ${escape(lesson.explanation)}</p></details><div class="grammar-feedback" hidden role="status" aria-live="polite"></div><div class="grammar-next-row"><button class="grammar-secondary" type="button" id="grammarBackToLessons">К урокам</button><span class="grammar-note">${session.kind==="practice" ? "Свободная практика не меняет расписание." : "После ошибки тема вернётся в этой сессии."}</span></div>`;
    const input = ui.practice.querySelector("input");
    if(input){
    if(active) input.focus({preventScroll:true});
    input.addEventListener("compositionstart",()=>{if(session) session.composing = true});
    input.addEventListener("compositionend",()=>{if(session) session.composing = false});
    input.addEventListener("keydown",event=>{
      if(event.key === "Enter" && (event.isComposing || event.keyCode === 229)) event.preventDefault();
    });
    ui.practice.querySelector("form").addEventListener("submit",event=>{event.preventDefault();checkAnswer(lesson,question,input)});
    }else{
      ui.practice.querySelectorAll(".grammar-choice").forEach(button=>button.addEventListener("click",()=>checkAnswer(lesson,question,null,Number(button.dataset.optionIndex))));
      if(active) ui.practice.querySelector(".grammar-choice").focus({preventScroll:true});
    }
    ui.practice.querySelector("details").addEventListener("toggle",event=>{if(session && event.target.open) session.hintUsed = true});
    ui.practice.querySelector("#grammarBackToLessons").addEventListener("click",showLibrary);
  }
  function checkAnswer(lesson,question,input,choiceIndex = null){
    if(!session || session.locked || session.composing) return;
    if(input && !input.value.trim()){input.focus();return}
    const ok = input ? isAnswerCorrect(input.value,question.answers) : choiceIndex===question.correctIndex;
    const usedHint = session.hintUsed || ui.practice.querySelector("details").open;
    let next;
    if(session.kind==="practice"){
      const previous=progress[lesson.id] || emptyProgress(0),solved=new Set(previous.drillSolved || []);
      if(ok && !usedHint) solved.add(question.key);
      next={...previous,practiceSeen:(previous.practiceSeen || 0)+1,practiceCorrect:(previous.practiceCorrect || 0)+Number(ok && !usedHint),lastPracticeAt:Date.now(),drillSolved:[...solved]};
    }else next = getNextProgress(progress[lesson.id],ok,Date.now(),usedHint);
    if(!save({...progress,[lesson.id]:next})) return;
    session.locked = true;session.completed++;
    if(ok){if(!usedHint) session.correct++}else session.queue.splice(Math.min(2,session.queue.length),0,session.current);
    if(input){input.disabled = true;ui.practice.querySelector("button[type=submit]").disabled = true}
    ui.practice.querySelectorAll(".grammar-choice").forEach(button=>{
      button.disabled=true;button.classList.toggle("is-correct",Number(button.dataset.optionIndex)===question.correctIndex);
      button.classList.toggle("is-wrong",!ok && Number(button.dataset.optionIndex)===choiceIndex);
    });
    const answer=question.options ? question.options[question.correctIndex] : question.answers[0];
    const blank = ui.practice.querySelector(".grammar-blank");if(blank){blank.textContent = answer;blank.classList.toggle("is-correct",ok)}
    const feedback = ui.practice.querySelector(".grammar-feedback");feedback.hidden = false;feedback.classList.toggle("is-wrong",!ok);
    const schedule=session.kind==="practice" ? "Свободное закрепление: расписание повторений не изменилось." : `Следующее повторение через ${duration(next.intervalMs)}.`;
    feedback.innerHTML = `<strong>${ok ? usedHint ? "Верно с подсказкой — попробуйте позже самостоятельно" : "Верно!" : `Правильный ответ: ${escape(answer)}`}</strong><p>${escape(question.explanation)}</p><p>${ok ? schedule : "Задание вернётся после других; если других нет — сразу следующим вопросом."}</p><button class="btn" id="grammarNextQuestion" type="button">Дальше →</button>`;
    feedback.querySelector("button").addEventListener("click",nextQuestion);feedback.querySelector("button").focus({preventScroll:true});
    renderMetrics();const token = ++audioToken;
    const speech=question.type==="meaning" ? lesson.examples[0].jp : question.before+answer+question.after;
    if(host?.soundEnabled()) Promise.resolve(host.tone(ok)).then(()=>{if(active && token === audioToken) return host.speak(speech,false)}).catch(()=>{});
  }
  function renderFinish(){
    clearTimeout(wakeTimer);renderMetrics();
    if(session?.kind==="practice"){
      const lesson=lessons.find(item=>item.id===selectedId),solved=progress[selectedId]?.drillSolved?.length || 0;
      ui.practice.innerHTML=`<div class="grammar-empty"><div class="grammar-hero-mark" aria-hidden="true">学</div><h3>Закрепление завершено</h3><p>${session.completed} ответов · ${session.correct} верно без подсказок.<br>По теме «${escape(lesson.title)}» закреплено ${solved}/${getExercises(lesson).length} заданий. Расписание повторений не изменилось.</p><button class="btn" type="button">К теме</button></div>`;
      ui.practice.querySelector("button").addEventListener("click",showLibrary);return;
    }
    const due = getDueLessonIds(progress),future = Object.values(progress).filter(p=>p.nextReviewAt>Date.now()).map(p=>p.nextReviewAt);
    const next = future.length ? Math.min(...future) : null;
    const results = session?.completed ? `${session.completed} ответов · ${session.correct} верно без подсказок. ` : "";
    ui.practice.innerHTML = `<div class="grammar-empty"><div class="grammar-hero-mark" aria-hidden="true">休</div><h3>${due.length ? "Доступны новые повторения" : "Все доступные повторения завершены"}</h3><p>${results}${due.length ? "Пора закрепить ещё несколько тем." : next ? `Приходите через ${duration(next-Date.now())}.` : "Выберите новую тему и изучите правило, чтобы начать."}</p><button class="btn" type="button">${due.length ? "Повторить сейчас" : "Выбрать урок"}</button></div>`;
    ui.practice.querySelector("button").addEventListener("click",due.length ? ()=>startReview() : showLibrary);
    if(active && next && !due.length) wakeTimer = window.setTimeout(renderFinish,Math.max(1000,Math.min(30000,next-Date.now()+50)));
  }
  function onViewChange(value){
    active = value;clearTimeout(wakeTimer);
    if(!value){stopAudio();return}
    if(!ui) return;
    if(currentScreen==="practice" && session){renderMetrics();if(!session.current) renderFinish();return}
    if(window.location.hash.startsWith("#grammar")) applyRoute();
    else setScreen("map");
  }
  function setProgress(data,options = {}){
    const clean = validateProgress(data);
    if(options.persist !== false && !save(clean)) return false;
    progress = clean;if(ui) setScreen(currentScreen==="practice" ? "map" : currentScreen,false);return true;
  }
  function reset(){
    if(!save({})) return false;clearTimeout(wakeTimer);
    if(ui){setScreen("map",active);message("Прогресс грамматики сброшен.")}return true;
  }
  function init(api){
    host = api;const id = name=>document.getElementById(name);
    ui = {metrics:id("grammarMetrics"),review:id("grammarReview"),lessons:id("grammarLessons"),detail:id("grammarLessonDetail"),
      layout:id("grammarLayout"),practice:id("grammarPractice"),message:id("grammarMessage"),groups:id("grammarGroups"),search:id("grammarSearch"),
      map:id("grammarMap"),mapFilters:id("grammarMapFilters"),mapLanes:id("grammarMapLanes"),mapTab:id("grammarMapTab"),lessonsTab:id("grammarLessonsTab")};
    load();
    Object.entries(GROUPS).forEach(([key,label])=>{
      const button = document.createElement("button");button.type = "button";button.className = "grammar-group";
      button.textContent = label;button.setAttribute("aria-pressed",String(group === key));
      button.addEventListener("click",()=>{group = key;ui.groups.querySelectorAll("button").forEach(item=>item.setAttribute("aria-pressed",String(item === button)));renderLibrary()});
      ui.groups.appendChild(button);
    });
    ui.search.addEventListener("input",()=>{query = ui.search.value.trim().toLowerCase();renderLibrary()});
    ui.mapTab.addEventListener("click",()=>setScreen("map"));
    ui.lessonsTab.addEventListener("click",()=>setScreen("library"));
    ui.review.addEventListener("click",()=>startReview());
    id("grammarExport").addEventListener("click",()=>{host.exportProgress();message("Резервная копия каны и грамматики сохранена.")});
    id("grammarImport").addEventListener("click",()=>host.importProgress());
    id("grammarReset").addEventListener("click",()=>{if(window.confirm("Сбросить только прогресс грамматики? Прогресс каны останется.")) reset()});
    const route=()=>{if(window.location.hash.startsWith("#grammar")){applyRoute();host?.openGrammar()}};
    window.addEventListener("hashchange",route);window.addEventListener("popstate",route);
    window.addEventListener("storage",event=>{
      if(event.key===STORAGE_KEY && !session){load();setScreen(currentScreen,false)}
    });
    setScreen("map",false);
    if(window.location.hash.startsWith("#grammar")) route();
  }
  window.KanaGrammar = {storageKey:STORAGE_KEY,init,onViewChange,getProgress:()=>JSON.parse(JSON.stringify(progress)),validateProgress,setProgress,reset,
    testing:{normalizeAnswer,isAnswerCorrect,getNextProgress,getDueLessonIds,getExercises}};
})();
