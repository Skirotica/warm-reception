# design

The look of the console. Colors, type, spacing, radius, and shadows come from `TOKENS.css`. The prototypes inline that file. Do not add a new color or a new font beside it.

`SKINS.md` describes the three skins. The page picks one by setting `data-skin` on the `<html>` tag:

| Skin | Attribute | Mood |
|---|---|---|
| Operations | `data-skin="ops"` | Dark, for an internal queue |
| Studio | `data-skin="studio"` | Light, for a daylight demo |
| Terminal | `data-skin="term"` | Green on black, for a technical audience |

Status colors stay the same on every skin so pass, needs-work, and fail stay readable.
