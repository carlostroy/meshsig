/* =========================================================
   Ricardo Almeida — interações suaves
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* ---- Loader ---- */
  const loader = document.getElementById('loader');
  window.addEventListener('load', () => {
    setTimeout(() => loader.classList.add('is-done'), 500);
  });
  // fallback caso o load demore
  setTimeout(() => loader.classList.add('is-done'), 2500);

  /* ---- Nav: muda ao rolar ---- */
  const nav = document.getElementById('nav');
  const onScroll = () => {
    nav.classList.toggle('is-scrolled', window.scrollY > 60);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- Menu mobile ---- */
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  toggle.addEventListener('click', () => links.classList.toggle('is-open'));
  links.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => links.classList.remove('is-open'))
  );

  /* ---- Reveal ao entrar na viewport ---- */
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        // pequeno escalonamento entre elementos vizinhos
        entry.target.style.transitionDelay = `${(i % 4) * 90}ms`;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach(el => io.observe(el));

  /* ---- Contadores animados ---- */
  const counters = document.querySelectorAll('.stat__num');
  const countIO = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.count);
      const isDecimal = target % 1 !== 0;
      const duration = 1600;
      const start = performance.now();
      const tick = now => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        el.textContent = isDecimal ? val.toFixed(1).replace('.', ',') : Math.round(val);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      obs.unobserve(el);
    });
  }, { threshold: 0.6 });
  counters.forEach(c => countIO.observe(c));

  /* ---- Parallax leve no hero ---- */
  const heroImg = document.querySelector('.hero__media img');
  if (heroImg && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y < window.innerHeight) heroImg.style.transform = `translateY(${y * 0.18}px) scale(1.05)`;
    }, { passive: true });
  }

  /* ---- Formulário (mock) ---- */
  const form = document.getElementById('contactForm');
  const feedback = document.getElementById('formFeedback');
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    feedback.hidden = false;
    form.querySelector('button').textContent = 'Enviado';
    setTimeout(() => {
      form.reset();
      feedback.hidden = true;
      form.querySelector('button').textContent = 'Enviar mensagem';
    }, 4000);
  });

  /* ---- Carrossel da história (Quem é a Borah) ---- */
  const carousel = document.getElementById('carousel');
  if (carousel) {
    const track = document.getElementById('cTrack');
    const slides = Array.from(track.children);
    const prev = document.getElementById('cPrev');
    const next = document.getElementById('cNext');
    const dotsWrap = document.getElementById('cDots');
    const curEl = document.getElementById('cCur');
    const total = slides.length;
    let index = 0;
    let timer = null;

    // dots
    slides.forEach((_, i) => {
      const b = document.createElement('button');
      b.setAttribute('aria-label', 'Ir para o slide ' + (i + 1));
      b.addEventListener('click', () => { go(i); restart(); });
      dotsWrap.appendChild(b);
    });
    const dots = Array.from(dotsWrap.children);

    function go(i) {
      index = (i + total) % total;
      track.style.transform = `translateX(${-index * 100}%)`;
      dots.forEach((d, k) => d.classList.toggle('is-active', k === index));
      curEl.textContent = index + 1;
    }
    const nextSlide = () => go(index + 1);
    const prevSlide = () => go(index - 1);

    next.addEventListener('click', () => { nextSlide(); restart(); });
    prev.addEventListener('click', () => { prevSlide(); restart(); });

    // teclado
    carousel.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { nextSlide(); restart(); }
      if (e.key === 'ArrowLeft') { prevSlide(); restart(); }
    });
    carousel.setAttribute('tabindex', '0');

    // swipe / arrasto
    let startX = null;
    const vp = document.getElementById('cViewport');
    vp.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    vp.addEventListener('touchend', e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) { dx < 0 ? nextSlide() : prevSlide(); restart(); }
      startX = null;
    });

    // autoplay suave com pausa na interação
    function start() { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(nextSlide, 6000); }
    function stop() { clearInterval(timer); }
    function restart() { stop(); start(); }
    carousel.addEventListener('mouseenter', stop);
    carousel.addEventListener('mouseleave', start);

    go(0);
    start();
  }
});
