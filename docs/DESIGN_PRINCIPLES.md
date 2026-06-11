# Noah Design Principles

These are the rules we apply to every visual decision in the desktop app. Specific color values, font sizes, and spacing units live in `index.css`. This document is about the **why**, so future contributors (and a future designer) can extend the system without breaking it.

> **Status:** Aurora system shipped in `7aaf0df`; refreshed in this round to add `.aurora-text`, `.eyebrow`, `.aurora-blob`, `.composer-launch`, the directive-copy guideline (Principle 1), and the light-mode tuning rule (Principle 9). `BRAND_GUIDE.md` is still on the pre-aurora teal palette and is queued for a separate rewrite — defer to this file when they disagree.

---

## 1. The user is reaching for a tool, not opening a chat app

Noah is a **command-and-control surface**. The user has a broken Mac and is aiming a capable agent at it. Every interaction should reinforce that emotion: confidence, intent, slight excitement.

Practical implications:
- The composer is the gateway. It should feel like a **launch button at all times**, not just on focus. The `.composer-launch` utility carries a quiet always-on aurora-tinted border + soft indigo glow at rest, intensifying to the full focus ring on `:focus-within`. Generic `.aurora-focus` (which is invisible at rest) is for everything else — inputs, cards — *not* the composer itself.
- The send action gets the most prominent treatment in the entire UI. Bigger than any other button.
- Headlines and placeholder copy use **directive verbs**, not greetings. The Welcome empty state is "Tell me what's wrong. I'll handle the rest." (line 2 in `aurora-text`). Composer placeholder is "What's broken? Tell Noah and hit go." API-key setup copy should stay direct and task-focused.
- The agent is something you *direct*, not something you *converse with*. Copy and visuals should never lapse into chat-app passivity.

What this rules out:
- Submit buttons that look like email-field submits.
- "How may I assist you?" / "Hi, I'm Noah" / "Welcome to Noah" greetings — these are the chat-app voice we're explicitly *not* using.
- Generic chat-bubble layouts where the input is just another input.

---

## 2. One color family, two emotional registers

Every accent color in the app comes from a single hue family. Within that family there are exactly **two registers** — distinct enough to communicate different intent, related enough to feel unified.

**Register A — "Launch" (aurora gradient, sky-blue → indigo → violet):**
The act of aiming Noah at a problem. Sending a message. Clicking "Please fix it." Approving an action. Saving the API key. Hovering "New chat." Focus rings. Thinking-state animations. Any moment where the user is *issuing a command*.

Tokens: `--aurora` (gradient), `--aurora-soft` (10–16% wash), `--aurora-glow` / `--aurora-glow-hover`, `--color-accent-blue` / `--color-accent-indigo` / `--color-accent-violet`. Class shortcuts: `.btn-launch`, `.btn-commit` (major state-change actions), `.aurora-focus`, `.composer-launch`, `.aurora-text`.

**Register B — "Commit" (aurora-teal):**
A different kind of click — *confirming a completion that already happened*. The "Sent" pill that replaces a Submit button. The check next to a finished tool-call. A "Result" eyebrow on a fix-summary card. Status dots showing "ready" / "working." Never a CTA — only a confirmation.

Tokens: `--color-accent-green` (`#14b8a6` dark / `#0d9488` light — aurora-teal, NOT grass green; replaces the legacy `#34d399`). Class shortcut: `.btn-done`, `.eyebrow.commit`.

Both registers must:
- Live within the same hue family. No warm grass-greens against cool indigos. No off-family hues. The aurora-teal sits next to aurora-blue in hue space, so the two registers feel related.
- Be visually distinct enough that a user can tell them apart at a glance. Different saturation, different position on the gradient, different shape of glow.

What this rules out:
- A different brand color for every kind of click.
- Bootstrap-y "primary blue, success green, danger red" with no relationship between them.
- Using the launch register for commit moments OR vice versa. "Save key" and "Install update" are launch-like state changes. "Sent" / "Fixed" is commit (already-completed), not launch. The legacy iOS-green `#34c759` and grass-green `#34d399` are gone — anywhere those still appear is unfinished migration.

---

## 3. Saturation is reserved. Restraint is the default

The most saturated, glowing, gradient-laden moment in the UI should be **the one thing the user is supposed to do next**. Everything else recedes — neutral surfaces, weight-only labels, quiet borders.

Practical rules:
- Body text uses neutral text colors. Never accent.
- Section labels are **eyebrows** — small uppercase, the `.eyebrow` class, aurora-indigo for launch surfaces and `.eyebrow.commit` for completion surfaces. One color family, never a third hue. The previous rule that "Situation"/"Plan"/"Result" got their own accent color (blue/purple/green) has been retired — that produced two competing accent families on the same card and diluted both. The structured payload (`findings`, `steps`) carries the section semantics now; the eyebrow only needs to mark the type, not differentiate it.
- Card backgrounds are neutral elevation tones, never accent-tinted (except on hover, briefly).
- Button gradients are reserved for **launch** moments. Everyday actions use solid color and pick up an aurora hint on hover only.
- Disabled states are gray. Never a desaturated version of the active color — that breaks the "active = saturated, inactive = neutral" rule.

