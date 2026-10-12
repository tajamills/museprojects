import { SafeAreaTopScrim } from "./client-helpers";

export type LegalKind = "terms" | "privacy";

const LAST_UPDATED = "October 11, 2026";

function LegalShell({ kind, children }: { kind: LegalKind; children: React.ReactNode }) {
  const title = kind === "terms" ? "Terms of Service" : "Privacy Policy";
  return (
    <div className="landing-shell">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="landing-header">
        <div className="landing-brand"><a href="/" className="brand-home" aria-label="zepostia home"><strong>zepostia</strong></a></div>
        <nav className="landing-nav" aria-label="Primary">
          <a href="/#how-it-works">Product</a>
          <a href="/#pricing">Pricing</a>
        </nav>
      </header>
      <main className="landing-main legal-main">
        <article className="legal-doc">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
          {children}
        </article>
      </main>
      <footer className="landing-footer">
        <div className="footer-brand"><strong>zepostia</strong></div>
        <p>&copy; 2026 zepostia. All rights reserved.</p>
        <nav aria-label="Footer"><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>
      </footer>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalShell kind="terms">
      <section>
        <h2>1. The service</h2>
        <p>
          zepostia (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides a social media scheduling and publishing tool.
          After you connect your accounts, you can write a post once and publish it to any combination of
          Facebook, Instagram, TikTok, YouTube, and X, either immediately or on a schedule you choose.
          The service is provided through our website at zepostia.com.
        </p>
      </section>
      <section>
        <h2>2. Your account</h2>
        <p>
          You must be at least 18 years old to use zepostia. You are responsible for keeping your account
          credentials confidential and for all activity that happens under your account. Tell us right away
          if you believe your account has been compromised.
        </p>
      </section>
      <section>
        <h2>3. Subscription and billing</h2>
        <p>
          zepostia costs <strong>$19.88 per month</strong>. New accounts receive a <strong>14-day free trial</strong>.
          A payment method is collected at checkout and you will not be charged until the trial period ends.
          If you cancel during the trial, you pay nothing.
        </p>
        <p>
          After the trial, your card is charged $19.88 each month until you cancel. Billing is handled
          securely by our payment processor, Stripe. We do not store your full card details on our servers.
        </p>
      </section>
      <section>
        <h2>4. Posting limits</h2>
        <p>
          To keep the service sustainable and within each platform&rsquo;s usage policies, the following
          monthly limits apply per user, resetting on the first day of each calendar month:
        </p>
        <ul>
          <li><strong>X:</strong> 60 successful posts per calendar month.</li>
          <li><strong>TikTok:</strong> 60 successful posts per calendar month.</li>
        </ul>
        <p>
          Scheduled posts and posts to Facebook, Instagram, and YouTube are not subject to these caps.
          Only posts that publish successfully count toward the limit.
        </p>
      </section>
      <section>
        <h2>5. Your content and responsibilities</h2>
        <p>You own the content you post through zepostia. By using the service you agree that:</p>
        <ul>
          <li>You have all rights necessary to publish the content, including any images, video, music, or text.</li>
          <li>Your content will comply with the terms of service and community guidelines of each platform you publish to.</li>
          <li>You will not use zepostia to post unlawful, harassing, hateful, deceptive, or infringing content, or spam.</li>
          <li>You will not attempt to abuse, overload, or circumvent the posting limits or the service itself.</li>
        </ul>
      </section>
      <section>
        <h2>6. Platform connections</h2>
        <p>
          zepostia connects to social platforms using their official OAuth login flows. You log in on each
          platform&rsquo;s own website and grant zepostia permission to publish on your behalf. zepostia never
          sees or stores your social media passwords.
        </p>
        <p>
          Platforms may change their APIs, revoke access, or limit functionality at any time. If a platform
          disconnects your account or rejects a post, we will show you the reason they returned. We cannot
          publish to a platform you have not connected or that has revoked our access.
        </p>
      </section>
      <section>
        <h2>7. Cancellation and refunds</h2>
        <p>
          You may cancel your subscription at any time through the billing portal in your account settings.
          Cancellation takes effect at the end of your current billing period; you keep access until then.
          We do not offer refunds for partial months.
        </p>
      </section>
      <section>
        <h2>8. Service availability</h2>
        <p>
          We work to keep zepostia reliable, but the service is provided on a best-effort basis. We are not
          liable for interruptions caused by third-party platform outages, API changes, or maintenance on
          Facebook, Instagram, TikTok, YouTube, or X. Scheduled posts depend on those platforms accepting
          them at publish time.
        </p>
      </section>
      <section>
        <h2>9. Termination</h2>
        <p>
          We may suspend or terminate your account if you violate these terms, abuse the service, or use it
          in a way that harms other users or the platforms we integrate with. You may delete your account
          at any time; doing so removes your stored OAuth tokens and scheduled posts.
        </p>
      </section>
      <section>
        <h2>10. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, zepostia&rsquo;s total liability for any claim arising
          from your use of the service is limited to the amount you paid us in the twelve months before
          the claim. We are not liable for indirect, incidental, or consequential damages, including lost
          revenue from posts that fail to publish.
        </p>
      </section>
      <section>
        <h2>11. Changes to these terms</h2>
        <p>
          We may update these terms from time to time. If we make material changes, we will notify you
          through the service or by email before they take effect. Continued use of zepostia after changes
          take effect means you accept the updated terms.
        </p>
      </section>
      <section>
        <h2>12. Contact</h2>
        <p>Questions about these terms? Email us at our support page.</p>
      </section>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell kind="privacy">
      <section>
        <h2>1. What we collect</h2>
        <p>We collect only the information needed to run the service:</p>
        <ul>
          <li><strong>Account information:</strong> your name, email address, and password (stored as a secure hash).</li>
          <li><strong>Connected social accounts:</strong> the account names, IDs, and profile details returned by each platform when you connect.</li>
          <li><strong>OAuth tokens:</strong> the access and refresh tokens issued by each platform after you authorize zepostia. These let us publish on your behalf.</li>
          <li><strong>Post content:</strong> the text, images, and videos you compose, plus scheduling choices and publishing history.</li>
          <li><strong>Usage data:</strong> basic logs of actions you take in the app (posts created, connections added) used to operate and improve the service.</li>
          <li><strong>Payment information:</strong> handled by Stripe. We receive confirmation of your subscription status but never see or store your full card number.</li>
        </ul>
      </section>
      <section>
        <h2>2. How we use your information</h2>
        <p>We use your information to provide the service you signed up for:</p>
        <ul>
          <li>Publishing and scheduling your posts to the platforms you connected.</li>
          <li>Managing your account, subscription, and billing through Stripe.</li>
          <li>Showing you the status of your connections and posts.</li>
          <li>Detecting abuse and keeping the service secure.</li>
        </ul>
        <p>We do not sell your personal information, and we do not use your content for advertising.</p>
      </section>
      <section>
        <h2>3. OAuth tokens: how they are stored and used</h2>
        <p>
          When you connect a social account, you log in on that platform&rsquo;s own website &mdash;
          zepostia <strong>never sees your social media passwords</strong>. The platform gives us an
          OAuth access token, which we store <strong>encrypted</strong> in our database.
        </p>
        <p>
          These tokens are used for one purpose only: publishing and scheduling the posts you create,
          to the accounts you connected. We do not use them to read your private messages, post anything
          you did not ask us to post, or access data beyond what is needed to publish.
        </p>
      </section>
      <section>
        <h2>4. Who we share data with</h2>
        <p>We share data only as needed to provide the service:</p>
        <ul>
          <li><strong>The platforms you connect</strong> (Meta/Facebook and Instagram, TikTok, Google/YouTube, X) receive your post content when you publish, as you instructed.</li>
          <li><strong>Stripe</strong> processes your subscription payments.</li>
        </ul>
        <p>
          We do not share your data with advertisers, data brokers, or any other third party. We may
          disclose information if required by law or to protect the safety and integrity of the service.
        </p>
      </section>
      <section>
        <h2>5. Data retention and deletion</h2>
        <p>
          Disconnecting a social account immediately deletes the OAuth tokens for that account from our
          systems. Deleting your zepostia account removes your profile, connected accounts, tokens, posts,
          and scheduled content. Some billing records may be retained as required by law or by our payment
          processor.
        </p>
      </section>
      <section>
        <h2>6. Your rights</h2>
        <p>You can at any time:</p>
        <ul>
          <li>View the accounts you have connected and the posts you have published from your dashboard.</li>
          <li>Disconnect any social account, which removes its stored tokens.</li>
          <li>Cancel your subscription and request deletion of your account and data by emailing us.</li>
        </ul>
        <p>To exercise any of these rights, email our support page.</p>
      </section>
      <section>
        <h2>7. Security</h2>
        <p>
          We use industry-standard measures to protect your data, including encrypted token storage,
          hashed passwords, and encrypted connections (HTTPS) for all traffic. No method of transmission
          over the internet is completely secure, but we work to keep your information safe.
        </p>
      </section>
      <section>
        <h2>8. Children</h2>
        <p>zepostia is not intended for anyone under 18, and we do not knowingly collect information from children.</p>
      </section>
      <section>
        <h2>9. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. If we make material changes, we will notify you
          through the service or by email before they take effect.
        </p>
      </section>
      <section>
        <h2>10. Contact</h2>
        <p>Questions about your privacy? Email us at our support page.</p>
      </section>
    </LegalShell>
  );
}
