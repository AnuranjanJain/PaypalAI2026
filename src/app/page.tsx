"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./landing.css";

const steps = [
  { kicker: "Brief", title: "Shape the Pact", copy: "Turn a brief into clear milestones, acceptance criteria, and payment amounts everyone can see." },
  { kicker: "Evidence", title: "Prove the work", copy: "Providers attach links, files, and notes to the exact milestone they completed." },
  { kicker: "Review", title: "Review together", copy: "Pact checks objective requirements, while the owner keeps the final human decision." },
  { kicker: "Pay", title: "Pay with PayPal", copy: "Approve the milestone, capture the buyer payment in Sandbox, and keep the ledger honest." },
];

function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`landing-reveal ${className}`}>{children}</div>;
}

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code")) return;

    // Older Supabase email templates can redirect to the site URL instead of
    // the callback allowlist entry. Move that one-time code to the exchange route.
    const callback = new URL("/auth/callback", window.location.origin);
    callback.search = window.location.search;
    window.location.replace(callback.toString());
  }, []);

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".landing-reveal"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.12, rootMargin: "0px 0px -36px" });
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".landing-page");
    const faq = document.querySelector<HTMLElement>("#faq");
    if (!page || !faq) return;

    const updateFooterReveal = () => {
      const faqBottom = faq.getBoundingClientRect().bottom;
      page.classList.toggle("footer-revealed", faqBottom <= window.innerHeight);
    };

    updateFooterReveal();
    window.addEventListener("scroll", updateFooterReveal, { passive: true });
    window.addEventListener("resize", updateFooterReveal);
    return () => {
      window.removeEventListener("scroll", updateFooterReveal);
      window.removeEventListener("resize", updateFooterReveal);
    };
  }, []);

  return (
    <main className="landing-page">
      <div className="landing-atmosphere" aria-hidden="true" />
      <nav className="landing-nav" aria-label="Main navigation">
        <Link href="/" className="landing-brand">
          <span className="landing-brand-mark"><Image src="/pact-supplied-icon.png" alt="" width={34} height={34} priority /></span>
          <span>PayPal <strong>Pact</strong></span>
        </Link>
        <div className="landing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#for-teams">For teams</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="landing-nav-actions">
          <Link href="/login?mode=signin" className="landing-login">Sign in</Link>
          <Link href="/login?mode=signup" className="landing-nav-cta">Get started <span aria-hidden="true">↗</span></Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-glow landing-hero-glow-one" aria-hidden="true" />
        <div className="landing-hero-glow landing-hero-glow-two" aria-hidden="true" />
        <div className="landing-container landing-hero-grid">
          <Reveal className="landing-hero-copy">
            <div className="landing-live"><span /> PayPal-powered milestone payments</div>
            <h1>Make progress<br /><em>payable.</em></h1>
            <p className="landing-hero-lede">Pact turns project work into a clear, reviewable agreement. Providers get paid for verified progress. Owners keep control at every step.</p>
            <div className="landing-hero-actions">
              <Link href="/login?mode=signup" className="landing-primary-cta">Create your first Pact <span aria-hidden="true">→</span></Link>
              <Link href="/walkthrough" className="landing-secondary-cta"><span className="play-icon" aria-hidden="true">▶</span> See the walkthrough</Link>
            </div>
            <div className="landing-proof"><div className="proof-avatars"><span>AN</span><span>SN</span><span>+</span></div><p>Built for owners, freelancers, and real work.</p></div>
          </Reveal>
          <Reveal className="landing-hero-visual">
            <div className="hero-orbit hero-orbit-one" aria-hidden="true" /><div className="hero-orbit hero-orbit-two" aria-hidden="true" />
            <div className="hero-product-card">
              <div className="hero-product-top"><span className="hero-window-dots"><i /><i /><i /></span><span className="hero-product-label">PACT_8F2A <b>ACTIVE</b></span></div>
              <div className="hero-product-title"><div><span>BRAND IDENTITY KIT</span><h2>Four milestones.<br />One clear agreement.</h2></div><span className="hero-product-amount">$1,000<small>USD · SANDBOX</small></span></div>
              <div className="hero-timeline"><div className="hero-track" /><div className="hero-step complete"><b>✓</b><span><strong>30%</strong><small>Discovery</small></span></div><div className="hero-step current"><b>2</b><span><strong>50%</strong><small>Concepts</small></span></div><div className="hero-step"><b>3</b><span><strong>75%</strong><small>Revision</small></span></div><div className="hero-step"><b>4</b><span><strong>100%</strong><small>Final kit</small></span></div></div>
              <div className="hero-review-row"><span className="hero-check-mark">✦</span><div><strong>Two-step verification</strong><small>Delivery Agent checked · Owner review next</small></div><span className="hero-review-status">READY</span></div>
              <div className="hero-payment-row"><span>Next payment</span><strong>$200.00</strong><span className="hero-payment-pill">REVIEW</span></div>
            </div>
            <div className="hero-float-card hero-float-card-left"><span className="float-icon float-icon-green">✓</span><div><strong>Evidence accepted</strong><small>2 minutes ago</small></div></div>
            <div className="hero-float-card hero-float-card-right"><span className="float-icon float-icon-blue">$</span><div><strong>PayPal capture</strong><small>Owner approved</small></div></div>
          </Reveal>
        </div>
        <div className="landing-container landing-scroll-cue"><span>Scroll to explore</span><i /></div>
      </section>

      <section className="landing-trust-strip"><div className="landing-container trust-inner"><span>A PAYMENT RHYTHM FOR</span><div><strong>Independent teams</strong><strong>Creative studios</strong><strong>Client work</strong><strong>Human review</strong></div></div></section>

      <section id="how-it-works" className="landing-section landing-how"><div className="landing-container">
        <Reveal className="section-heading"><span className="section-index">The loop</span><h2>Work that moves.<br /><em>Money that follows.</em></h2><p>Every Pact makes the next action obvious, from the first brief to the final PayPal capture.</p></Reveal>
        <div className="landing-step-grid">{steps.map((step) => <Reveal className="landing-step" key={step.kicker}><span className="step-kicker">{step.kicker}</span><div className="step-line" aria-hidden="true"><span /></div><h3>{step.title}</h3><p>{step.copy}</p><span className="step-arrow" aria-hidden="true">↗</span></Reveal>)}</div>
      </div></section>

      <section id="for-teams" className="landing-section landing-for-teams"><div className="landing-container landing-split">
        <Reveal className="section-heading"><span className="section-index">One Pact, two views</span><h2>Less chasing.<br /><em>More shipping.</em></h2><p>One shared timeline gives both sides confidence without adding another status meeting.</p><Link href="/login?mode=signup" className="text-cta">Build a Pact <span>→</span></Link></Reveal>
        <Reveal className="persona-panel"><div className="persona-tabs"><span className="persona-tab active">Owner view</span><span className="persona-tab">Provider view</span></div><div className="persona-body"><div className="persona-icon">✦</div><div><span className="persona-label">OWNER CONFIRMS</span><h3>See exactly what unlocks the next payment.</h3><p>Review evidence, request a revision, or approve the milestone when the work is ready.</p></div><div className="persona-metric"><strong>2 / 2</strong><span>checks complete</span></div></div><div className="persona-bottom"><span><i className="dot dot-green" /> Evidence reviewed</span><span><i className="dot dot-blue" /> $200 ready to capture</span><span className="persona-chevron">→</span></div></Reveal>
      </div></section>

      <section className="landing-section landing-principles"><div className="landing-container"><Reveal className="principles-heading"><span className="section-index">Why Pact</span><h2>Trust is a<br /><em>product feature.</em></h2></Reveal><div className="principles-grid"><Reveal className="principle-card principle-card-dark"><span className="principle-icon">◒</span><h3>Progressive by design</h3><p>Break a big agreement into smaller, visible decisions. Cash flow follows real progress.</p></Reveal><Reveal className="principle-card"><span className="principle-icon principle-icon-blue">⌁</span><h3>Evidence over promises</h3><p>Keep files, links, notes, and review outcomes attached to the milestone they explain.</p></Reveal><Reveal className="principle-card"><span className="principle-icon principle-icon-green">✓</span><h3>Humans stay accountable</h3><p>AI can surface objective signals. The project owner makes the acceptance decision.</p></Reveal></div></div></section>

      <section className="landing-section landing-final-cta"><div className="landing-container final-cta-inner"><Reveal><span className="section-index">Start with the work</span><h2>A better agreement<br /><em>starts here.</em></h2><p>Create a workspace, invite a provider, and make your next milestone clear.</p><div className="landing-hero-actions"><Link href="/login?mode=signup" className="landing-primary-cta">Create your first Pact <span aria-hidden="true">→</span></Link><Link href="/login?mode=signin" className="landing-secondary-cta">I already have an account</Link></div></Reveal><Reveal className="final-mark"><Image src="/pact-logo.png" alt="PayPal Pact" width={190} height={190} /></Reveal></div></section>

      <section id="faq" className="landing-faq"><div className="landing-container faq-grid"><Reveal className="section-heading"><span className="section-index">Questions</span><h2>Good to<br /><em>know.</em></h2><p>Short answers for the first conversation.</p></Reveal><Reveal className="faq-list">{[{ q: "Is Pact a legal escrow service?", a: "No. Pact is a hackathon MVP for milestone-controlled payment workflows. PayPal Sandbox handles the buyer payment state; it does not claim legal escrow." }, { q: "Who approves a milestone?", a: "The Delivery Agent can check objective evidence, but the project owner always makes the final acceptance decision." }, { q: "Can I use Pact with a provider today?", a: "Yes. Create an account, make a workspace, draft a Pact, and invite a provider by email. The current release supports the core setup flow." }, { q: "What happens when payout access is unavailable?", a: "Checkout and provider payout remain separate states. Pact shows payout as pending or blocked until PayPal confirms the capability." }].map((item, index) => <div className={`faq-item ${openFaq === index ? "open" : ""}`} key={item.q}><button onClick={() => setOpenFaq(openFaq === index ? null : index)} aria-expanded={openFaq === index}><span>{item.q}</span><i aria-hidden="true">{openFaq === index ? "−" : "+"}</i></button><div className="faq-answer"><p>{item.a}</p></div></div>)}</Reveal></div></section>

      <footer className="landing-footer">
        <div className="landing-container footer-inner">
          <div className="footer-topline"><span className="footer-orbit" aria-hidden="true" /> <span>Progressive settlement for human work.</span></div>
          <div className="footer-main">
            <Link href="/" className="landing-brand"><span className="landing-brand-mark"><Image src="/pact-supplied-icon.png" alt="" width={34} height={34} /></span><span>PayPal <strong>Pact</strong></span></Link>
            <div className="footer-links">
              <div><strong>Product</strong><Link href="/walkthrough">How it works</Link><Link href="/login?mode=signup">Create a Pact</Link><Link href="/login?mode=signin">Sign in</Link></div>
              <div><strong>Resources</strong><a href="#for-teams">For teams</a><a href="#faq">FAQ</a><Link href="/walkthrough">Walkthrough</Link></div>
              <div><strong>Workspace</strong><Link href="/workspace">Open workspace</Link><Link href="/login?mode=signup">Get started</Link><a href="#how-it-works">The loop</a></div>
            </div>
          </div>
          <div className="footer-bottom"><span>© 2026 PayPal Pact</span><span>Built for owners, providers, and real work.</span><span>PayPal Sandbox · Hackathon MVP</span></div>
        </div>
      </footer>
    </main>
  );
}
