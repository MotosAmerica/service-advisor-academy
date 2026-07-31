// ==========================================================================
// Motos America Service Advisor Academy — Application logic
// Single-page app: no build step, no framework. Renders into #app.
// ==========================================================================

(function () {
  'use strict';

  const DATA = window.ACADEMY_DATA;
  const STORE_OPTIONS = ['Cascade Moto Portland', 'Tampa Bay Motos', 'Triumph of Santa Monica', 'Triumph Columbia River', 'MA Corporate'];
  const CORPORATE_STORE = 'MA Corporate';

  // ---------- Supabase client ----------
  let supabase = null;
  const supabaseReady =
    window.SUPABASE_URL &&
    window.SUPABASE_ANON_KEY &&
    !window.SUPABASE_URL.includes('YOUR_SUPABASE') &&
    !window.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');

  if (supabaseReady && window.supabase) {
    supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  }

  // ---------- Local session (who's logged in) ----------
  const SESSION_KEY = 'moto_academy_session';

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(trainee) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(trainee));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  // ---------- Local progress cache (works even if Supabase is offline) ----------
  // Keyed by trainee id. Each entry: { [quizKey]: {scorePct, correct, total, completedAt} }
  const PROGRESS_KEY = 'moto_academy_progress';

  function getLocalProgress(traineeId) {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      return all[traineeId] || {};
    } catch (e) {
      return {};
    }
  }

  function saveLocalProgress(traineeId, quizKey, result) {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      const all = raw ? JSON.parse(raw) : {};
      if (!all[traineeId]) all[traineeId] = {};
      all[traineeId][quizKey] = result;
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch (e) { /* ignore quota errors */ }
  }

  // ---------- Pending sync queue (for flaky connections) ----------
  // If a Supabase write fails, we queue it here and retry on next load / action.
  const QUEUE_KEY = 'moto_academy_pending_sync';

  function getQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function pushToQueue(item) {
    const q = getQueue();
    q.push(item);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  }

  function setQueue(items) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  }

  async function flushQueue() {
    if (!supabase) return;
    let queue = getQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        if (item.type === 'trainee') {
          await supabase.from('trainees').upsert(item.payload, { onConflict: 'id' });
        } else if (item.type === 'attempt') {
          await supabase.from('quiz_attempts').insert(item.payload);
        }
      } catch (e) {
        remaining.push(item);
      }
    }
    setQueue(remaining);
  }

  // Try to flush whenever we come back online
  window.addEventListener('online', flushQueue);

  // ---------- Router ----------
  // Route shape: { view: 'toc' | 'module' | 'quiz' | 'exam' | 'report' | 'login', ...params }
  let currentRoute = { view: 'login' };

  function navigate(route) {
    currentRoute = route;
    render();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ---------- Utility ----------
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (v !== null && v !== undefined) {
          node.setAttribute(k, v);
        }
      }
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Renders inline **bold** markers from the source content into <strong> tags safely.
  function renderInline(text) {
    const escaped = escapeHtml(text || '');
    return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function moduleByNum(num) {
    return DATA.modules.find((m) => m.num === num);
  }

  function quizKeyForModule(num) {
    return `module-${num}`;
  }

  function totalModuleCount() {
    return DATA.modules.length;
  }

  // Determines where "next" should go after a given module number, accounting
  // for Part boundaries: after the last module of a Part, "next" is that
  // Part's exam, not the next Part's Module 1. Returns a route object, a
  // label for the button, or null if there's truly nothing after (end of
  // Part II with no further content).
  function getNextDestination(num) {
    const current = moduleByNum(num);
    if (!current) return null;

    const next = moduleByNum(num + 1);
    if (next && next.part === current.part) {
      return { route: { view: 'module', num: next.num }, label: 'Next Module \u2192' };
    }

    // Last module of this Part — route to that Part's exam instead.
    const examPart = current.part;
    return {
      route: { view: 'exam', part: examPart },
      label: examPart === 'I' ? 'Take the Part I Exam \u2192' : 'Take the Part II Exam \u2192',
    };
  }

  // ==========================================================================
  // VIEW: Login
  // ==========================================================================

  function renderLogin(root) {
    const shell = el('div', { class: 'login-shell' });

    const logoWrap = el('div', { class: 'login-shell__logo' }, [
      el('img', { src: 'MA_logo_white_header.png', alt: 'Motos America' }),
    ]);
    shell.appendChild(logoWrap);

    const card = el('div', { class: 'login-card' });

    card.appendChild(el('div', { class: 'login-card__sub' }, ['Service Advisor Academy']));
    card.appendChild(el('div', { class: 'login-card__tag' }, ['Live the passion. Take the ride.']));

    let errorBox = null;

    const nameField = el('div', { class: 'field' }, [
      el('label', {}, ['Your full name']),
      el('input', { type: 'text', id: 'login-name', autocomplete: 'name', placeholder: 'e.g. Jordan Reyes' }),
    ]);

    const storeSelect = el('select', { id: 'login-store' }, [
      el('option', { value: '' }, ['Select your store...']),
      ...STORE_OPTIONS.map((s) => el('option', { value: s }, [s])),
    ]);
    const storeField = el('div', { class: 'field' }, [
      el('label', {}, ['Your store']),
      storeSelect,
    ]);

    const roleSelect = el('select', { id: 'login-role' }, [
      el('option', { value: 'service_advisor' }, ['Service Advisor']),
      el('option', { value: 'manager' }, ['Manager']),
    ]);
    const roleField = el('div', { class: 'field' }, [
      el('label', {}, ['Your role']),
      roleSelect,
    ]);

    // MA Corporate is Manager-only: lock the role dropdown to Manager and
    // disable it the moment that store is picked, so it's not even possible
    // to select something else in the UI.
    storeSelect.addEventListener('change', () => {
      if (storeSelect.value === CORPORATE_STORE) {
        roleSelect.value = 'manager';
        roleSelect.disabled = true;
      } else {
        roleSelect.disabled = false;
      }
    });

    const submitBtn = el('button', { class: 'btn btn--primary' }, ['Enter the Academy']);

    const form = el('div', {}, [nameField, storeField, roleField, submitBtn]);

    async function handleSubmit() {
      const name = document.getElementById('login-name').value.trim();
      const store = document.getElementById('login-store').value;
      let role = document.getElementById('login-role').value;

      if (errorBox) { errorBox.remove(); errorBox = null; }

      if (!name || name.length < 2) {
        errorBox = el('div', { class: 'login-error' }, ['Please enter your full name.']);
        form.insertBefore(errorBox, form.firstChild);
        return;
      }
      if (!store) {
        errorBox = el('div', { class: 'login-error' }, ['Please select your store.']);
        form.insertBefore(errorBox, form.firstChild);
        return;
      }
      // Hard enforcement, independent of the UI lock above — MA Corporate is
      // always Manager, even if the role field were tampered with.
      if (store === CORPORATE_STORE) {
        role = 'manager';
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing you in...';

      const trainee = await findOrCreateTrainee(name, store, role);

      setSession(trainee);
      navigate({ view: 'toc' });
    }

    submitBtn.addEventListener('click', handleSubmit);
    [nameField, storeField].forEach((f) => {
      f.querySelector('input,select').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleSubmit();
      });
    });

    card.appendChild(form);
    shell.appendChild(card);
    root.appendChild(shell);
  }

  // Looks up a trainee by name+store, or creates a new record. Falls back to a
  // local-only id if Supabase isn't configured or the network call fails, so
  // the app still works offline / before setup is complete.
  const ACADEMY = 'service_advisor';

  async function findOrCreateTrainee(name, store, role) {
    const localId = 'local-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + store.toLowerCase().replace(/\s+/g, '-');
    const fallback = { id: localId, full_name: name, store, role, academy: ACADEMY, _local: true };

    if (!supabase) return fallback;

    try {
      // Scoped to this academy — the shared project also holds Sales,
      // Parts & Accessories, etc. rows for people with the same name/store.
      const { data: existing, error: findErr } = await supabase
        .from('trainees')
        .select('*')
        .eq('full_name', name)
        .eq('store', store)
        .eq('academy', ACADEMY)
        .limit(1);

      if (findErr) throw findErr;

      if (existing && existing.length) {
        return existing[0];
      }

      const { data: created, error: createErr } = await supabase
        .from('trainees')
        .insert({ full_name: name, store, role, academy: ACADEMY })
        .select()
        .single();

      if (createErr) throw createErr;
      return created;
    } catch (e) {
      // Network/setup issue — queue a create attempt for later, and proceed
      // with a local id so the trainee isn't blocked from training today.
      pushToQueue({ type: 'trainee', payload: { id: undefined, full_name: name, store, role, academy: ACADEMY } });
      return fallback;
    }
  }

  // ==========================================================================
  // Shared: top bar
  // ==========================================================================

  function renderTopbar(root, trainee) {
    const bar = el('div', { class: 'topbar' });

    const brand = el('div', { class: 'topbar__brand', onclick: () => navigate({ view: 'toc' }) }, [
      el('img', {
        src: 'MA_logo_white_header.png',
        alt: 'Motos America',
        class: 'topbar__logo',
      }),
      el('div', { class: 'topbar__brand-sub' }, ['Service Advisor Academy']),
    ]);

    const menuBtn = el('button', { class: 'topbar__link topbar__menu-btn' }, ['\u2630 Modules']);
    const menuPanel = buildModuleMenuPanel();
    let menuOpen = false;

    function toggleMenu(force) {
      menuOpen = typeof force === 'boolean' ? force : !menuOpen;
      menuPanel.classList.toggle('module-menu--open', menuOpen);
    }

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });
    document.addEventListener('click', (e) => {
      if (menuOpen && !menuPanel.contains(e.target) && e.target !== menuBtn) {
        toggleMenu(false);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (menuOpen && e.key === 'Escape') {
        toggleMenu(false);
      }
    });

    const right = el('div', { class: 'topbar__right' });
    right.appendChild(el('span', { class: 'topbar__user' }, [`${trainee.full_name} · ${trainee.store}`]));
    right.appendChild(menuBtn);

    if (trainee.role === 'manager' || trainee.role === 'admin') {
      right.appendChild(el('button', { class: 'topbar__link', onclick: () => navigate({ view: 'report' }) }, ['Report']));
    }
    right.appendChild(el('button', { class: 'topbar__link', onclick: () => { clearSession(); navigate({ view: 'login' }); } }, ['Sign out']));

    bar.appendChild(brand);
    bar.appendChild(right);
    bar.appendChild(menuPanel);
    root.appendChild(bar);
  }

  // Dropdown panel listing every module (grouped by Part) plus both exams,
  // so a trainee can jump directly to any module from anywhere on the site —
  // e.g. to revisit one or look something up — without going back to the
  // dashboard first.
  function buildModuleMenuPanel() {
    const panel = el('div', { class: 'module-menu' });

    function goTo(route) {
      panel.classList.remove('module-menu--open');
      navigate(route);
    }

    const closeBtn = el('button', {
      class: 'module-menu__close',
      onclick: () => panel.classList.remove('module-menu--open'),
    }, ['\u2715 Close']);
    panel.appendChild(closeBtn);

    function buildGroup(label, mods) {
      const group = el('div', { class: 'module-menu__group' });
      group.appendChild(el('div', { class: 'module-menu__group-label' }, [label]));
      mods.forEach((m) => {
        group.appendChild(
          el('button', { class: 'module-menu__item', onclick: () => goTo({ view: 'module', num: m.num }) }, [
            el('span', { class: 'module-menu__item-num' }, [String(m.num).padStart(2, '0')]),
            el('span', {}, [m.title]),
          ])
        );
      });
      return group;
    }

    const partI = DATA.modules.filter((m) => m.part === 'I');
    const partII = DATA.modules.filter((m) => m.part === 'II');

    panel.appendChild(buildGroup('Part I \u2014 The Service Team', partI));
    panel.appendChild(
      el('button', { class: 'module-menu__item module-menu__item--exam', onclick: () => goTo({ view: 'exam', part: 'I' }) }, ['Part I Exam'])
    );
    panel.appendChild(buildGroup('Part II \u2014 The Elite Advisor', partII));
    panel.appendChild(
      el('button', { class: 'module-menu__item module-menu__item--exam', onclick: () => goTo({ view: 'exam', part: 'II' }) }, ['Part II Exam'])
    );

    return panel;
  }

  // ==========================================================================
  // VIEW: Table of Contents / Dashboard
  // ==========================================================================

  async function renderTOC(root, trainee) {
    renderTopbar(root, trainee);
    const page = el('div', { class: 'page' });
    page.appendChild(el('div', { class: 'loading' }, [el('div', { class: 'spinner' }), 'Loading your progress...']));
    root.appendChild(page);

    const progress = await fetchProgress(trainee.id);

    page.innerHTML = '';

    const partI = DATA.modules.filter((m) => m.part === 'I');
    const partII = DATA.modules.filter((m) => m.part === 'II');

    const doneCount = DATA.modules.filter((m) => isPassed(progress[quizKeyForModule(m.num)])).length;
    const exam1Done = !!progress['part1-exam'];
    const exam2Done = !!progress['part2-exam'];

    const hero = el('div', { class: 'hero' }, [
      el('div', { class: 'hero__eyebrow' }, ['Welcome back']),
      el('div', { class: 'hero__title' }, [trainee.full_name.split(' ')[0] + ', here\u2019s your training']),
      el('div', { class: 'hero__desc' }, ['Work through each module, then pass its 5-question review with a perfect score. Finish a Part to unlock its 20-question exam.']),
      el('div', { class: 'progress-summary' }, [
        el('div', { class: 'progress-chip' }, [el('strong', {}, [`${doneCount}/${totalModuleCount()}`]), 'modules passed']),
        el('div', { class: 'progress-chip' }, [el('strong', {}, [exam1Done ? '\u2713' : '\u2014']), 'Part I exam']),
        el('div', { class: 'progress-chip' }, [el('strong', {}, [exam2Done ? '\u2713' : '\u2014']), 'Part II exam']),
      ]),
    ]);
    page.appendChild(hero);

    function buildPartSection(label, title, mods, examKey, examTitle, examQuestions) {
      const section = el('div', { class: 'part-section' });
      section.appendChild(el('div', { class: 'part-section__header' }, [
        el('span', { class: 'part-section__label' }, [`Part ${label}`]),
        el('span', { class: 'part-section__title' }, [title]),
      ]));

      const list = el('div', { class: 'module-list' });
      mods.forEach((m) => {
        const key = quizKeyForModule(m.num);
        const result = progress[key];
        const passed = isPassed(result);
        const attempts = result ? (result.attempts || 1) : 0;
        let metaLabel;
        if (passed) {
          metaLabel = attempts > 1 ? `Passed \u00b7 ${attempts} attempts` : 'Passed \u00b7 1st attempt';
        } else if (result) {
          metaLabel = `Not yet \u00b7 ${result.correct}/${result.total} (attempt ${attempts})`;
        } else {
          metaLabel = 'Not started';
        }
        const card = el('button', { class: 'module-card' + (passed ? ' module-card--done' : ''), onclick: () => navigate({ view: 'module', num: m.num }) }, [
          el('div', { class: 'module-card__num' }, [String(m.num).padStart(2, '0')]),
          el('div', { class: 'module-card__body' }, [
            el('div', { class: 'module-card__title' }, [m.title]),
            el('div', { class: 'module-card__meta' }, [
              el('span', { class: 'status-pill ' + (passed ? 'status-pill--done' : 'status-pill--todo') }, [metaLabel]),
            ]),
          ]),
        ]);
        list.appendChild(card);
      });
      section.appendChild(list);

      const allModsDone = mods.every((m) => isPassed(progress[quizKeyForModule(m.num)]));
      const examResult = progress[examKey];
      const examCard = el('div', { class: 'exam-card' }, [
        el('div', {}, [
          el('div', { class: 'exam-card__title' }, [examTitle]),
          el('div', { class: 'exam-card__desc' }, [
            examResult
              ? `Completed \u00b7 Score: ${examResult.correct}/${examResult.total} (${Math.round(examResult.scorePct)}%)`
              : (allModsDone ? '20 questions \u00b7 ready when you are' : `Pass all ${mods.length} module reviews above (100% each) to unlock`),
          ]),
        ]),
        el('button', {
          class: 'btn btn--primary',
          disabled: !allModsDone,
          onclick: () => allModsDone && navigate({ view: 'exam', part: label }),
        }, [examResult ? 'Retake Exam' : 'Start Exam']),
      ]);
      section.appendChild(examCard);

      return section;
    }

    page.appendChild(buildPartSection('I', 'The Service Team', partI, 'part1-exam', 'Part I Exam \u2014 The Service Team', DATA.part1Exam));
    page.appendChild(buildPartSection('II', 'The Elite Advisor', partII, 'part2-exam', 'Part II Exam \u2014 The Elite Advisor', DATA.part2Exam));
  }

  // A module review only counts as "passed" at a perfect score. Part exams
  // don't use this — any completed attempt counts, since they aren't gated.
  function isPassed(result) {
    return !!result && result.correct === result.total;
  }

  // Fetches all quiz results for a trainee, merging Supabase (if available)
  // with anything cached locally (so results still show up if the network
  // request fails, e.g. flaky wifi on the showroom floor).
  async function fetchProgress(traineeId) {
    const local = getLocalProgress(traineeId);
    if (!supabase || traineeId.startsWith('local-')) return local;

    try {
      const { data, error } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('trainee_id', traineeId)
        .order('completed_at', { ascending: true });

      if (error) throw error;

      const merged = { ...local };
      (data || []).forEach((row) => {
        merged[row.quiz_key] = {
          correct: row.correct_answers,
          total: row.total_questions,
          scorePct: row.score_pct,
          completedAt: row.completed_at,
        };
      });
      return merged;
    } catch (e) {
      return local;
    }
  }

  // ==========================================================================
  // VIEW: Module reader
  // ==========================================================================

  function renderBlockToNode(b) {
    switch (b.type) {
      case 'part':
        if (/GOAL OF MODULE/i.test(b.title)) {
          return el('div', { class: 'block-goalhead' }, [b.title.toUpperCase()]);
        }
        return el('div', {}, [
          el('div', { class: 'block-part-num' }, [`Part ${b.num}`]),
          el('div', { class: 'block-part-title' }, [b.title]),
        ]);
      case 'goalhead':
        return el('div', { class: 'block-goalhead' }, [b.text.toUpperCase()]);
      case 'subhead':
        return el('div', { class: 'block-subhead' }, [b.text]);
      case 'emphasis':
        return el('p', { class: 'block-emphasis', html: renderInline(b.text) });
      case 'quote':
        return el('p', { class: 'block-quote', html: renderInline(b.text) });
      case 'bullets':
        return el('ul', { class: 'block-bullets' }, b.items.map((it) => el('li', { html: renderInline(it) })));
      case 'ordered':
        return el('ol', { class: 'block-ordered' }, b.items.map((it) => el('li', { html: renderInline(it) })));
      case 'para':
        return el('p', { class: 'block-para', html: renderInline(b.text) });
      default:
        return null;
    }
  }

  function renderModule(root, trainee, num) {
    renderTopbar(root, trainee);

    const m = moduleByNum(num);
    const videoId = window.MODULE_VIDEOS && window.MODULE_VIDEOS[num];

    if (!m) {
      const page = el('div', { class: 'page' });
      page.appendChild(el('div', { class: 'empty-state' }, ['Module not found.']));
      root.appendChild(page);
      return;
    }

    // Wider container when a video is present, so the split-screen has room
    // to breathe on desktop; same comfortable reading width otherwise.
    const page = el('div', { class: videoId ? 'page page--wide' : 'page' });

    const crumbs = el('div', { class: 'crumbs' }, [
      el('button', { onclick: () => navigate({ view: 'toc' }) }, ['Contents']),
      el('span', {}, ['/']),
      el('span', {}, [`Module ${String(m.num).padStart(2, '0')}`]),
    ]);
    page.appendChild(crumbs);

    const header = el('div', {}, [
      el('div', { class: 'module-header__eyebrow' }, [`Module ${String(m.num).padStart(2, '0')}`]),
      el('div', { class: 'module-header__title' }, [m.title]),
    ]);
    if (m.tagline) {
      header.appendChild(el('div', { class: 'module-header__tagline' }, [m.tagline]));
    }
    page.appendChild(header);

    const body = el('div', { class: 'module-body' });
    m.blocks.forEach((b) => {
      const node = renderBlockToNode(b);
      if (node) body.appendChild(node);
    });

    if (videoId) {
      // Split-screen: video pinned alongside the text on desktop, stacked
      // above it on narrow screens (handled in CSS, not here).
      const videoPane = el('div', { class: 'module-video-pane' }, [
        el('div', { class: 'module-video-wrap' }, [
          el('iframe', {
            src: `https://www.youtube-nocookie.com/embed/${videoId}`,
            title: `${m.title} — video`,
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            allowfullscreen: 'true',
            frameborder: '0',
          }),
        ]),
      ]);
      const textPane = el('div', { class: 'module-text-pane' }, [body]);
      const splitWrap = el('div', { class: 'module-split' }, [videoPane, textPane]);
      page.appendChild(splitWrap);
    } else {
      page.appendChild(body);
    }

    const nav = el('div', { class: 'module-nav' });
    const prevModule = moduleByNum(num - 1);
    const nextDest = getNextDestination(num);

    nav.appendChild(
      prevModule
        ? el('button', { class: 'btn btn--ghost', onclick: () => navigate({ view: 'module', num: prevModule.num }) }, ['\u2190 Previous Module'])
        : el('span', {})
    );
    nav.appendChild(
      el('button', { class: 'btn btn--primary', onclick: () => navigate({ view: 'quiz', num: m.num }) }, ['Take the Module Review \u2192'])
    );
    page.appendChild(nav);

    if (nextDest) {
      const skipLabel = nextDest.route.view === 'exam'
        ? (nextDest.route.part === 'I' ? 'Skip to Part I Exam \u2192' : 'Skip to Part II Exam \u2192')
        : 'Skip to Next Module \u2192';
      const nextRow = el('div', { style: 'text-align:right; margin-top:10px;' });
      nextRow.appendChild(el('button', { class: 'btn btn--ghost', onclick: () => navigate(nextDest.route) }, [skipLabel]));
      page.appendChild(nextRow);
    }

    root.appendChild(page);
  }


  // ==========================================================================
  // VIEW: Quiz (module review, 5 questions) and Exam (Part review, 20 questions)
  // ==========================================================================

  const LETTERS = ['A', 'B', 'C', 'D'];

  function renderQuizOrExam(root, trainee, opts) {
    // opts: { mode: 'quiz', num } or { mode: 'exam', part: 'I'|'II' }
    renderTopbar(root, trainee);
    const page = el('div', { class: 'page' });

    let questions, quizKey, quizLabel, backRoute, eyebrow, title, desc;

    if (opts.mode === 'quiz') {
      const m = moduleByNum(opts.num);
      questions = DATA.moduleQuizzes[String(opts.num)];
      quizKey = quizKeyForModule(opts.num);
      quizLabel = `Module ${String(opts.num).padStart(2, '0')} Review`;
      backRoute = { view: 'module', num: opts.num };
      eyebrow = `Module ${String(opts.num).padStart(2, '0')} Review`;
      title = 'Check Your Knowledge';
      desc = `Five questions on ${m.title}.`;
    } else {
      const isOne = opts.part === 'I';
      questions = isOne ? DATA.part1Exam : DATA.part2Exam;
      quizKey = isOne ? 'part1-exam' : 'part2-exam';
      quizLabel = isOne ? 'Part I Exam \u2014 The Service Team' : 'Part II Exam \u2014 The Elite Advisor';
      backRoute = { view: 'toc' };
      eyebrow = `Part ${opts.part} Exam`;
      title = isOne ? 'The Service Team' : 'The Elite Advisor';
      desc = '20 questions covering everything in this Part.';
    }

    const state = { answers: new Array(questions.length).fill(null), submitted: false };

    const header = el('div', { class: 'quiz-header' }, [
      el('div', { class: 'quiz-header__eyebrow' }, [eyebrow]),
      el('div', { class: 'quiz-header__title' }, [title]),
      el('div', { class: 'quiz-header__desc' }, [desc]),
    ]);
    page.appendChild(header);

    const progressBar = el('div', { class: 'quiz-progress' }, [el('div', { class: 'quiz-progress__bar', style: 'width:0%' })]);
    page.appendChild(progressBar);

    const questionsWrap = el('div', {});
    page.appendChild(questionsWrap);

    function updateProgress() {
      const answered = state.answers.filter((a) => a !== null).length;
      const pct = Math.round((answered / questions.length) * 100);
      progressBar.querySelector('.quiz-progress__bar').style.width = pct + '%';
    }

    function renderQuestions() {
      questionsWrap.innerHTML = '';
      questions.forEach((q, qIdx) => {
        const card = el('div', { class: 'question-card' });
        card.appendChild(el('div', { class: 'question-card__num' }, [`Question ${qIdx + 1} of ${questions.length}`]));
        card.appendChild(el('div', { class: 'question-card__text', html: renderInline(q.q) }));

        const list = el('div', { class: 'option-list' });
        const optionNodes = [];

        function classesFor(oIdx) {
          const isSelected = state.answers[qIdx] === oIdx;
          const isCorrectAnswer = oIdx === q.answer;
          let cls = 'option';
          if (state.submitted) {
            if (isCorrectAnswer) cls += ' correct';
            else if (isSelected && !isCorrectAnswer) cls += ' incorrect';
          } else if (isSelected) {
            cls += ' selected';
          }
          return cls;
        }

        q.options.forEach((opt, oIdx) => {
          const optionNode = el('label', { class: classesFor(oIdx) }, [
            el('span', { class: 'option__letter' }, [LETTERS[oIdx]]),
            el('span', { html: renderInline(opt) }),
          ]);

          if (!state.submitted) {
            optionNode.addEventListener('click', () => {
              state.answers[qIdx] = oIdx;
              updateProgress();
              // Update only this question's option classes in place —
              // no full re-render, so scroll position and other
              // questions' state stay untouched.
              optionNodes.forEach((node, i) => { node.className = classesFor(i); });
            });
          }
          optionNodes.push(optionNode);
          list.appendChild(optionNode);
        });
        card.appendChild(list);
        questionsWrap.appendChild(card);
      });
      updateProgress();
    }

    renderQuestions();

    const actions = el('div', { class: 'quiz-actions' });
    const submitBtn = el('button', { class: 'btn btn--primary' }, ['Submit Answers']);
    submitBtn.addEventListener('click', async () => {
      const unanswered = state.answers.filter((a) => a === null).length;
      if (unanswered > 0) {
        if (!confirm(`You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?`)) {
          return;
        }
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Scoring...';

      state.submitted = true;
      const correct = questions.reduce((sum, q, i) => sum + (state.answers[i] === q.answer ? 1 : 0), 0);
      const result = {
        correct,
        total: questions.length,
        scorePct: Math.round((correct / questions.length) * 1000) / 10,
        completedAt: new Date().toISOString(),
      };

      const savedResult = saveLocalProgress(trainee.id, quizKey, result);
      const attemptNumber = savedResult ? savedResult.attempts : 1;
      await recordAttempt(trainee, quizKey, quizLabel, questions, state.answers, result, attemptNumber);

      if (opts.mode === 'quiz') {
        renderModuleQuizResult(root, trainee, { result, attemptNumber, backRoute, opts });
      } else {
        renderQuizResults(root, trainee, { questions, answers: state.answers, result, quizLabel, backRoute, opts });
      }
    });
    actions.appendChild(submitBtn);
    page.appendChild(actions);

    root.appendChild(page);
  }

  async function recordAttempt(trainee, quizKey, quizLabel, questions, answers, result, attemptNumber) {
    const payload = {
      trainee_id: trainee.id,
      quiz_key: quizKey,
      quiz_label: quizLabel,
      total_questions: result.total,
      correct_answers: result.correct,
      score_pct: result.scorePct,
      answers: answers,
      attempt_number: attemptNumber || 1,
      completed_at: result.completedAt,
      academy: ACADEMY,
    };

    if (!supabase || trainee._local) {
      pushToQueue({ type: 'attempt', payload });
      return;
    }

    try {
      const { error } = await supabase.from('quiz_attempts').insert(payload);
      if (error) throw error;
      // A previously-queued trainee record may now be syncable too.
      flushQueue();
    } catch (e) {
      pushToQueue({ type: 'attempt', payload });
    }
  }

  // Module review result screen: mastery-gated. A perfect score is required
  // to move on; anything else withholds which answers were right/wrong and
  // sends the trainee back to re-read the module before they can retry —
  // this nudges toward actually re-reading rather than guess-and-check.
  function renderModuleQuizResult(root, trainee, ctx) {
    root.innerHTML = '';
    renderTopbar(root, trainee);
    const page = el('div', { class: 'page' });

    const { result, attemptNumber, backRoute, opts } = ctx;
    const passed = result.correct === result.total;

    const card = el('div', { class: 'result-card' });
    card.appendChild(el('div', { class: 'result-card__score' + (passed ? '' : ' result-card__score--fail') }, [`${result.correct}/${result.total}`]));
    card.appendChild(el('div', { class: 'result-card__label' }, [passed ? 'Passed' : `Not Yet \u00b7 Attempt ${attemptNumber}`]));

    if (passed) {
      card.appendChild(el('div', { class: 'result-card__msg' }, [
        'Nice work \u2014 perfect score. This module is locked in.',
      ]));
      const actions = el('div', { class: 'quiz-actions' });
      const nextDest = getNextDestination(opts.num);
      actions.appendChild(el('button', { class: 'btn btn--ghost' }, ['Back to Contents']));
      actions.querySelector('button').addEventListener('click', () => navigate({ view: 'toc' }));
      if (nextDest) {
        actions.appendChild(el('button', { class: 'btn btn--primary', onclick: () => navigate(nextDest.route) }, [nextDest.label]));
      }
      card.appendChild(actions);
    } else {
      card.appendChild(el('div', { class: 'result-card__msg' }, [
        'Not quite \u2014 every question needs to be correct to pass this review. Head back and re-read the module, then try again.',
      ]));
      const actions = el('div', { class: 'quiz-actions' });
      actions.appendChild(el('button', { class: 'btn btn--primary', onclick: () => navigate({ view: 'module', num: opts.num }) }, ['Review the Module \u2192']));
      card.appendChild(actions);
    }

    page.appendChild(card);
    root.appendChild(page);
  }

  function renderQuizResults(root, trainee, ctx) {
    root.innerHTML = '';
    renderTopbar(root, trainee);
    const page = el('div', { class: 'page' });

    const { questions, answers, result, backRoute } = ctx;
    const passed = result.scorePct >= 70;

    const card = el('div', { class: 'result-card' });
    card.appendChild(el('div', { class: 'result-card__score' + (passed ? '' : ' result-card__score--fail') }, [`${result.correct}/${result.total}`]));
    card.appendChild(el('div', { class: 'result-card__label' }, [`${result.scorePct}% Score`]));
    card.appendChild(el('div', { class: 'result-card__msg' }, [
      passed
        ? 'Nice work \u2014 that\u2019s a passing score. Review any missed questions below.'
        : 'Take another look at the module, then feel free to retake this review.',
    ]));

    const review = el('div', { class: 'result-review' });
    questions.forEach((q, i) => {
      const userAnswer = answers[i];
      const isCorrect = userAnswer === q.answer;
      const item = el('div', { class: 'result-review__item' });
      item.appendChild(el('div', { class: 'result-review__q' }, [`${i + 1}. ${q.q}`]));
      item.appendChild(el('div', { class: 'result-review__a ' + (isCorrect ? 'right' : 'wrong') }, [
        userAnswer === null
          ? `Not answered. Correct answer: ${LETTERS[q.answer]}. ${q.options[q.answer]}`
          : isCorrect
            ? `Correct: ${LETTERS[q.answer]}. ${q.options[q.answer]}`
            : `You chose ${LETTERS[userAnswer]}. ${q.options[userAnswer]} \u2014 Correct answer: ${LETTERS[q.answer]}. ${q.options[q.answer]}`,
      ]));
      review.appendChild(item);
    });
    card.appendChild(review);

    const actions = el('div', { class: 'quiz-actions' });
    actions.appendChild(el('button', { class: 'btn btn--ghost', onclick: () => navigate(backRoute) }, ['Back']));
    actions.appendChild(el('button', { class: 'btn btn--primary', onclick: () => navigate({ view: 'toc' }) }, ['Contents']));
    card.appendChild(actions);

    page.appendChild(card);
    root.appendChild(page);
  }


  // ==========================================================================
  // VIEW: Report (manager / admin) — who's registered, who's completed what
  // ==========================================================================

  async function renderReport(root, trainee) {
    renderTopbar(root, trainee);
    const page = el('div', { class: 'page page--wide' });

    if (trainee.role !== 'manager' && trainee.role !== 'admin') {
      page.appendChild(el('div', { class: 'empty-state' }, ['This report is only available to managers.']));
      root.appendChild(page);
      return;
    }

    page.appendChild(el('div', { class: 'hero__eyebrow' }, ['Manager view']));
    page.appendChild(el('div', { class: 'hero__title' }, ['Training Report']));

    // MA Corporate managers oversee every dealership, so their report always
    // shows all stores by default (with the option to still filter down).
    // Store-based managers also start on "All stores" but this comment exists
    // so a future edit doesn't accidentally scope MA Corporate down to just
    // its own "store" — that would hide every dealership's data from them.
    const isCorporateManager = trainee.store === CORPORATE_STORE;

    if (!supabase) {
      page.appendChild(el('div', { class: 'banner banner--warn' }, [
        'Supabase isn\u2019t configured yet, so this report only shows results saved on this device. Once Supabase is connected, this will show every trainee across every device.',
      ]));
    }

    if (isCorporateManager) {
      page.appendChild(el('div', { class: 'banner banner--info' }, [
        'You\u2019re viewing results from every store \u2014 MA Corporate managers see the full company-wide picture by default. Use the store filter below to narrow to one dealership.',
      ]));
    }

    const loadingEl = el('div', { class: 'loading' }, [el('div', { class: 'spinner' }), 'Loading report...']);
    page.appendChild(loadingEl);
    root.appendChild(page);

    const { trainees, attempts } = await fetchAllReportData(trainee.store);

    loadingEl.remove();

    const totalQuizzes = totalModuleCount() + 2; // 21 modules + 2 exams

    // Summary cards
    const completedAll = trainees.filter((t) => {
      const theirAttempts = attempts.filter((a) => a.trainee_id === t.id);
      const passedModules = new Set(
        theirAttempts
          .filter((a) => a.quiz_key.startsWith('module-') && a.correct_answers === a.total_questions)
          .map((a) => a.quiz_key)
      ).size;
      const hasExam1 = theirAttempts.some((a) => a.quiz_key === 'part1-exam');
      const hasExam2 = theirAttempts.some((a) => a.quiz_key === 'part2-exam');
      return passedModules === totalModuleCount() && hasExam1 && hasExam2;
    }).length;

    const summary = el('div', { class: 'report-summary-cards' }, [
      el('div', { class: 'summary-card' }, [el('div', { class: 'summary-card__num' }, [String(trainees.length)]), el('div', { class: 'summary-card__label' }, ['Registered'])]),
      el('div', { class: 'summary-card' }, [el('div', { class: 'summary-card__num' }, [String(completedAll)]), el('div', { class: 'summary-card__label' }, ['Fully Completed'])]),
      el('div', { class: 'summary-card' }, [el('div', { class: 'summary-card__num' }, [String(attempts.length)]), el('div', { class: 'summary-card__label' }, ['Total Attempts'])]),
    ]);
    page.appendChild(summary);

    // Controls
    const search = el('input', { type: 'text', placeholder: 'Search by name...' });
    const storeFilter = el('select', {}, [
      el('option', { value: '' }, ['All stores']),
      ...STORE_OPTIONS.map((s) => el('option', { value: s }, [s])),
    ]);
    const controls = el('div', { class: 'report-controls' }, [search, storeFilter]);
    page.appendChild(controls);

    const tableWrap = el('div', { class: 'report-table-wrap' });
    page.appendChild(tableWrap);

    function buildTable() {
      const q = search.value.trim().toLowerCase();
      const storeQ = storeFilter.value;

      const rows = trainees
        .filter((t) => (!q || t.full_name.toLowerCase().includes(q)) && (!storeQ || t.store === storeQ))
        .map((t) => {
          const theirAttempts = attempts.filter((a) => a.trainee_id === t.id);
          const moduleAttempts = theirAttempts.filter((a) => a.quiz_key.startsWith('module-'));

          // A module only counts as passed once a perfect-score attempt exists for it.
          const passedModuleKeys = new Set(
            moduleAttempts.filter((a) => a.correct_answers === a.total_questions).map((a) => a.quiz_key)
          );
          const modulesPassed = passedModuleKeys.size;

          // Total tries across all modules (attempted, not just passed) — a rough
          // "how much retrying is this person doing overall" signal.
          const totalModuleAttempts = moduleAttempts.length;

          // Highest attempt count needed to pass any single module, e.g. "took 4
          // tries on their hardest module" — surfaces who's struggling, not just who's slow.
          let maxAttemptsToPass = 0;
          passedModuleKeys.forEach((key) => {
            const attemptsForKey = moduleAttempts.filter((a) => a.quiz_key === key);
            const passingAttempt = attemptsForKey.find((a) => a.correct_answers === a.total_questions);
            const triesNeeded = passingAttempt ? passingAttempt.attempt_number : 1;
            if (triesNeeded > maxAttemptsToPass) maxAttemptsToPass = triesNeeded;
          });

          const exam1 = theirAttempts.find((a) => a.quiz_key === 'part1-exam');
          const exam2 = theirAttempts.find((a) => a.quiz_key === 'part2-exam');
          const avgScore = theirAttempts.length
            ? Math.round(theirAttempts.reduce((s, a) => s + Number(a.score_pct), 0) / theirAttempts.length)
            : null;
          const lastActive = theirAttempts.length
            ? theirAttempts.reduce((latest, a) => (a.completed_at > latest ? a.completed_at : latest), theirAttempts[0].completed_at)
            : null;

          return { t, modulesPassed, totalModuleAttempts, maxAttemptsToPass, exam1, exam2, avgScore, lastActive };
        });

      tableWrap.innerHTML = '';
      if (!rows.length) {
        tableWrap.appendChild(el('div', { class: 'empty-state' }, ['No trainees match this filter yet.']));
        return;
      }

      const table = el('table', { class: 'report-table' });
      const thead = el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Name']),
          el('th', {}, ['Store']),
          el('th', {}, ['Role']),
          el('th', {}, ['Modules Passed']),
          el('th', {}, ['Total Attempts']),
          el('th', {}, ['Most Tries on One Module']),
          el('th', {}, ['Part I Exam']),
          el('th', {}, ['Part II Exam']),
          el('th', {}, ['Avg Score']),
          el('th', {}, ['Last Active']),
        ]),
      ]);
      table.appendChild(thead);

      const tbody = el('tbody', {});
      rows.forEach(({ t, modulesPassed, totalModuleAttempts, maxAttemptsToPass, exam1, exam2, avgScore, lastActive }) => {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [t.full_name]),
          el('td', {}, [t.store]),
          el('td', {}, [t.role || 'service_advisor']),
          el('td', {}, [`${modulesPassed}/${totalModuleCount()}`]),
          el('td', {}, [String(totalModuleAttempts)]),
          el('td', {}, [maxAttemptsToPass ? `${maxAttemptsToPass}\u00d7` : '\u2014']),
          el('td', {}, [exam1 ? `${exam1.correct_answers}/${exam1.total_questions}` : '\u2014']),
          el('td', {}, [exam2 ? `${exam2.correct_answers}/${exam2.total_questions}` : '\u2014']),
          el('td', {}, [avgScore !== null ? `${avgScore}%` : '\u2014']),
          el('td', {}, [lastActive ? new Date(lastActive).toLocaleDateString() : '\u2014']),
        ]));
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    }

    buildTable();
    search.addEventListener('input', buildTable);
    storeFilter.addEventListener('change', buildTable);
  }

  async function fetchAllReportData(managerStore) {
    if (!supabase) {
      return { trainees: [], attempts: [] };
    }
    try {
      const { data: trainees, error: tErr } = await supabase
        .from('trainees')
        .select('*')
        .eq('academy', ACADEMY)
        .order('created_at', { ascending: false });
      if (tErr) throw tErr;
      const { data: attempts, error: aErr } = await supabase
        .from('quiz_attempts')
        .select('*')
        .eq('academy', ACADEMY);
      if (aErr) throw aErr;
      return { trainees: trainees || [], attempts: attempts || [] };
    } catch (e) {
      return { trainees: [], attempts: [] };
    }
  }

  // ==========================================================================
  // Main render dispatcher
  // ==========================================================================

  function render() {
    const root = document.getElementById('app');
    root.innerHTML = '';

    const trainee = getSession();

    if (!trainee && currentRoute.view !== 'login') {
      currentRoute = { view: 'login' };
    }

    switch (currentRoute.view) {
      case 'login':
        renderLogin(root);
        break;
      case 'toc':
        renderTOC(root, trainee);
        break;
      case 'module':
        renderModule(root, trainee, currentRoute.num);
        break;
      case 'quiz':
        renderQuizOrExam(root, trainee, { mode: 'quiz', num: currentRoute.num });
        break;
      case 'exam':
        renderQuizOrExam(root, trainee, { mode: 'exam', part: currentRoute.part });
        break;
      case 'report':
        renderReport(root, trainee);
        break;
      default:
        renderLogin(root);
    }
  }

  // ==========================================================================
  // Init
  // ==========================================================================

  document.addEventListener('DOMContentLoaded', () => {
    const existing = getSession();
    currentRoute = existing ? { view: 'toc' } : { view: 'login' };
    render();
    flushQueue();
  });
})();
