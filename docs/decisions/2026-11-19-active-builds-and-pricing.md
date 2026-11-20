# Decision: BounceOS approved as active build; launch pricing approved - 2026-11-19

Context: BounceOS (bounce house & party rental SaaS) is being built in this repo. The default
rule allows one product in active build at a time; Avenue Vision is also in active work.
Pricing was proposed from competitor research (docs/research/01-competitor-software.md):
per-item price creep is the top operator complaint, and booking fees in the market run 0.25–1%.

Options considered:
A) BounceOS only; park other products.
B) BounceOS + Avenue Vision both active.
C) Pause BounceOS.

Decision (approved by James):
- B: BounceOS and Avenue Vision are both active builds. AvenueOS, FranchiseOS and Avenue Connect stay parked/discovery.
- Pricing (src/lib/plans.ts):
  - Starter $49/mo + 0.9% booking fee; Pro $129/mo + 0.6%; Elite $299/mo + 0.4%. No per-item or per-seat pricing.
  - Marketplace fee 10%, only on bookings the BounceOS marketplace originated.
  - Referral commission 20% of the referred operator's subscription for 12 months.
  - Partner overflow share 10% (default, per partnership).
  - Managed ads fee 15% / 12% / 10% of spend by plan.
  - 30-day free trial, no card.

Why: flat pricing directly answers the #1 complaint; low booking fees match accepted market levels while
funding the platform; growth revenue (marketplace, referrals, ads) only earns when operators earn.

Revisit if: two active builds slip client commitments inside 7 days; trial→paid conversion or take
rate falls short at the first 10 operators; a competitor moves to flat pricing below Starter.

Still open (need James's approval): production deploy + domains, live credentials,
publishing the competitor comparison page.
