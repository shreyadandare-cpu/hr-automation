---
title: Wohlig Brand Guidelines (working copy for Wohlig One, the employee portal)
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
> The CSS tokens are at the top of the one stylesheet, [frontend/src/styles.css](../frontend/src/styles.css). The sign-in page
> ([frontend/src/login/](../frontend/src/login/), section 7 of that file) is the reference
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
wohlig.com maroon button (ivory text) in both themes and never an orange button.

Dark theme (this repo's extension, not in the deck): page `#1C0D11`, text ivory, the action colour switches from maroon
to orange for links and focus rings. Buttons and the maroon brand panel stay the same in both themes.

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
- The signed-in app (section 6 of `styles.css`) still uses Source Serif 4 for headings; its buttons are already Fraunces. Move it to Fraunces
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

**In this product, only the dot grid is used.** The flower was tried on the sign-in page (it read as a sun behind the
form) and was rejected on 2026-11-18. Do not use sun, flower, petal, starburst or glowing-orb shapes on any screen.

## 6. Imagery

Seek tactile surfaces, warm daylight, grounded human moments, real collaboration. Avoid generic robot imagery, neon
gradients, overprocessed stock photos and decorative clichés.

## 7. Layout and motion

Editorial scale, calm surfaces, intentional colour, subtle motion.

The live reference is [wohlig.com](https://www.wohlig.com). What this repo takes from it:

- **Paper.** A plain ivory page. No glow blobs.
- **Headline with one italic accent.** A light Fraunces headline with one closing word in italic and a warm orange
  ("Your workday, made *wohlig.*"). One accent per screen, 24px or larger only.
- **Section marker.** A short orange dash, then small spaced capitals ("WOHLIG ONE"). One per screen.
- **Split layout for entry pages.** A maroon brand panel on one side (logo, headline, three short points), only the
  form on the other, on plain ivory. Nothing decorative behind the form.
- **Buttons.** One button, copied from wohlig.com and kept as the `--btn-*` tokens (classes `btn primary`,
  `btn glass`, sizes `lg`, `sm`, `block`). Measured on the live site on 2026-11-18:

  | | Primary ("Contact us") | Second ("See how it looks") |
  |---|---|---|
  | Fill | `linear-gradient(135deg, #C85F44 -20%, #800D35 45%, #6A0A2B)` | `linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,255,255,.6))`, 1px white edge |
  | Text | `#FFF7E9`, Fraunces 600, 16px, letter-spacing -0.005em | `#800D35`, same type |
  | Shape | 50px tall, 28px side padding, full pill | same |
  | Shadow | `inset 0 1px 0 rgba(255,255,255,.28), 0 2px 6px rgba(46,26,31,.08), 0 14px 30px -12px rgba(128,13,53,.6)` | `0 2px 6px rgba(46,26,31,.04), 0 14px 30px -14px rgba(128,13,53,.28)` |
  | Hover | lifts 2px; gradient `-40% / 35% / #5C0925`; shadow `0 18px 36px -12px rgba(128,13,53,.7)`; a light sweeps across in 0.75s | lifts 2px; fill turns solid white; same sweep |
  | Motion | `transform .35s cubic-bezier(.34,1.4,.64,1)` | same |
  | Focus | 2px `#F7781D` outline, 3px offset | same |

  Dark theme (ours; the site has none): primary unchanged, second becomes ivory glass with ivory text.
- **Motion.** One entrance sequence when the page opens (pieces rise in order, about 90ms apart). Buttons answer hover
  and press. Nothing loops, flashes or bounces, and nothing moves in the background.

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

- [ ] Colours and fonts come from the brand tokens in `styles.css`; no brand hex typed into a component.
- [ ] Ivory base, maroon for identity and primary action, orange once.
- [ ] Logo is a master file, right version for the surface, with clear space.
- [ ] Serif headline, Lato for everything else, 16px body.
- [ ] Text contrast is 4.5:1 or better in light and dark.
- [ ] Works at every size in the CLAUDE.md table (320px phone to 1920px monitor) with no sideways scroll, tested with
      Playwright; touch targets are 44px or taller.
- [ ] Visible keyboard focus; labels on every input; errors announced with `role="alert"`.
- [ ] Reduced motion respected.
- [ ] Checked in a real browser, light and dark, desktop and phone, before calling it done.
