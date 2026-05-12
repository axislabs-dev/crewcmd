# Fastlane Competitor Notes

Screenshots captured: 2026-05-12

Source folder: `screenshots/`

Fastlane is an AI UGC / influencer content platform focused on fast, short-form marketing content. The product narrows the user into three main output formats:

- Wall of text with video behind it
- Green screen meme / creator-style video
- Carousel / slideshow posts

The strongest part of the experience is not just generation. It is the full onboarding-to-approval loop: Fastlane builds a brand profile, generates brand-tailored posts, asks the user to swipe through examples in Blitz mode, then lets the user accept, reject, edit, save, or schedule content immediately.

## Positioning

Fastlane describes itself as a way to create winning short-form marketing content for a brand in seconds. The founder onboarding email frames the first activation as:

1. Navigate to Blitz mode.
2. Approve content you like, or make edits.
3. Schedule to TikTok, Instagram, or YouTube.

The same email says users get a 7-day trial across all features with a limited number of content saves. Paid plans are named Starter, Growth, and Pro, and appear to unlock more content, AI credits, Blitz, TikTok direct posting, and related features.

## Onboarding Flow

The onboarding flow is designed to collect enough information to generate useful content immediately:

- User enters name, company name, and optional logo.
- User provides a company website for brand analysis.
- Fastlane prepares the workspace while analyzing website and profile data.
- User answers profile questions:
  - team size
  - monthly revenue band
  - role, such as founder, social media manager, marketing manager, agency owner, freelancer, product manager, content creator, or growth manager
  - business model: B2B, B2C, or both
  - business category: ecommerce, SaaS, agency, services, marketplace, media/content, mobile app, or other
  - reason for signing up
  - expected outcome from the platform
  - discovery source, including X, LinkedIn, YouTube, TikTok, Instagram, podcast, newsletter, Google, Reddit, referral, or other
- A testimonial carousel appears before the product handoff.
- The user is shown two creation modes: Blitz Mode and Manual Creation.

The onboarding is doing two jobs at once: collecting segmentation data for the business and training the user to treat content selection as a swipe workflow.

## Brand Profile

Fastlane automatically creates a brand profile from the onboarding inputs and website analysis. The captured brand page includes:

- Content angles, such as `AI Workflow Failures`, `Safe AI Shipping`, and `Agents as Teammates`.
- Tone and voice rules with explicit do/don't fields.
- Identity and product summary.
- Purpose and positioning.
- Differentiation.

The important product behavior is that generated videos and carousels are tailored to these brand angles. The examples in the screenshots were not generic templates; they were rewritten around the user's brand topics and positioning.

## Blitz Mode

Blitz Mode is the core discovery and approval surface.

The user is shown a stream of generated content cards and can swipe or click:

- reject with an X
- accept with a check
- edit
- mute
- move between variations
- save to library
- schedule post

This creates a preference loop. During onboarding, the user chooses styles they like for each format, and those selections build a library of approved content directions.

The interaction pattern feels closer to "review the day's ready-made content" than "start from a blank prompt." That is a meaningful product advantage.

## Format Notes

### Wall of Text

Wall-of-text videos are built from vertical video backgrounds with large captions overlaid. The screenshots show:

- viral-style dense text over creator footage
- brand-specific rewrites around the user's product angle
- a `Why This Content?` panel explaining why the generated post should work
- a `Remixed From` panel showing the source/trend inspiration
- engagement-style counters on remixed examples
- built-in popular music backing for wall-of-text videos

The text is not just a caption. It is the core creative asset.

### Green Screen

Green screen content uses cut-out people or meme subjects over generated or selected backgrounds. The screenshots show both human creator-style examples and meme-like subjects.

Observed behavior:

- green screen appears as its own content type in the library
- generated examples are adapted to brand messaging
- cards can be edited after generation
- popular music is baked into green screen videos

Fastlane also has an `Influencers` area for persistent AI characters, but it notes that influencer videos are visual-only for now, with no lip sync or voice yet.

### Carousel / Slideshow

Carousel is a major strength. The screenshots show complete, finished posts rather than blank layouts or partial drafts.

Observed behavior:

- carousel/slideshow is a first-class format alongside wall-of-text and green screen
- Fastlane generates finished multi-slide posts
- examples are adapted to the brand's content angles
- the user can accept, reject, edit, save, or schedule from the same review flow
- library cards show slideshow items mixed with other post types

