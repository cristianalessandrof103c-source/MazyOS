document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- nav scroll state + mobile menu ---------- */
const nav = document.getElementById('nav');
const navLinks = document.querySelector('.nav-links');
const navBurger = document.getElementById('navBurger');

window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

navBurger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});
navLinks.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => navLinks.classList.remove('open'));
});

/* ---------- scroll reveal ---------- */
const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const delay = el.closest('.steps, .cards') ? (Array.from(el.parentElement.children).indexOf(el) * 90) : 0;
      setTimeout(() => el.classList.add('in-view'), delay);
      revealObserver.unobserve(el);
    }
  });
}, { threshold: 0.15 });
revealEls.forEach(el => revealObserver.observe(el));

/* ---------- animated counters ---------- */
const counters = document.querySelectorAll('.stat-num');
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const target = parseInt(el.dataset.count, 10);
    const duration = 1200;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    counterObserver.unobserve(el);
  });
}, { threshold: 0.5 });
counters.forEach(el => counterObserver.observe(el));

/* ---------- cursor glow ---------- */
const glow = document.getElementById('cursorGlow');
let glowX = window.innerWidth / 2, glowY = window.innerHeight / 2;
let targetX = glowX, targetY = glowY;
const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

if (hasFinePointer) {
  window.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  });
  function animateGlow() {
    glowX += (targetX - glowX) * 0.12;
    glowY += (targetY - glowY) * 0.12;
    glow.style.transform = `translate(${glowX}px, ${glowY}px)`;
    requestAnimationFrame(animateGlow);
  }
  animateGlow();
} else {
  glow.style.display = 'none';
}

/* ---------- magnetic buttons ---------- */
if (hasFinePointer) {
  document.querySelectorAll('.magnetic').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0, 0)';
    });
  });
}

/* ---------- particle network background ---------- */
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let w, h;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function initParticles() {
  const count = Math.min(70, Math.floor((w * h) / 22000));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r: Math.random() * 1.6 + 0.6
  }));
}
initParticles();
window.addEventListener('resize', initParticles);

function step() {
  ctx.clearRect(0, 0, w, h);
  const maxDist = 140;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > w) p.vx *= -1;
    if (p.y < 0 || p.y > h) p.vy *= -1;
  }

  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDist) {
        ctx.strokeStyle = `rgba(139,92,246,${(1 - dist / maxDist) * 0.15})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(34,211,238,0.5)';
    ctx.fill();
  }

  if (!reducedMotion) requestAnimationFrame(step);
}
step();

/* ---------- CTA form ---------- */
const ctaForm = document.getElementById('ctaForm');
ctaForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = ctaForm.querySelector('button[type="submit"]');
  const originalText = btn.textContent;

  const nome = ctaForm.nome.value.trim();
  const empresa = ctaForm.empresa.value.trim();
  const email = ctaForm.email.value.trim();
  const whatsapp = ctaForm.whatsapp.value.trim();
  const mensagem = ctaForm.mensagem.value.trim();

  const linhas = [
    'Olá, quero agendar meu diagnóstico.',
    '',
    `Nome: ${nome}`,
    `Empresa: ${empresa}`,
    `E-mail: ${email}`,
    `WhatsApp: ${whatsapp}`,
  ];
  if (mensagem) linhas.push(`O que está travando: ${mensagem}`);

  window.open(`https://wa.me/556376042989?text=${encodeURIComponent(linhas.join('\n'))}`, '_blank');

  btn.textContent = 'Enviado — vamos te chamar em breve';
  btn.style.opacity = '0.75';
  btn.disabled = true;
  ctaForm.reset();
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.opacity = '1';
    btn.disabled = false;
  }, 4000);
});
