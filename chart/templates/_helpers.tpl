{{/*
資源名の接頭辞。Release 名が chart 名を含む場合は Release 名をそのまま使う
(helm create の慣例)。各資源は "<fullname>-backend" のように component を後置する。
*/}}
{{- define "dsa.fullname" -}}
{{- if contains .Chart.Name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/* 共通ラベル。app.kubernetes.io/component は各 template が追加する */}}
{{- define "dsa.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}

{{/* selector 用ラベル。selector は immutable なので最小限に保つ */}}
{{- define "dsa.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
