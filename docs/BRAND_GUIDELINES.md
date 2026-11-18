---
title: Wohlig Brand Guidelines (working copy for the HR Access Hub)
aliases: [Brand Guidelines, Wohlig Brand, Design Tokens]
tags: [brand, design, ui, standard]
repo: hr-automation
role: design standard for every screen, email and document this repo produces
source: brand/Wohlig_Brand_Guidelines_2026.pdf (Brand Identity Guidelines, Edition 01 / 2026)
updated: 2026-11-18
---

# Wohlig Brand Guidelines

> [!info] Read this before any UI, email or document work
> This is the text form of the brand deck in [brand/Wohlig_Brand_Guidelines_2026.pdf](brand/Wohlig_Brand_Guidelines_2026.pdf).
> The CSS tokens live in [frontend/src/brand.css](../frontend/src/brand.css). The sign-in page
> ([frontend/src/login/](../frontend/src/login/), [frontend/src/login.css](../frontend/src/login.css)) is the reference
> build. See also [[ARCHITECTURE]] and [CLAUDE.md](../CLAUDE.md).

The deck calls itself a concept guideline: the master logo, typeface and contrast choices still need formal approval.
Where this file goes further than the deck (contrast rules, the type scale, dark theme), the section says so.

## 1. The idea

**Rooted in warmth. Built for what's next.** Warm intelligence, human transformation. The identity feels human before
it feels technical: optimistic, tactile, quietly confident, forward-looking.

Four traits: **rooted, inventive, human, confident**.

## 2. Colour

| Name | Hex | Token | Role |
|---|---|---|---|
| Deep Maroon | `#800D35` | `--brand-maroon` | Primary, identity. Headings, primary buttons, brand panels. |
| Sunset Orange | `#F7781D` | `--brand-orange` | The smile and one focal action. |
| Warm Ivory | `#FFF7E9` | `--brand-ivory` | Base, breathing room. Page background. |
| Earthen Beige | `#EAD9C2` | `--brand-beige` | Surfaces, softness. Cards, quiet panels, hairlines. |
| Terracotta | `#C85F44` | `--brand-terracotta` | Craft, expressive detail. Line art, small labels. |
| Muted Olive | `#76775A` | `--brand-olive` | Optional nature accent. Rare. |

Rules:

- The page base is ivory, never pure white and never cold grey.
- Colour is intentional: one orange focal point per screen. Don't spread orange around.
- No neon, no gradients as decoration.

Contrast (measured for this repo, WCAG AA needs 4.5:1 for text):

| Pair | Ratio | Use |
|---|---|---|
| Maroon on ivory, ivory on maroon | 9.7:1 | Text, buttons. Safe everywhere. |
| White or ivory text on orange | 2.7:1 and 2.6:1 | **Fails.** Never set light text on orange. |
| Dark ink `#2A1016` on orange | 6.5:1 | The way to label an orange button. |
| Orange on ivory | 2.6:1 | Graphic use only, never text. |
| Terracotta on ivory | 3.8:1 | Large text (24px+) and line art only. |
| Olive on ivory | 4.3:1 | Large text only. |

The deck's website mock shows white text on an orange button. Because of the contrast failure above, this repo uses the
wohlig.com maroon button (ivory text) on light surfaces and an orange button with dark ink text on dark surfaces.