What this rules out:
- Colored body text for emphasis (use weight).
- Colored card backgrounds to signal "this is the important card" (use shadow/elevation).
- Six different button colors on screen at once.

---

## 4. Soft elevation over hard borders

Containment is communicated by **shadow and slight background lift**, not by hard 1px borders that frame every card.

Why: hard borders read as "form box" — a 2017 Bootstrap aesthetic. Soft drop-shadow + a barely-there background-lift reads as "modern conversation surface." Anthropic Claude does the former (no card framing at all); ChatGPT does the latter (subtle elevation). Noah is in the latter camp because our cards contain interactive content (action buttons, options, forms) that benefits from light containment.

Practical rules:
- Cards: 1px border at very low opacity (~6%) + small drop shadow + slightly lighter background than the page. Three subtle cues stacked, never one heavy cue.
- Card border-radius: substantial (~16px). Squared-off corners read as utility/SaaS; rounded corners read as friendly/Mac-native.
- The **page** is darker than the cards (in dark mode), so cards float toward the user. In light mode, cards are pure white on a soft gray-blue page.

What this rules out:
- Heavy 1px solid borders.
- Cards with the same background as the page (loses the affordance of "this is a thing").
- Sharp 4–8px border-radius.

---

## 5. Friendliness through type size, not whimsy

The audience is a stressed Mac user whose computer is broken. They are not delighted by decorative illustrations or playful icons. They are calmed by:
- **Larger body text** than a typical SaaS dashboard. We use 17px root, which makes Tailwind's `text-base` 17px and `text-sm` ~15px. Not because it's prettier — because someone reading at low display brightness, possibly older, possibly stressed, can read it without squinting.
- **Generous line-height** (1.55–1.65).
- **Clear typographic hierarchy via weight, not size jumps.** Section headers are bold-600 at the same size as body. Headlines step up only slightly.
- **Plain language** in copy. "Update ready" beats "artifact available."

What this rules out:
- Decorative micro-illustrations of robots, gears, sparkles.
- Tiny 11–13px UI text.
- Playful animations on critical paths.
- Cute sound effects.

---

## 6. Hover and focus are identity moments

The aurora identity isn't loud — it sits quietly until the user touches something. On hover and focus, the system *responds*, glowing or shifting in a way that says "this is a Noah surface."

The composer is the one explicit exception (see Principle 1): it carries a quiet always-on aurora identity at rest because Principle 1 demands it always feel like a launch button. Everything else stays neutral until interacted with.

Practical rules:
- Every interactive surface (sidebar items, cards, suggestion tiles, options) has some aurora-tinted hover response. The intensity scales with the importance of the action: subtle background-tint for navigation; full gradient + glow for the launch button.
- Focus rings on inputs are aurora-tinted, not the OS default blue. The composer's focus state in particular should feel like the surface is *waking up*.
- Selected states use aurora hue (background tint + glow on the radio fill), not flat brand-blue.
- Cards that are *asking the user to act* (assistant question cards, action cards) get a 2px aurora top-hairline at rest — a static identity cue distinct from the hover/focus response. The hairline is suppressed once the card is answered (the resulting commit-pill becomes the focal point instead).

What this rules out:
- Identical hover state for every surface (everything dims into bg-tertiary).
- Default browser focus rings.
- Selected radios that look identical to "blue radio" components from any web framework.

---

## 7. Animations are functional, never decorative

When Noah is thinking, the loading state must communicate *the agent is reasoning*, not *the page is loading*. Short, organic movement. Aurora-colored. Never a spinner. Never a progress bar with no actual progress information.

What this rules out:
- Spinning circles that imply "the network is slow."
- Bouncing dots in monochrome gray.
- Skeleton loaders for content that arrives in <500ms.

---

## 8. The two semantic colors that escape the system

Two color uses are non-negotiable for usability and accessibility:
- **Red** for destructive / error states.
- **Amber/yellow** for warnings.

These are not "Noah colors." They're universal signals and we don't try to bend them into the aurora family. Use them sparingly, at low saturation, and only where the user genuinely needs to be alerted.

---

## 9. Light mode is a first-class citizen

Most casual Mac users — especially the non-technical ones in our target audience — run their system in light mode. Light mode is not "the dark-mode theme inverted." It's its own design with its own contrast logic, its own card-elevation values, and its own accent saturations.

