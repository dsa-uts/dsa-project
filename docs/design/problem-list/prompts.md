# Problem list mockups

Generated using the built-in image_gen tool. These PNGs are static design mockups.

## Default view

Use case: ui-mockup, precise edit. Edit the first image, a Japanese DSA Problem List screen. Other inputs are visual references for top navigation and CI-style status.
Create one clean high-fidelity desktop UI screenshot at approximately 1584x992, preserving original Problem List title, All / 課題1 through 課題8 tab strip, two assignment sections, Japanese subproblem names and overall white background. Replace the cyan topbar with the exact style of reference topbar: solid #407BFA, height about 68px, modest bold white DSA logo at left, Dashboard and Results next to it, Grading Admin Logout aligned right, all white text. No logout icon.
Place a compact clickable submission summary immediately to the right of each assignment heading on the SAME baseline, like the reference CI status: no capsule, just status icon, muted monospace short FILE hash, middle dot, relative submission time. 課題1 summary: red X icon, "2a7396e · 17 hours ago". 課題2 summary: blue check icon, "8f41c2b · 2 hours ago". These represent file hashes and last submitted time.
REMOVE the entire 最新の結果 column and all result badges from the subproblem tables. REMOVE table header rows including 課題名. Only single full-width column of subproblem names, separated by thin subtle gray horizontal rules, subtle outer border and small radius. Section 課題1 has exactly rows 基本課題 1, 基本課題 2, 応用課題. Section 課題2 has exactly rows 基本課題・連結リスト, 発展課題・双連結リスト. Keep rows about 64px high, body side margins 48px, spacious but balanced vertical rhythm. No popup in this image. Crisp professional Japanese typography, no texture, no gradients. Preserve all other content.

## Submission results popover

Use case: ui-mockup precise edit. First input is the edit target: the updated Japanese DSA problem list. Second input is a reference for popup styling only.
Create the clicked-open state of the submission summary beside 課題1. Preserve the first image exactly in content, layout, dimensions, typography, navigation and tables. Add ONE anchored floating results popover below the 課題1 heading's submission summary, approximately x=185 y=362 width=1040 height=330 on the 1584x992 screen. It overlays the first assignment table, with a white header, subtle light-gray result rows, thin cool-gray border, rounded 16px corners, gentle drop shadow. No dark page scrim. This is a GitHub checks-style popup as in reference. A small upward pointer can align to the summary. Keep the heading and clicked red failure summary above visible, and 課題2 below visible.
Popup header exact title: "課題1 の提出結果", bold dark text, close X at upper right.
Subtitle exact: "2a7396e · 17 hours ago · 1 AC / 3"
Below header show exactly three horizontal result rows without any column header. Each row contains a status icon at left, bold subproblem name, result code, muted elapsed time, and a blue "Details" link at the far right. Align all result codes, durations and Details links in columns.
Row 1: blue check icon | "基本課題 1" | green "AC" | "0.12 s" | "Details"
Row 2: red cross icon | "基本課題 2" | red "WA" | "0.08 s" | "Details"
Row 3: red cross icon | "応用課題" | amber "TLE" | "2.00 s" | "Details"
Use compact plain status codes not large pills. No GitHub logo, no Successful or Failed labels. No extra subproblem rows. CLE is another possible result code in this UI but don't add a legend or extra row. Underlying list must still have no header and no latest-result column. Clean crisp professional screenshot, exact Japanese glyphs.

## Interaction intent

- Clicking an assignment submission summary opens its results popover; the close button dismisses it.
- The summary displays aggregate status, submitted file hash, and last submission time.
- Result codes include AC, WA, TLE, CLE; this example shows AC, WA, and TLE for the three existing subproblems.
- Each result includes elapsed time and a Details link to its corresponding result detail.
- The subproblem list has no header or latest-result column.
