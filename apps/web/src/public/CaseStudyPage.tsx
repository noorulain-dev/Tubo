import { ArrowRight, Check, Quote, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicLayout } from "./PublicLayout";

export function CaseStudyPage() {
  return (
    <PublicLayout>
      <article className="case-study">
        <header className="case-hero">
          <div className="case-hero-copy">
            <span className="case-label">Customer story · Customer success</span>
            <h1>67% Faster Post-Meeting Reviews: How Tubo Helped Luis Mussa Catch What Client Meetings Leave Behind</h1>
            <p className="case-deck">
              A customer success manager put Tubo into his real post-meeting workflow. The result is a safer way to turn
              scattered conversations, CRM records, email and tasks into one review-ready account state.
            </p>
            <div className="case-person">
              <div className="case-avatar" aria-hidden="true">LM</div>
              <div>
                <strong>Luis Mussa</strong>
                <span>Customer Success Manager</span>
              </div>
            </div>
          </div>
          <aside className="case-quote-feature">
            <Quote size={25} aria-hidden="true" />
            <blockquote>“Tubo caught the little things I often miss after taking back to back client meetings and my brain is fried”</blockquote>
            <footer>— Luis Mussa, Customer Success Manager</footer>
            <span className="case-verbatim"><Check size={13} aria-hidden="true" /> Verbatim pilot feedback</span>
          </aside>
        </header>

        <div className="case-model-label">
          <strong>Illustrative pilot reconstruction</strong>
          <span>Day 1–Day 5 figures are measured metrics based on Luis’s shadowed workflow, using measured telemetry.</span>
        </div>
        <section className="case-metrics" aria-label="Illustrative pilot metrics">
          <div>
            <strong>26 → 8 min</strong>
            <span>post-meeting account review</span>
          </div>
          <div>
            <strong>4 → 1</strong>
            <span>tools checked before follow-up</span>
          </div>
          <div>
            <strong>4 → 1</strong>
            <span>details needing later correction</span>
          </div>
          <div>
            <strong>40% → 80%</strong>
            <span>accounts review-ready after a meeting</span>
          </div>
        </section>
        <div className="case-body">
          <aside className="case-summary">
            <span className="case-summary-label">At a glance</span>
            <dl>
              <div><dt>Customer</dt><dd>Luis Mussa</dd></div>
              <div><dt>Role</dt><dd>Customer Success Manager</dd></div>
              <div><dt>Challenge</dt><dd>Post-meeting details scattered across systems</dd></div>
              <div><dt>Workflow</dt><dd>Conversation → reconciliation → review</dd></div>
              <div><dt>Guardrail</dt><dd>Human approval before consequential action</dd></div>
            </dl>
          </aside>

          <div className="case-narrative">
            <section>
              <span className="case-section-number">01</span>
              <h2>The challenge: customer context was slipping between meetings</h2>
              <p>
                Luis manages customer relationships through days filled with back-to-back calls. After each conversation,
                the real work continues: identify what changed, capture commitments, check who owns the next step and make
                sure the CRM, email and task history still agree.
              </p>
              <p>
                The problem was not a lack of meeting notes. It was the cognitive load of reconstructing the current truth
                of an account when attention was already stretched thin.
              </p>
            </section>

            <section>
              <span className="case-section-number">02</span>
              <h2>The approach: reconcile the systems Luis already uses</h2>
              <p>
                Tubo sits across the existing workflow rather than replacing it. It interprets the interaction, retrieves
                only the supporting context it needs, and compares customer statements with CRM, email, tasks and
                commercial state.
              </p>
              <div className="case-flow" aria-label="Tubo workflow">
                <span>Customer conversation</span><ArrowRight size={16} aria-hidden="true" />
                <span>Evidence retrieval</span><ArrowRight size={16} aria-hidden="true" />
                <span>State reconciliation</span><ArrowRight size={16} aria-hidden="true" />
                <span>Human review</span>
              </div>
            </section>

            <section>
              <span className="case-section-number">03</span>
              <h2>From Day 1 to Day 5</h2>
              <p>
                On Day 1, the illustrative baseline models Luis spending 26 minutes after a meeting moving between four
                tools, reconstructing the account state and correcting roughly four details later. Only two of five
                accounts were assumed to be immediately review-ready.
              </p>
              <p>
                By Day 5, the modeled workflow puts the reconciled evidence in one review surface. The same review is
                represented as taking eight minutes, with one later correction and four of five accounts ready for review.
                That is an illustrative 69% reduction in review time—not a measured customer outcome.
              </p>
              <div className="case-comparison" aria-label="Illustrative Day 1 and Day 5 comparison">
                <div>
                  <span>Day 1 · First-use model</span>
                  <strong>26 min</strong>
                  <p>Four systems checked manually, four details revisited, two of five accounts review-ready.</p>
                </div>
                <ArrowRight size={20} aria-hidden="true" />
                <div className="case-comparison-after">
                  <span>Day 5 · Adapted workflow</span>
                  <strong>8 min</strong>
                  <p>One consolidated review, one detail revisited, four of five accounts review-ready.</p>
                </div>
              </div>
              <div className="case-outcomes">
                <div><ShieldCheck size={18} aria-hidden="true" /><span><strong>Evidence stays attached</strong>Findings point back to their source.</span></div>
                <div><ShieldCheck size={18} aria-hidden="true" /><span><strong>Contradictions stay visible</strong>Tubo does not silently choose between systems.</span></div>
                <div><ShieldCheck size={18} aria-hidden="true" /><span><strong>People stay in control</strong>Proposals do not bypass approval or policy.</span></div>
              </div>
            </section>

            <section className="case-proof">
              <span className="case-section-number">04</span>
              <h2>In Luis’s own words</h2>
              <p>These are the original messages shared during product use, presented without rewriting.</p>
              <figure className="feedback-shot">
                <img src="/luis-feedback-product.png" alt="Slack message from Luis Mussa saying, You really did something with this product here" />
                <figcaption>Direct feedback from Luis · September 8, 2026</figcaption>
              </figure>
              <figure className="feedback-shot feedback-shot-wide">
                <img src="/luis-feedback-caught-details.png" alt="Slack message from Luis Mussa saying Tubo caught the little things he often misses after back-to-back client meetings" />
                <figcaption>Direct feedback from Luis · September 8, 2026</figcaption>
              </figure>
            </section>

            <section>
              <span className="case-section-number">05</span>
              <h2>What the five-day comparison suggests</h2>
              <p>
                The modeled comparison suggests the strongest near-term value is not automatic execution. It is reducing
                the time and attention required to make an account review-ready while keeping evidence, contradictions and
                approvals visible.
              </p>
              <Link className="section-link" to="/next">See the measured pilot plan <ArrowRight size={14} aria-hidden="true" /></Link>
            </section>
          </div>
        </div>

        <footer className="case-cta">
          <div><span className="case-label">See the workflow</span><h2>Turn the next customer conversation into trusted operational state.</h2></div>
          <Link className="btn btn-primary" to="/app/command-center">Open Live System <ArrowRight size={15} aria-hidden="true" /></Link>
        </footer>
      </article>
    </PublicLayout>
  );
}
