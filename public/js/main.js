/* ============================================
   AK FÜZYON - Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize all modules
  ThemeToggle.init();
  HeroSlider.init();
  StickyHeader.init();
  MobileMenu.init();
  ScrollAnimations.init();
  
  // Trigger theme-specific entry animation
  document.body.classList.add('is-loaded');
  
  // Fix for position: fixed elements (like WhatsApp & Chatbot) breaking due to body transform
  document.body.addEventListener('animationend', (e) => {
    if (e.target === document.body) {
      document.body.style.animation = 'none';
      document.body.style.opacity = '1';
      document.body.style.transform = 'none';
      document.body.style.filter = 'none';
    }
  });
});

/* ============================================
   THEME TOGGLE (Dark / Light Mode)
   ============================================ */
const ThemeToggle = {
  init() {
    this.toggle = document.getElementById('theme-toggle');
    if (!this.toggle) return;

    // Load saved theme
    const savedTheme = localStorage.getItem('ak-fuzyon-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Toggle event
    this.toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('ak-fuzyon-theme', next);

      // Add a subtle rotation animation
      this.toggle.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        this.toggle.style.transform = '';
      }, 500);
    });
  }
};

/* ============================================
   HERO SLIDER
   ============================================ */
const HeroSlider = {
  currentSlide: 0,
  slideCount: 0,
  interval: null,
  autoplayDelay: 5000,

  init() {
    this.slides = document.querySelectorAll('.hero__slide');
    this.dots = document.querySelectorAll('.hero__dot');
    this.prevBtn = document.getElementById('hero-prev');
    this.nextBtn = document.getElementById('hero-next');

    if (!this.slides.length) return;

    this.slideCount = this.slides.length;

    // Controls
    if (this.prevBtn) {
      this.prevBtn.addEventListener('click', () => {
        this.prev();
        this.resetAutoplay();
      });
    }

    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', () => {
        this.next();
        this.resetAutoplay();
      });
    }

    // Dots
    this.dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.dot);
        this.goTo(index);
        this.resetAutoplay();
      });
    });

    // Start autoplay
    this.startAutoplay();

    // Pause on hover
    const hero = document.getElementById('hero');
    if (hero) {
      hero.addEventListener('mouseenter', () => this.stopAutoplay());
      hero.addEventListener('mouseleave', () => this.startAutoplay());
    }
  },

  goTo(index) {
    // Remove active from current
    this.slides[this.currentSlide].classList.remove('active');
    if (this.dots[this.currentSlide]) {
      this.dots[this.currentSlide].classList.remove('active');
    }

    // Set new
    this.currentSlide = index;

    // Add active to new
    this.slides[this.currentSlide].classList.add('active');
    if (this.dots[this.currentSlide]) {
      this.dots[this.currentSlide].classList.add('active');
    }
  },

  next() {
    const nextIndex = (this.currentSlide + 1) % this.slideCount;
    this.goTo(nextIndex);
  },

  prev() {
    const prevIndex = (this.currentSlide - 1 + this.slideCount) % this.slideCount;
    this.goTo(prevIndex);
  },

  startAutoplay() {
    this.stopAutoplay();
    this.interval = setInterval(() => this.next(), this.autoplayDelay);
  },

  stopAutoplay() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  },

  resetAutoplay() {
    this.stopAutoplay();
    this.startAutoplay();
  }
};

/* ============================================
   STICKY HEADER
   ============================================ */
const StickyHeader = {
  init() {
    this.header = document.getElementById('header');
    if (!this.header) return;

    let lastScroll = 0;

    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;

      if (scrollY > 50) {
        this.header.classList.add('scrolled');
      } else {
        this.header.classList.remove('scrolled');
      }

      lastScroll = scrollY;
    }, { passive: true });
  }
};

/* ============================================
   MOBILE MENU
   ============================================ */
const MobileMenu = {
  init() {
    this.toggle = document.getElementById('mobile-toggle');
    this.menu = document.getElementById('nav-menu');
    this.overlay = document.getElementById('mobile-overlay');

    if (!this.toggle || !this.menu) return;

    this.toggle.addEventListener('click', () => this.toggleMenu());

    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.closeMenu());
    }

    // Close on link click
    const links = this.menu.querySelectorAll('.nav__link');
    links.forEach(link => {
      link.addEventListener('click', () => this.closeMenu());
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeMenu();
    });
  },

  toggleMenu() {
    this.toggle.classList.toggle('active');
    this.menu.classList.toggle('open');
    if (this.overlay) {
      this.overlay.classList.toggle('active');
    }
    document.body.style.overflow = this.menu.classList.contains('open') ? 'hidden' : '';
  },

  closeMenu() {
    this.toggle.classList.remove('active');
    this.menu.classList.remove('open');
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
    document.body.style.overflow = '';
  }
};

/* ============================================
   SCROLL ANIMATIONS (Intersection Observer)
   ============================================ */
const ScrollAnimations = {
  init() {
    const elements = document.querySelectorAll('.animate-on-scroll');

    if (!elements.length) return;

    // Check if IntersectionObserver is supported
    if (!('IntersectionObserver' in window)) {
      // Fallback: just show everything
      elements.forEach(el => el.classList.add('animated'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animated');
          observer.unobserve(entry.target); // Only animate once
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(el => observer.observe(el));
  }
};

/* ============================================
   SMOOTH SCROLL FOR ANCHOR LINKS
   ============================================ */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const targetId = this.getAttribute('href');
    if (targetId === '#') return;

    const target = document.querySelector(targetId);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});
