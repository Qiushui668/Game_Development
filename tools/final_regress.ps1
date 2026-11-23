# B1.8 最终回归：typecheck / build / 新验收 / 老回归
$ErrorActionPreference = 'Continue'
Set-Location E:\DoubaoWork\Game_Development
$env:NPM_CONFIG_CACHE = 'E:\npm-cache'
$py = '.\.venv\Scripts\python.exe'
$log = 'tools\final_regress.log'
"=== START $(Get-Date -Format 'HH:mm:ss') ===" | Out-File $log -Encoding utf8

& "E:\Program Files\nodejs\npm.cmd" run typecheck *> tools\typecheck.log
"typecheck exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

& "E:\Program Files\nodejs\npm.cmd" run build *> tools\build.log
"build exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

& $py tools\verify_b18.py *> tools\verify_b18.log
"verify_b18 exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

foreach ($m in @('m2','m3','m4','m5','m6','m8','m9')) {
  & $py "tools\verify_$m.py" *> "tools\verify_$m.log"
  "$m exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8
}
& $py tools\verify_m7.py *> tools\verify_m7.log
"m7 exit=$LASTEXITCODE" | Out-File $log -Append -Encoding utf8

"=== END $(Get-Date -Format 'HH:mm:ss') ===" | Out-File $log -Append -Encoding utf8