This is important for ClutchCut because carousel generation is not positioned as a secondary export. It is part of the same daily content workflow.

## Manual Creation

Manual creation exists alongside Blitz Mode. The captured creation screen includes:

- content type tabs: Slideshow, Wall of Text, Video Hook & Demo, Green Screen Meme, and Custom
- create-new and remix modes
- a "mention your business" toggle
- optional prompt field
- generate action
- trending content / preview area

There is also a separate AI Studio-style page for images and videos with controls for:

- prompt
- model/version selector, shown as `Fastlane V8`
- aspect ratio, including `9:16`
- resolution, including `720p` and `1080p`
- credit cost, with examples showing 4 credits and roughly 30-60 seconds for generation

## Editor

The editor appears intentionally basic, especially for wall-of-text content. It is not a full timeline editor.

Observed wall-of-text controls:

- swap background video
- swap audio track
- mute audio
- toggle whether to mention the business
- prompt box for regeneration instructions
- regenerate text
- direct text editing on the canvas
- text styling controls for weight, size, color, stroke, stroke color, and background style
- done editing action

This keeps the editing surface focused on small fixes after generation rather than deep creative production. The user can replace the video/audio and adjust the text treatment, but the primary workflow is still generate, review, lightly edit, then save or schedule.

## Library, Scheduling, and Analytics

Fastlane has a broader content management shell:

- Dashboard quickstart checklist:
  - swipe content in Blitz
  - connect account
  - upload a demo video
  - make first post
- Content library with filters:
  - My Posts
  - My Content
  - My Media Bank
  - All Types
  - All Statuses
- Calendar page for scheduled posts.
- Analytics page with views, likes, comments, posts, website views, cumulative growth, growth per day, platform split, and content type split.
- Referral page with affiliate link, coupon code, and 30% recurring commission.
- Guide page with tutorials for Blitz Mode, Manual Creation, Green Screen Meme, Wall of Text, Hook Demo, Slideshows, Calendar, Library, Company Profile, and Feedback.
- Feedback page with founder call booking, roadmap, changelog, and direct feedback submission.
- Discord community link.

The app shell reinforces that the product is not just a generator. It is trying to own content production, approval, scheduling, performance tracking, and community support.

## Product Strengths

- Fast first value: onboarding ends with generated, brand-specific content rather than an empty workspace.
- Strong activation loop: swipe, accept, reject, edit, save, and schedule are all immediately available.
- Clear format focus: the product concentrates on three formats instead of trying to generate every content type.
- Brand tailoring: website analysis and onboarding answers feed into the brand profile and content angles.
- Trend remixing: generated posts are presented as remixes of proven formats, with trend/context panels.
- Finished carousel output: the carousel examples are complete posts, not just templates.
- Built-in music: wall-of-text and green screen outputs include popular music backing, reducing editing friction.
- Founder-led onboarding: the welcome email gives a direct path to first scheduled post in two minutes.
- Support surface: guide videos, roadmap, changelog, Discord, and founder call links are prominent.

## Gaps and Risks

- Influencer videos are currently visual-only; the product explicitly says no lip sync or voice yet.
- The flow depends heavily on swipe review. It may be weaker for users who want deterministic, brief-driven production.
- Credits and content-save limits may create friction during exploration.
- The output quality appears strong for social-native text/meme formats, but less clear for product-demo fidelity, asset-accurate shots, or repeatable brand-safe generation.
- The UI emphasizes trend remixing and fast approval more than traceability, reproducible settings, or generation auditability.

## Implications for ClutchCut

- The intro feature should get users to a finished, brand-specific first asset quickly. A blank editor is weaker than a guided path to reviewable outputs.
- Preference capture matters. Letting users accept/reject examples can train style and format choices faster than forms alone.
- Carousel should be treated as a first-class output format, not an afterthought.
- Generated content should explain itself. Fastlane's `Why This Content?` panel is useful because it tells the user why a piece might work.
- Saving and scheduling should be available at the moment of approval, not buried after export.
- Popular music and platform-native finishing details matter for perceived completeness.
- ClutchCut can differentiate by being more repeatable, traceable, and product-asset-aware while still matching Fastlane's fast review loop.
