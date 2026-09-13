# Problem description mockup prompts

Tool: built-in image_gen. Static PNG design mockups.

## Default view

Use case: ui-mockup precise edit. Edit the first image, a Japanese DSA problem description with accordion sidebar, preserving its 1448x1086 layout and all unaffected text and code. Second image is style reference for unified navigation.
Make only these changes:
1. Top navigation: solid blue #407BFA, white DSA logo left, then Dashboard, Results; right aligned Grading, Admin, Logout, exactly as second image. No logout icon, no cyan.
2. Remove the green 成功 badge and the 結果を見る button entirely from the right of the large 基本課題 heading.
3. On the SAME line immediately to the right of the small resource title "C言語によるプログラミングの復習", place a compact clickable CI submission summary: red circle white X icon, then muted gray "2a7396e · 17 hours ago", no capsule or button background. Resource title remains at its current place above the large 基本課題 heading. Ensure summary fits with reasonable spacing and is readable.
4. In the left sidebar 課題を提出 card, delete ONLY the explanatory two lines "基本課題・発展課題をまとめて提出" and "5ファイルをルート直下に配置。". Close the vacated space naturally by moving the filename list and upload controls up. Preserve card title, all five listed files (gcd_euclid.c, main_euclid.c, gcd_recursive.c, main_recursive.c, Makefile), drop zone, ファイルを選択 button, 未選択, disabled 提出する button.
Preserve accordion nav, breadcrumbs, 課題リンク, Japanese problem explanation, code blocks with syntax highlighting, headings and scroll position. No popup in this default-state screenshot. Crisp UI screenshot.

## Open popover

Use case: ui-mockup precise edit. First input is the edit target, the updated DSA problem description screen. Second input is a style reference for the submission-results popover.
Preserve the first image's layout, blue navigation, sidebar, upload card, code and all content EXACTLY. Add one clicked-open submission results popover anchored to the red X / "2a7396e · 17 hours ago" beside "C言語によるプログラミングの復習". Keep this title and summary visible.
Popover fits inside the main content pane: roughly x=580 y=180 width=825 height=260 on this 1448x1086 screenshot. Small upward pointer toward the clicked summary at x=745. White header, subtly gray rows, thin cool-gray border, 16px radius, soft shadow, no dark scrim. Same visual style as the second reference. It naturally overlays the problem heading and description.
Header title: "C言語によるプログラミングの復習 の提出結果" in readable bold type, close X at top right.
Subtitle: "2a7396e · 17 hours ago · 1 AC / 2"
Exactly TWO result rows reflecting the sidebar's two subproblems, NO column header:
blue check | "基本課題" bold | "AC" green | "0.12 s" muted | "Details" blue link
red circle white X | "発展課題" bold | "WA" red | "0.08 s" muted | "Details" blue link
Align icons, names, result codes, times and Details in consistent columns. No extra rows, no legends, no GitHub logos, no Successful label. Do not reintroduce 成功 or 結果を見る buttons. Keep the sidebar upload card without the deleted explanatory prose. Preserve all unaffected pixels as closely as possible.
