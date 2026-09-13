# CI結果詳細の生成・編集プロンプト

採用画像: [default.png](default.png)

以下は同じ画像に対する編集履歴（適用順）。原文の出力名 `validation-detail-10-inline-version.png` は、整理後の `default.png` に対応する。参照画像を含む生成セッション全体は保存されていないため、完全な再生成手順ではない。

## 1. ナビゲーション・メタデータ・実行情報

### Validation detail edit

Tool: built-in image_gen (edit).
Output: `validation-detail-10-inline-version.png`
Memory usage and submitted-file hash are illustrative mockup values.

#### Final prompt

Edit the first supplied image, a Japanese validation result UI screenshot. Second image is the exact top navigation style reference. Produce a crisp high-resolution full-page UI screenshot preserving the original content and layout except for these specified edits. Keep the full page visible, expand height if needed.

1. Replace the cyan top bar with the reference's solid cornflower blue (#407BFA approximately), white DSA logo left, white navigation Dashboard and Results following it; right aligned Grading, Admin, Logout. Match reference spacing and typography scaled to the screenshot width. No Japanese logout.
2. Change ALL green status badges that currently say 成功 to AC: both workflow tabs, both job headers, every step row. Overall result remains AC. Keep 実行完了 as lifecycle state.
3. Metadata below submitted files: REMOVE the surrounding outer card border and remove the table's enclosing outer border. Use a single vertical list of label/value rows (two columns only: item title on left, detail on right), not two pairs side by side. Subtle horizontal separators allowed. Rows:
提出日時 | 2026/09/12 19:24:00
提出者 | 山田 太郎（20252043）
全体の状態 | 実行完了
結果 | green AC badge
所要時間 | 2.4秒
メモリ使用量(ピーク) | 12.8 MB
問題 | 課題1・基本課題 (ver: v3), blue link with muted version
ハッシュ値 | a complete 64-character SHA-256 display value 9f2c4a7e6b103d85c9a14f602e8b7d33a6c091fe4d2b58a713e0c9d64b5f208a . Render hash in small legible monospace, wrap within value cell if necessary. Hash is of submitted file.
4. Each of FOUR step execution result rows must show BOTH execution time and memory usage. Keep times and add explicit clear memory values next to time: main_euclid.cのコンパイル = 168 ms · 12.8 MB; gcd_euclidが定義されているか = 201 ms · 4.2 MB; 15, 30のGCD = 43 ms · 1.6 MB; 引数が2つでない場合のエラー出力 = 12 ms · 1.5 MB. Preserve AC and row expand controls. Fit columns comfortably. Can add memory to job summary headers too, compile 369 ms · 12.8 MB and test 55 ms · 1.6 MB.
5. In プリセットファイル section delete the explanatory text 課題1・基本課題で使用・テキスト1件 entirely. Keep title, file selector, download, code.
Preserve all other sections and content: title Validation Result #2031, return link, submitted Makefile code and report.pdf, Artifacts with summary.json and plot, workflow tabs and ID, expanded test command/output/expected output, preset code. Maintain original Japanese typography, light background, blue accents, thin borders of OTHER cards. Footer explains illustrative values as original. This is an edited bitmap UI design, not source code.

## 2. Stepの表と展開表示

### Step results table edit

Tool: built-in image_gen (edit).
Output: `validation-detail-10-inline-version.png`

#### Final prompt

Edit image 1 (full Japanese Validation Result #2031 page). Image 2 is a layout reference ONLY for step results tables and their expanded details. Keep all other existing page content unchanged. Produce a crisp readable full-page UI bitmap; increase page height to accommodate the new table formatting without squeezing content.

Change the step tables under ジョブの実行結果 to match image 2. Preserve the two job containers and headers compile and test, their summaries, and their two existing steps each. Within EACH job use a clear table header with columns: blank narrow disclosure control column, 説明 (wide), 結果, 実行時間, メモリ. Align time and memory values in DISTINCT columns. Use white rows, horizontal gray rules, generous spacing, green rounded rectangular AC badges with white type as in reference. Remove previous step numbers and checkmark icons, put expand/collapse chevrons at the far LEFT as in reference, remove far-right step chevrons.
compile rows: main_euclid.cのコンパイル | AC | 168 ms | 12.8 MB ; gcd_euclidが定義されているか | AC | 201 ms | 4.2 MB. Both collapsed.
test rows: 15, 30のGCD | AC | 43 ms | 1.6 MB (expanded with upward chevron in blue outlined square); 引数が2つでない場合のエラー出力 | AC | 12 ms | 1.5 MB (collapsed down chevron). Preserve original values and descriptions; do NOT replace them with reference screenshot's values or its second step.

Expanded first test: a light gray full-width panel directly under its row, matching image 2's hierarchy:
Task #1 (bold)
Exit code: 0 (expected: 0), with 0 (expected: 0) green.
Command: ./gcd_euclid 15 30 , command in monospace on small gray inline code background.
標準入力 (stdin) bold label, full width white bordered field containing (No stdin).
標準出力 (stdout) bold label with blue Diff View button adjacent. Below, two equal side-by-side white bordered output fields with small labels 標準出力 (stdout) and 標準出力 (stdout, expected). Both contain original value 15 in monospace (NOT the long sentence from reference).
標準エラー出力 (stderr) bold label. Below two equal side-by-side small white bordered fields with labels 標準エラー出力 (stderr) and 標準エラー出力 (stderr, expected). Empty fields, as in reference.
Ensure labels and fields are easily readable, with sufficient vertical spacing. Preserve the next collapsed row below the panel.

Invariants: Keep the blue DSA Dashboard Results / Grading Admin Logout top bar unchanged. Keep submitted files, Makefile and report.pdf, single label/value metadata with no outer border including peak memory and hash, both AC workflow tabs, Artifacts summary.json and plot, and preset files section with NO explanatory subtitle. Keep full footer. Do not crop the page or omit any section. This edit only changes step results table presentation and expanded detail format.

## 3. Stepの表の縦罫線を除去

### Remove step table vertical rules

Tool: built-in image_gen (edit).
Output: `validation-detail-10-inline-version.png`

#### Final prompt

Perform one minimal precise edit on this full-page Japanese Validation Result #2031 UI screenshot: In BOTH step execution results tables under ジョブの実行結果 (compile and test), remove ALL vertical table gridlines separating columns, including between disclosure chevron and 説明, between 説明 and 結果, between 結果 and 実行時間, and between 実行時間 and メモリ. Remove these vertical lines from table header rows and ALL step data rows including the final collapsed test row. The step table grid should have ONLY subtle horizontal row separators. Preserve exact column alignment, spacing, typography, values, labels, AC badges, disclosure buttons, and all horizontal separators. The outer job card outline may stay. Preserve all borders of stdin/stdout/stderr fields and all expanded detail content unchanged. Preserve every other section and detail on the page unchanged, including top bar, submitted files and code, metadata with hash, workflow, Artifacts and chart, job headers, preset file section, footer. Same full-page composition and aspect ratio; no cropping, no other redesign. Output edited screenshot.
