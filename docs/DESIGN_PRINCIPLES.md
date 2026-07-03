# Noah Design Principles

These are the rules we apply to every visual decision in the desktop app. Specific color values, font sizes, and spacing units live in `index.css`. This document is about the **why**, so contributors can extend the system without breaking it.

The identity is monochrome: the app is strictly black-and-white with a wrench mark, and red + amber are the only colors (danger + warning). One naming note before the principles: the `--aurora*` / `--color-accent-*` tokens and the utility classes built on them predate the monochrome identity. The names are kept for compatibility, but every one of them now resolves to a neutral gray — read "aurora" as "the high-contrast identity treatment," not a color.

---

## 1. The user is reaching for a tool, not opening a chat app

Noah is a **command-and-control surface**. The user has a broken Mac and is aiming a capable agent at it. Every interaction should reinforce that emotion: confidence, intent, slight excitement.

Practical implications:
- The composer is the gateway. It should feel like a **launch button at all times**, not just on focus. The `.composer-launch` utility carries a quiet always-on neutral border + soft gray glow at rest, intensifying to the full focus ring on `:focus-within`. Generic `.aurora-focus` (which is invisible at rest) is for everything else — inputs, cards — *not* the composer itself.
- The send action gets the most prominent treatment in the entire UI. Bigger than any other button.
- Headlines and placeholder copy use **directive verbs**, not greetings. The Welcome empty state is "Tell me what's wrong. I'll handle the rest." (line 2 in `aurora-text`). Composer placeholder is "What's broken? Tell Noah and hit go." API-key setup copy should stay direct and task-focused.
- The agent is something you *direct*, not something you *converse with*. Copy and visuals should never lapse into chat-app passivity.

What this rules out:
- Submit buttons that look like email-field submits.
- "How may I assist you?" / "Hi, I'm Noah" / "Welcome to Noah" greetings — these are the chat-app voice we're explicitly *not* using.
- Generic chat-bubble layouts where the input is just another input.

---

## 2. No brand hue — hierarchy comes from contrast

The app has **no brand color**. The identity is the wrench mark plus a disciplined grayscale palette. Every interactive accent is a neutral gray; the thing that makes an element prominent is **contrast**, not hue.

**The primary action is carried by contrast — light-on-dark / dark-on-light:**
Sending a message. Clicking "Please fix it." Approving an action. Saving the API key. Hovering "New chat." Any moment where the user is *issuing a command*. The `--aurora` token (name kept for compat) is now a near-**white** gradient in dark mode and a near-**black** gradient in light mode, so the one primary button is the highest-contrast object on screen. Its label flips with it — `--btn-on-aurora` is dark text on the dark theme, white text on the light theme — so it stays legible.

Tokens: `--aurora` (near-white / near-black gradient fill), `--btn-on-aurora` (label color that flips with the theme), `--aurora-soft` / `--aurora-glow` (neutral washes + gray glows), `--color-accent-blue` / `--color-accent-indigo` / `--color-accent-violet` (all neutral grays now). Class shortcuts: `.btn-launch`, `.btn-commit` (major state-change actions), `.aurora-focus`, `.composer-launch`, `.aurora-text`.

**"Commit" (completion) still exists — but as a treatment, not a color:**
A different kind of click — *confirming a completion that already happened*. The "Sent" pill that replaces a Submit button. The check next to a finished tool-call. A "Result" eyebrow. Status dots showing "ready" / "working." These are now neutral gray (`--color-accent-green` / `--tone-ok-*` resolve to gray); the distinction from a live CTA is carried by state and shape (a settled pill, a check glyph), never by a foreign green. Class shortcut: `.btn-done`, `.eyebrow.commit`.

The system must:
- Stay grayscale everywhere. No hue creeps back in for "success," "info," or "brand." If something needs to stand out, raise its contrast or weight, don't tint it.
- Reserve the two real colors (red, amber — see Principle 8) for danger and warning only.

What this rules out:
- Any brand color at all — indigo, teal, blue, violet, green. Anywhere a saturated hue other than red or amber appears is a bug, not a choice.
- Bootstrap-y "primary blue, success green" accents.
- Signalling importance with color instead of contrast/weight.

---

## 3. Contrast is reserved. Restraint is the default

The highest-contrast moment in the UI — the near-white (dark theme) or near-black (light theme) fill — should be **the one thing the user is supposed to do next**. Everything else recedes into a narrow band of mid-grays: neutral surfaces, weight-only labels, quiet borders.