Practical rules:
- Light mode cards are pure white on a soft gray-blue page.
- Light mode accents are slightly more saturated than dark mode (the white-card background washes out subtle hues). Concretely: `--aurora-soft` runs at ~16% in light vs ~12% in dark; `--aurora-glow` at ~0.55 vs ~0.4; `--color-accent-border` at ~20% vs ~14%. If a tinted surface "disappears" against white in light mode, the soft/glow opacity is too low — bump it, don't switch hue.
- Light mode shadows are tighter and shorter (long shadows look fake in light mode).
- Test every screen in both modes before shipping.

This is not a finished system. Light mode today is dark-mode tokens with light-mode values swapped in. A real designer pass — own elevation logic, own accent rhythm, own card density — is queued.

---

## 10. The icon is symbolic, not just a letter

The app icon is the user's most-frequently-seen Noah surface — they see it in the dock far more than they see any other element. It deserves dedicated design work that thinks about **what Noah symbolizes**, not just "the letter N in our brand color."

This document does not prescribe an icon direction. The icon is owned by whoever the founder briefs to design it. What matters: it should still feel related to the in-app system (same color family, same emotional register), but it should carry *symbolism* — what Noah does for the user — not just brand.

---

## How to extend this

When adding a new surface or interaction, run through these questions:

1. **Which register is this — launch or commit?** Pick the register first, then the visual treatment follows.
2. **Is this the most important action on screen?** If yes, it gets the most saturation. If no, it shouldn't.
3. **Does this need color, or just weight?** Default to weight.
4. **What does it look like on hover/focus?** That's where the identity lives.
5. **Does it work in light mode?** Check both modes before merging.
6. **Could a stressed user find this in 2 seconds at low brightness?** If not, increase contrast or size.

When in doubt: **less saturation, more whitespace, larger type.**

---

## Aurora utility classes (current)

These are the reusable primitives shipped in `index.css`. New surfaces should compose from these before reaching for inline styles.

| Class | Purpose | When to use |
|---|---|---|
| `.btn-launch` | Aurora-gradient button — the launch register. | Composer send, "Please fix it," primary CTAs that aim Noah at a problem (Continue on setup, Save key, Approve action). |
| `.btn-commit` | Stronger aurora-gradient button with specular highlight. | Save API key, install update, confirm a major state change. Same identity as launch, more depth. |
| `.btn-action` | Solid aurora-blue with hover glow. | Submit button inside an in-card answer surface. Less prominent than `.btn-launch`. |
| `.btn-done` | Commit-teal pill with check glyph. | Replaces a submit button after the action is taken ("Sent" / "Resolved"). |
| `.aurora-focus` | Invisible at rest; aurora ring on `:focus-within`. | Generic inputs and focusable cards. Not for the composer (use `.composer-launch`). |
| `.composer-launch` | Always-on quiet aurora border + soft glow; intensifies on focus-within. | The chat composer wrapper. Reserved for the gateway surface (Principle 1). |
| `.aurora-text` | Gradient-fill text. | Accent words inside a directive headline (line 2 of "Tell me what's wrong. / I'll handle the rest."). Reserve for one phrase per surface. |
| `.eyebrow` | Uppercase kicker label with aurora-tinted leading bar. | Above section headers and on assistant question cards ("QUESTION"). `.eyebrow.commit` swaps the leading bar to commit-teal for "completed" eyebrows. |
| `.aurora-blob` | Absolutely-positioned soft aurora glow. | Behind centered hero surfaces only (Welcome empty state). Not for normal cards. |
| `.thinking-dot` | Aurora-colored bouncing dot trio. | The only loading affordance Noah uses. No spinners. |
| `.card-soft` | Soft-elevation card — neutral bg, low-opacity border, drop shadow. | All chat cards and tile surfaces. Pair with `.interactive` for hover lift. |

---

## What this document does NOT yet specify

Honest list of surfaces where the system has gaps. Solving these needs designer time, not just engineer time.

- **Mid-conversation chat surfaces.** The handoff covered onboarding → first fix. It did not cover what a 5-minute-deep conversation looks like. Tool-call cards, ambient activity log, and the assistant-bubble identity are all under-specified.
- **Chat-bubble polarity.** User vs. assistant bubbles are currently differentiated only by background. The Brand Guide's two-loops metaphor (warm = user, cool = Noah) suggests a richer treatment that isn't built.
- **Sidebar density and identity.** Active session row, hover, drag, drop — none have an aurora response. Today the sidebar is a list of files with one aurora button at the top.
- **Light mode as its own system.** See Principle 9. Today it's dark-mode-with-tokens-flipped, not a designed light experience.
- **Diagnostic / Result cards.** The handoff specced both (`Diagnose-A`, `Fixed-A`); we deferred them because backing data (per-step tool status, before/after metrics) isn't reliably emitted yet. Build the data first, then the surfaces.
