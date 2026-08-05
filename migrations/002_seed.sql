INSERT INTO projects (slug, title, summary, description, tags, is_draft, sort_order)
VALUES
(
  'aws-solutions-architect-capstone',
  'AWS Solutions Architect Capstone',
  'A multi-account AWS Organizations build for a fictional company, with a real on-prem Palo Alto firewall bridged in over Site-to-Site VPN.',
  'Write-up in progress - full HLD/LLD, architecture diagrams, and design decisions coming once the capstone is complete. This site is itself deployed on that architecture.',
  ARRAY['AWS','Networking','Security','IAM'],
  TRUE,
  0
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO projects (slug, title, summary, description, tags, is_draft, sort_order)
VALUES
(
  'xp-network-infrastructure',
  'XP.NETWORK - Company Infrastructure & Operations',
  'Owned security, cloud infrastructure, and operations for a multi-chain NFT bridge startup that raised ~$6M and supported 30+ blockchains.',
  'Over four years, took ownership of the company''s AWS infrastructure (S3, CloudFront, Certificate Manager, DNS), Google Workspace administration, access control and 2FA across every company system, and a 24/7 community operations team spanning multiple countries. Ran cost audits that cut ~$8,000/month in unused services, and managed the technical side of onboarding 19 blockchain integration grants end-to-end.',
  ARRAY['AWS','Security','Operations','DNS'],
  FALSE,
  1
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO projects (slug, title, summary, description, tags, is_draft, sort_order)
VALUES
(
  'wordpress-vulnerability-scanner',
  'WordPress Vulnerability Scanner',
  'A free scanning tool that flagged security and SEO issues on live WordPress sites, used to open direct relationships with companies to help them fix what it found.',
  'Worked across product and go-to-market: gave the developers direct feedback on the scanning product, ran the scans, and handled outreach to the businesses whose sites were flagged - including live conversations with digital and executive leadership at several well-known Israeli companies.',
  ARRAY['WordPress','Security','B2B'],
  FALSE,
  2
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO projects (slug, title, summary, description, tags, is_draft, sort_order)
VALUES
(
  'live-fundraising-payment-systems',
  'Live TV Fundraising Payment Infrastructure',
  'Built and ran the payment and data pipeline behind nationally televised fundraising campaigns processing donations in real time at high volume.',
  'Owned the end-to-end donation flow: a landing page funneling traffic from the foundation''s domains, an iframed secure payment step, a real-time dashboard tracking donations across currencies, and coordination with credit card suppliers to keep capacity available during live broadcast spikes. Also owned QA and full data reconciliation and export for every campaign.',
  ARRAY['Payments','Real-time','QA'],
  FALSE,
  3
)
ON CONFLICT (slug) DO NOTHING;
