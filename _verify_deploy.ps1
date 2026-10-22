$headers = @{ Origin = "https://blackgavel.geetm.ai"; Accept = "application/json" }
$h = Invoke-RestMethod -Uri "https://geetm-blackgavel-api.cryandean.workers.dev/" -Headers $headers
Write-Host ("health.auto_analyze=" + $h.auto_analyze)
$snap = Invoke-RestMethod -Uri "https://geetm-blackgavel-api.cryandean.workers.dev/store/snapshot" -Headers $headers
Write-Host ("snapshot.has_auto_analyze=" + [bool]$snap.auto_analyze)
if ($snap.auto_analyze) { Write-Host ($snap.auto_analyze | ConvertTo-Json -Compress) }
try {
  $html = Invoke-WebRequest -Uri "https://warm-reception-live.pages.dev/" -UseBasicParsing
  if ($html.Content -match 'wr-live-build:[^<\-]+') { Write-Host ("pages_build=" + $Matches[0]) }
  if ($html.Content -match 'ensureGeeTmPendingScored') { Write-Host "pages has ensureGeeTmPendingScored" } else { Write-Host "pages MISSING ensure" }
} catch {
  Write-Host ("pages_err=" + $_.Exception.Message)
}
