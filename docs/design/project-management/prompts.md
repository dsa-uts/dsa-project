# Project Management 採用デザイン

Built-in image_gen で生成した静的モックアップ。API・画面の実装は含まない。
参照画像: ../problem-list/default.png

[表内編集](inline-edit.png)を採用。日時と表示順をまとめて保存。

想定導線: トップバー Admin → Admin Page の Project Management → 本ページ。
登録ボタンから POST /api/admin/resource-imports を実行する想定。日時・表示順の保存APIは本案では未定義。
リソースID・バージョン・日時は表示例。

## 生成プロンプト

Use case: ui-mockup. Generate one high-fidelity desktop UI design screenshot, landscape approximately 1600x1100. Reference image is style reference only: match its DSA navigation and clean Japanese typography. Solid blue #407BFA top bar, white DSA logo left, Dashboard, Results, right Grading, Admin, Logout. White body, black headings, subtle cool gray horizontal table rules, blue primary buttons, restrained corners, no gradients or illustrations. Page reached via Admin then Admin Page then Project Management: show breadcrumb "Admin Page / Project Management" and title "Project Management". Japanese field labels, English page title. Manage Projects as whole assignments, not individual problems. Table shows 課題1 through 課題4, read-only resource IDs dsa-project-01 etc and versions 1.0.0. Publication starts and deadlines editable independently of resource definition. Explicit timezone label "日時は JST". Every project row has a six-dot drag grip on the left for cursor row drag-and-drop, never up/down arrow buttons. Resource title/id/version read-only in existing rows. Importing a new version requires fields "リソースID" and "バージョン" and blue "登録" button. No API endpoint text in product UI. No invented analytics, side navigation, delete actions, or decorative cards. Crisp legible exact Japanese. Dates 2026-09-12 19:59 and 2026-09-19 19:59, following rows weekly increments. VARIANT A: Table-first inline editing. At top below title a thin outlined horizontal registration section labeled "新しいバージョンを登録" with resource ID input containing dsa-project-01 and version input containing 1.1.0 and blue 登録 button, compact single row. Below heading "課題一覧" and helper "ハンドルをドラッグして表示順を変更". Wide full-width table columns grip, 課題, リソースID, バージョン, 公開開始日時, 締切. All four rows show date/time input boxes with small calendar icon in both date columns; clear spacious alignment. Under table at right outlined キャンセル and blue 変更を保存 buttons; left muted "日時・表示順の変更をまとめて保存". Maintain page generous whitespace. No modal. This is the simplest design.