Dark theme (this repo's extension, not in the deck): page `#1C0D11`, text ivory, the action colour switches from maroon
to orange. The maroon brand panel stays maroon in both themes.

## 3. Logo

- **Wordmark**, primary: maroon letters with the orange smile as the "o", for light surfaces.
  File: [frontend/public/wohlig-logo.svg](../frontend/public/wohlig-logo.svg).
- **Wordmark**, reversed: ivory letters, for maroon and dark surfaces.
  File: [frontend/public/wohlig-logo-dark.svg](../frontend/public/wohlig-logo-dark.svg).
- **Smile mark**: the orange circle with the white smile, for avatars, favicons and small branded moments.
  File: [frontend/public/wohlig-smile-mark.svg](../frontend/public/wohlig-smile-mark.svg).

Production rules:

- Use the approved master files above. Never redraw the logo in code, never rebuild it from text plus a circle.
- Keep clear space of one smile-circle diameter on every side.
- Never stretch it, and never recolour it outside the two versions above.
- Put the reversed wordmark straight on maroon. Don't sit the light version on a white chip.

## 4. Typography

| Role | Deck | In this repo |
|---|---|---|
| Headlines | Editorial serif (DejaVu Serif direction) | `--brand-display`: Fraunces, as on wohlig.com. Light weight (about 380) for big headlines, 500 for card titles, 600 for buttons |
| Body and interface | Lato regular / medium | `--brand-body`: Lato 400 and 700 |

- Serif is for headlines, short statements and button text. Labels, inputs and body are Lato.
- The signed-in app ([frontend/src/legacy.css](../frontend/src/legacy.css)) still uses Source Serif 4. Move it to Fraunces
  in its own change; don't mix the two on one screen.
- Body text is 16px with 1.55 line height. Nothing a person must read goes below 14px.
- Sentence case for headings and buttons. The deck uses small capitals for section markers; in the product keep that
  to rare, short markers, not every label.
- Lato is loaded at 400 and 700 only, so don't ask for 500 or 600: the browser fakes them.

## 5. Graphic language

Traditional in spirit, modern in form. Three motifs, drawn as thin line art (about 1.5px, terracotta or beige):

1. **Flower / radiance**: eight thin petals around a centre. Pairs with the smile as the centre.
2. **Arch / threshold**: three overlapping arches. Fits entry moments: sign-in, welcome, onboarding.
3. **Dot / digital grid**: an offset grid of small dots. Fits data and systems.

Abstract them, don't imitate real ornaments. Use one motif per screen, lightly, with generous empty space around it.

## 6. Imagery

Seek tactile surfaces, warm daylight, grounded human moments, real collaboration. Avoid generic robot imagery, neon
gradients, overprocessed stock photos and decorative clichés.

## 7. Layout and motion

Editorial scale, calm surfaces, intentional colour, subtle motion.

The live reference is [wohlig.com](https://www.wohlig.com). What this repo takes from it:

- **Paper and glow.** Ivory page with a soft orange "sunset" glow in one corner and a beige wash in another.
- **Headline with one italic accent.** A light Fraunces headline in maroon, with one closing word in italic and a
  terracotta-to-orange gradient ("Your workday, made *wohlig.*"). One accent per screen, 24px or larger only.
- **Section marker.** A short orange dash, then small spaced capitals in maroon ("HR ACCESS HUB"). One per screen.
- **Glass cards.** Translucent ivory, 1px light edge, large soft maroon-tinted shadow, 18 to 28px corners.
- **Pill buttons.** Primary: maroon gradient `#A8493F → #7D1535 → #5C0926` with ivory Fraunces text and a soft glow;
  lifts 2px on hover. Secondary: light fill with a maroon outline.
- **Line art.** Large, faint petals or arches behind the content.
- **Motion.** One entrance sequence when the page opens (pieces rise in order, about 90ms apart), line art that draws
  itself in, and slow ambient movement (the flower turns once in 160 seconds, the glow drifts). Buttons answer hover and
  press. Nothing flashes, bounces or loops quickly.

- One large serif statement, then quiet supporting text. Plenty of space.
- Rounded shapes: pill buttons, 12px inputs, 16 to 24px cards.
- Always honour `prefers-reduced-motion`: every animation above switches off and the page still looks finished.
- Legibility and a clear hierarchy come first. Do not over-decorate enterprise content.

## 8. Voice

| Trait | Meaning |
|---|---|
| Human | We speak to people, not platforms. |
| Clear | Complex thinking, simply expressed. |
| Optimistic | Progress without empty hype. |
| Grounded | Evidence, empathy and real impact. |

In the product: plain verbs, sentence case, short sentences. A button says what it does ("Sign in with password", not
"Submit"). An error says what went wrong and what to do next ("That invite link has expired. Ask HR to send a new one.").
Write "Wohlig" with a capital in sentences; the lowercase form belongs to the logo and the italic accent word only.

Writing rules for every screen and email:

- Professional and warm. Full sentences, correct grammar and spelling, no slang, no exclamation marks, no emoji.
- Say "Please" when asking for something; never blame the person ("Please sign in with your @wohlig.com Google account.").
- Use the same word for the same thing everywhere ("Sign in", never "Log in" in one place and "Login" in another).
- No internal or technical words in front of staff: no "token", "session", "payload", "404".

## 9. Checklist for any new screen

- [ ] Colours and fonts come from `brand.css` tokens; no brand hex typed into a component.
- [ ] Ivory base, maroon for identity and primary action, orange once.
- [ ] Logo is a master file, right version for the surface, with clear space.
- [ ] Serif headline, Lato for everything else, 16px body.
- [ ] Text contrast is 4.5:1 or better in light and dark.
- [ ] Works at 320px wide with no sideways scroll; touch targets are 44px or taller.
- [ ] Visible keyboard focus; labels on every input; errors announced with `role="alert"`.
- [ ] Reduced motion respected.
- [ ] Checked in a real browser, light and dark, desktop and phone, before calling it done.