Practical rules:
- Body text uses neutral text colors. Never a saturated accent (there aren't any).
- Section labels are **eyebrows** — small uppercase, the `.eyebrow` class, a muted neutral leading bar. `.eyebrow.commit` is identical to `.eyebrow` (no color differentiation); the structured payload (`findings`, `steps`) carries the section semantics.
- Card backgrounds are neutral elevation tones, never tinted (except a brief neutral wash on hover).
- The high-contrast fill is reserved for **primary** moments. Everyday actions use a mid-gray surface and pick up a slightly stronger contrast on hover only.
- Disabled states are gray. Because everything is gray, disabled is signalled by *low contrast* (muted text on a recessed surface), not by desaturating a hue.

What this rules out:
- Colored body text for emphasis (use weight).
- Tinted card backgrounds to signal "this is the important card" (use shadow/elevation/contrast).
- Re-introducing any hue to differentiate two neutral things.

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

The identity isn't loud — it sits quietly until the user touches something. On hover and focus, the system *responds*, glowing or shifting in a way that says "this is a Noah surface." That response is now a neutral gray glow / contrast shift, not a colored one.

The composer is the one explicit exception (see Principle 1): it carries a quiet always-on identity at rest because Principle 1 demands it always feel like a launch button. Everything else stays neutral until interacted with.

Practical rules:
- Every interactive surface (sidebar items, cards, suggestion tiles, options) has some hover response. The intensity scales with the importance of the action: subtle neutral background-tint for navigation; the full high-contrast fill + gray glow for the launch button.
- Focus rings on inputs are neutral gray, not the OS default blue. The composer's focus state in particular should feel like the surface is *waking up*.
- Selected states use contrast (background tint + ring + glow on the radio fill), never a brand hue.
- Cards that are *asking the user to act* (assistant question cards, action cards) get a 2px aurora top-hairline at rest — a static identity cue distinct from the hover/focus response. The hairline is suppressed once the card is answered (the resulting commit-pill becomes the focal point instead).

What this rules out:
- Identical hover state for every surface (everything dims into bg-tertiary).
- Default browser focus rings.
- Selected radios that look identical to "blue radio" components from any web framework.

---

## 7. Animations are functional, never decorative

When Noah is thinking, the loading state must communicate *the agent is reasoning*, not *the page is loading*. Short, organic movement — the thinking-dot trio. It reads as "reasoning" through **motion and rhythm**, not color (the dots are neutral, matching the monochrome system). Never a spinner. Never a progress bar with no actual progress information.

What this rules out:
- Spinning circles that imply "the network is slow."
- Static, evenly-timed dots that read as a generic "loading" placeholder rather than active thought.
- Skeleton loaders for content that arrives in <500ms.

---

## 8. Red and amber are the only colors

The app is grayscale — with exactly two exceptions, non-negotiable for usability and accessibility:
- **Red** for destructive / error states (`--color-accent-red`, `--tone-bad-*`).
- **Amber/yellow** for warnings (`--color-accent-amber`, `--tone-warn-*`).

These are not "Noah colors" — they're universal safety signals, and they are the *only* saturated color anywhere in the product. Everything else is neutral gray. Use them sparingly, at low saturation, and only where the user genuinely needs to be alerted. If you find yourself reaching for a third color, the answer is contrast or weight, not a new hue.

---

## 9. Light mode is a first-class citizen

Most casual Mac users — especially the non-technical ones in our target audience — run their system in light mode. Light mode is not "the dark-mode theme inverted." It's its own design with its own contrast logic, its own card-elevation values, and its own accent saturations.

Practical rules:
- Light mode cards are pure white on a soft gray-blue page.
- Light-mode neutral washes carry slightly more weight than dark mode (a white-card background washes out a subtle gray tint). Concretely: `--aurora-soft` runs at ~16% in light vs ~12% in dark; `--aurora-glow` heavier; `--color-accent-border` at ~20% vs ~14%. If a neutral surface "disappears" against white in light mode, the opacity is too low — bump it (never reach for a hue).
- Light mode shadows are tighter and shorter (long shadows look fake in light mode).
- Test every screen in both modes before shipping.

This is not a finished system. Light mode today is dark-mode tokens with light-mode values swapped in; a dedicated design pass — its own elevation logic, accent rhythm, and card density — is still needed.

---

## 10. The icon is symbolic, not just a letter

The app icon is the user's most-frequently-seen Noah surface — they see it in the dock far more than they see any other element. It carries **symbolism** — what Noah does for the user — not just a letter or a brand color.

The shipped mark is a **wrench** (Lucide "wrench" glyph): a near-white wrench on a rounded near-black tile. It says *this is a tool you point at a broken machine* — the emotion of Principle 1 — and it's strictly monochrome, matching the in-app system. The geometry is generated from a single source of truth (`brand/build.py`) and propagated to every surface by `brand/sync.sh`; never hand-edit an icon file. Red and amber never appear in the mark.

---

## How to extend this

When adding a new surface or interaction, run through these questions:

1. **Is this a live command or a completed confirmation?** Pick that first, then the visual treatment follows (a high-contrast fill vs. a settled neutral pill).
2. **Is this the most important action on screen?** If yes, it gets the most contrast (the near-white / near-black fill). If no, it shouldn't.
3. **Does this need color, or just weight/contrast?** It almost never needs color — red and amber are the only colors, and only for danger/warning. Default to weight and contrast.
4. **What does it look like on hover/focus?** That's where the identity lives.
5. **Does it work in light mode?** Check both modes before merging.
6. **Could a stressed user find this in 2 seconds at low brightness?** If not, increase contrast or size.

When in doubt: **less saturation, more whitespace, larger type.**

---

## Utility classes (current)

These are the reusable primitives shipped in `index.css`. New surfaces should compose from these before reaching for inline styles. The `aurora`/`accent` names are historical — the palette is monochrome; these classes now carry weight through **contrast**, not hue.

| Class | Purpose | When to use |
|---|---|---|
| `.btn-launch` | The primary button — high-contrast fill (near-white on dark, near-black on light) with a flipping label (`--btn-on-aurora`). | Composer send, "Please fix it," primary CTAs that aim Noah at a problem (Continue on setup, Save key, Approve action). |
| `.btn-commit` | Stronger version of the primary button with a specular highlight + deeper shadow stack. | Save API key, install update, confirm a major state change. Same identity as launch, more depth. |
| `.btn-action` | Solid mid-gray with a hover contrast lift. Label flips via `--btn-on-aurora`. | Submit button inside an in-card answer surface. Less prominent than `.btn-launch`. |
| `.btn-done` | Neutral "settled" pill with a check glyph. | Replaces a submit button after the action is taken ("Sent" / "Resolved"). |
| `.aurora-focus` | Invisible at rest; neutral gray ring on `:focus-within`. | Generic inputs and focusable cards. Not for the composer (use `.composer-launch`). |
| `.composer-launch` | Always-on quiet neutral border + soft gray glow; intensifies on focus-within. | The chat composer wrapper. Reserved for the gateway surface (Principle 1). |
| `.aurora-text` | Gradient-fill text (near-white on dark / near-black on light). | Accent words inside a directive headline (line 2 of "Tell me what's wrong. / I'll handle the rest."). Reserve for one phrase per surface. |
| `.eyebrow` | Uppercase kicker label with a muted neutral leading bar. | Above section headers and on assistant question cards ("QUESTION"). `.eyebrow.commit` is identical (no color differentiation). |
| `.aurora-blob` | Absolutely-positioned soft neutral glow. | Behind centered hero surfaces only (Welcome empty state). Not for normal cards. |
| `.thinking-dot` | Neutral bouncing dot trio (reads through motion, not color). | The only loading affordance Noah uses. No spinners. |
| `.card-soft` | Soft-elevation card — neutral bg, low-opacity border, drop shadow. | All chat cards and tile surfaces. Pair with `.interactive` for hover lift. |

---

## What this document does not yet specify

Surfaces where the system still has gaps. Contributions here are welcome, but they need design thinking, not just code:

- **Mid-conversation chat surfaces.** The system is strongest from onboarding through the first fix. What a 5-minute-deep conversation looks like — tool-call cards, the ambient activity log, the assistant-bubble identity — is under-specified.
- **Chat-bubble polarity.** User vs. assistant bubbles are currently differentiated only by background; a richer treatment isn't designed yet.
- **Sidebar density and identity.** Active session row, hover, drag, drop — none have a designed identity response. Today the sidebar is a list of files with one high-contrast button at the top.
- **Light mode as its own system.** See Principle 9. Today it's dark-mode-with-tokens-flipped, not a designed light experience.
- **Diagnostic / Result cards.** Deferred because the backing data (per-step tool status, before/after metrics) isn't reliably emitted yet. Build the data first, then the surfaces.
