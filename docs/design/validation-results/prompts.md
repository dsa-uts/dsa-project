# Results v4

Tool: built-in image_gen

## 画面の変更

- ユーザー ID・ユーザー名・ファイルハッシュの検索欄を削除し、「全体結果」のフィルターを残す。
- サイドバーの課題一覧の先頭に「All」を追加する。選択すると全課題の Validation Request を最新順で表示する。
- 画像は All 選択時の状態。一覧に「課題」列を追加し、各 Request の対象 Project を示す。
- 個別の課題を選択すると、その Project の結果一覧を表示する。

## Edit prompt

Use case: precise-object-edit
Asset type: Japanese desktop web UI mockup, Validation Results.
Input image: edit target docs/design/validation-results/default.png.
Edit the supplied mockup, preserving its blue topbar, white/light-gray surfaces, typography, crisp Japanese labels, table styling, and overall desktop layout. Make these changes:
1. Completely remove the search input, magnifying glass icon, and placeholder 「ユーザーID・ユーザー名・ファイルハッシュ値で検索」. Retain only the 「全体結果」 dropdown with selected value 「すべて」, aligned at the left of the filter bar.
2. Insert an "All" navigation item above 課題1 in the left sidebar. Select All with the existing pale blue background, blue text, and blue left indicator; 課題2 is now unselected. Keep 課題1 through 課題5 below All.
3. Main heading is "All" instead of 課題2, with small secondary text 「全課題の提出・最新順」 below it.
4. This shows Validation Request results across all Projects, newest first. Add a compact 「課題」 table column immediately after 「リクエスト」. For request rows #128, #127, #126, #125, #124 set the project names respectively 課題2, 課題1, 課題3, 課題2, 課題1. Retain all existing other table columns and row values, including users, statuses AC/WA/TLE/MLE/AC, hashes with copy icons, durations and descending timestamps. Adjust column widths to fit all seven columns cleanly without clipping, overlaps, or missing information.
Keep topbar exactly DSA, Dashboard, Results (active) on left and Grading, Admin, Logout on right. Keep Prev disabled and Next enabled at bottom right. No search control anywhere. Preserve the image aspect ratio and polished original visual style. No extra controls.
