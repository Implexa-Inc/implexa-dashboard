# Implexa Brand Tokens

## Colors
- Background     #0A0805   warm-dark base
- Surface        #15110C
- Surface 2      #1C1812
- Divider        #2A241E
- Foreground     #F5F0E8
- Heading        #FAFAF8
- Muted          #A19992

## Accents
- Flame (primary)   #FF8A3C   — used on the 'x' node, primary CTAs
- Ember (secondary) #FFD93D   — sparks, highlights
- Emerald (signal)  #10B981   — used on the 'i' node, success/active
- Emerald soft      #34D399

## Typography
- Display / UI : Inter (600 for headings, 500 for UI, 400 body)
- Mono         : JetBrains Mono (labels, IDs, code)
- Tracking     : -0.02em on headings
- Wordmark     : lowercase, 600, tight tracking, dot on 'i' = emerald, dot on 'x' = flame

## Iconography
- 24×24 grid, 1.5px stroke, round caps + joins
- Stroke uses currentColor — easy to recolor per state
- Reserve **emerald fill** for "active / signal / source" icons
- Reserve **flame fill** for "action / energy / output" icons
- Reserve **ember fill** for "spark / AI magic" icons

## Motion
- Subtle pulse on emerald node (2.4s)
- Hover: scale 1.25 on signature dots
- Easing: cubic-bezier(0.22, 1, 0.36, 1)

## Logo usage
- logo-wordmark-dark.svg  — for dark surfaces
- logo-wordmark-light.svg — for light surfaces
- logo-mark.svg           — square badge for app icon, avatar, social
- favicon.svg             — 32×32 simplified mark
